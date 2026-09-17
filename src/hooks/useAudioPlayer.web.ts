import { useState, useEffect, useRef, useCallback } from 'react'
import { storage, STORAGE_KEYS } from './useStorage'
import { getTrackStreamUrl } from '../api/client'
import { sanitizeMediaText } from '../utils/format'
import type { PlayerState, PlayerMode, OnDemandTrack, NowPlayingMeta } from '../types'

const MAX_RETRY_DELAY = 30000
const RETRY_BASE_DELAY = 2000
const RECONNECT_AFTER_ATTEMPTS = 3
// Watchdog cadence and the "no audio progress" threshold. The threshold spans a
// few ticks on purpose: a normal, short rebuffer must never trigger a reload.
const WATCHDOG_INTERVAL = 5000
const STALL_TIMEOUT = 15000
// Grace before a `stalled`/`suspend` signal is allowed to consult the watchdog
// (both events are frequently benign for a live stream).
const STALL_SIGNAL_GRACE = 3000

export interface TrackProgress {
  currentTime: number
  duration: number
}

/**
 * Web implementation of the audio player.
 *
 * Uses a plain HTML `<audio>` element instead of `react-native-track-player`.
 * react-native-track-player pulls in `shaka-player` (DASH/HLS engine) on web,
 * which is unreliable for live ICY/MP3 radio streams — the same reason the
 * existing web app uses an `<audio>`-based player.
 *
 * Public API is identical to the native hook (`useAudioPlayer.ts`) so
 * `app/index.tsx` needs no platform-specific branching.
 */
export function useAudioPlayer(currentSlug: string | undefined) {
  const slug = currentSlug || 'main'

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<PlayerState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [mode, setMode] = useState<PlayerMode>('radio')
  const [currentTrack, setCurrentTrack] = useState<OnDemandTrack | null>(null)
  const [trackProgress, setTrackProgress] = useState<TrackProgress>({ currentTime: 0, duration: 0 })
  const [nowPlaying, setNowPlayingState] = useState<NowPlayingMeta>({ title: null, artist: null })

  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPlayingRef = useRef(false)
  const currentUrlRef = useRef('')
  const savedSlugRef = useRef(slug)
  const modeRef = useRef<PlayerMode>('radio')
  const prevSlugRef = useRef(slug)
  const volumeRef = useRef(1)
  const prevVolumeRef = useRef(1)
  const onTrackEndedRef = useRef<() => void>(() => {})
  // Latest transport controls for the Media Session handlers, which are
  // registered once and must not capture stale closures.
  const playRef = useRef<() => void>(() => {})
  const pauseRef = useRef<() => void>(() => {})
  // Latest `playTrack`, so `play()` can restart the current on-demand track
  // (declared later in this hook, but reachable through the ref).
  const playTrackRef = useRef<(track: OnDemandTrack) => void>(() => {})

  // --- Watchdog state -------------------------------------------------------
  // Timestamp of the last *observable* playback progress (`timeupdate` /
  // `playing`). A live stream that keeps advancing `currentTime` keeps this
  // fresh; a dead-but-open connection does not. The watchdog exists because the
  // old code only retried while `state === 'error'`, which a silent stall never
  // produced (see `scheduleRecovery`/`maybeRecover`).
  const lastProgressAtRef = useRef(Date.now())
  // When the tab was hidden. Timers and media events are throttled in background
  // tabs, so that gap is discounted on return instead of being read as a stall.
  const hiddenAtRef = useRef(0)
  // Delayed check scheduled by a `stalled`/`suspend` signal.
  const stallProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest watchdog callbacks. `initAudio` registers its listeners exactly once,
  // so it must reach the current closures through these refs (same reasoning as
  // `playRef`/`pauseRef` above).
  const scheduleRecoveryRef = useRef<() => void>(() => {})
  const maybeRecoverRef = useRef<() => void>(() => {})

  const buildStreamUrl = useCallback((s: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL || ''
    return `${base}/${s}.mp3`
  }, [])

  // Keep mode ref in sync with state
  modeRef.current = mode

  // Remember the radio slug to return to after an on-demand track
  useEffect(() => {
    if (modeRef.current !== 'track') {
      savedSlugRef.current = slug
    }
  }, [slug])

  const cleanupAudio = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (stallProbeTimerRef.current) {
      clearTimeout(stallProbeTimerRef.current)
      stallProbeTimerRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
      audioRef.current = null
    }
    isPlayingRef.current = false
  }, [])

  const initAudio = useCallback(() => {
    const audio = new Audio()

    // Apply the latest volume without depending on React state
    audio.volume = volumeRef.current
    audio.preload = 'none'

    audio.addEventListener('loadstart', () => {
      setState('loading')
    })

    audio.addEventListener('waiting', () => {
      setState('buffering')
    })

    audio.addEventListener('playing', () => {
      setState('playing')
      setError(null)
      retryCountRef.current = 0
      lastProgressAtRef.current = Date.now()
    })

    audio.addEventListener('pause', () => {
      setState('paused')
    })

    audio.addEventListener('loadedmetadata', () => {
      if (modeRef.current === 'track' && audio.duration && isFinite(audio.duration)) {
        setTrackProgress((prev) => ({ ...prev, duration: audio.duration }))
      }
    })

    audio.addEventListener('timeupdate', () => {
      // Any `timeupdate` means the stream is really advancing — this is the
      // watchdog's "audio progressed" heartbeat (track mode included, though the
      // watchdog itself stays out of track mode).
      lastProgressAtRef.current = Date.now()
      if (modeRef.current === 'track') {
        setTrackProgress({
          currentTime: audio.currentTime,
          duration: audio.duration && isFinite(audio.duration) ? audio.duration : 0,
        })
      }
    })

    // `stalled` = the browser stopped receiving data; `suspend` = it stopped
    // fetching (frequently benign for a live stream). Neither guarantees an
    // `error`, so after a short grace period they feed the SAME watchdog
    // decision instead of forking their own recovery.
    const handleStallSignal = () => {
      if (stallProbeTimerRef.current) clearTimeout(stallProbeTimerRef.current)
      stallProbeTimerRef.current = setTimeout(() => {
        stallProbeTimerRef.current = null
        maybeRecoverRef.current()
      }, STALL_SIGNAL_GRACE)
    }
    audio.addEventListener('stalled', handleStallSignal)
    audio.addEventListener('suspend', handleStallSignal)

    audio.addEventListener('ended', () => {
      if (modeRef.current === 'track') {
        setState('buffering')
        onTrackEndedRef.current()
      } else {
        setState('paused')
      }
    })

    audio.addEventListener('error', () => {
      const audioError = audio.error
      let msg = 'Stream playback error'

      if (audioError) {
        switch (audioError.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            msg = 'Playback was aborted'
            break
          case MediaError.MEDIA_ERR_NETWORK:
            msg = 'Network error — stream may be offline'
            break
          case MediaError.MEDIA_ERR_DECODE:
            msg = 'Decode error — retrying...'
            break
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            msg = 'Stream format not supported'
            break
        }
      }

      setError(msg)
      setState('error')
      // The retry chain is armed from the failure itself, never from an effect
      // that watches `state` — that indirection is what used to lose retries.
      scheduleRecoveryRef.current()
    })

    audioRef.current = audio
  }, [])

  const tryPlay = useCallback((url: string) => {
    const audio = audioRef.current
    if (!audio) return

    // Only the newest arm may stay live. A backoff timer scheduled earlier (and
    // now superseded by a user tap or the watchdog) must not fire a duplicate
    // reload seconds later.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    currentUrlRef.current = url
    isPlayingRef.current = true
    // A fresh attempt gets a full stall budget before the watchdog may judge it.
    lastProgressAtRef.current = Date.now()
    setState('loading')

    // Cache-bust stream URL to bypass browser Media Cache on retry/reconnect
    const separator = url.includes('?') ? '&' : '?'
    audio.src = `${url}${separator}_cb=${Date.now()}`
    audio.play().catch((err: any) => {
      if (err?.name === 'NotAllowedError') {
        // Autoplay was blocked by the browser. Retrying in a loop cannot
        // succeed (there is no user activation yet) and used to leave the player
        // wedged in 'loading' forever: the buffering safety net only watched
        // `state === 'buffering'`. Report an honest, recoverable state instead —
        // the UI shows the play button and the user's next tap re-invokes play().
        isPlayingRef.current = false
        setState('paused')
        return
      }
      if (err?.name !== 'AbortError') {
        setError(err?.message || 'Playback error')
        setState('error')
        scheduleRecoveryRef.current()
      }
    })
  }, [])

  /**
   * Arm the recovery path for the RADIO stream: the `error` event, a rejected
   * `play()`, a `stalled`/`suspend` signal and the watchdog all funnel here.
   *
   * Scope — radio mode only. It bails while `modeRef.current === 'track'`, so an
   * on-demand track has NO automatic recovery: a rejected `playTrack` only sets
   * `error`. That is deliberate — a timer retrying a permanently broken file
   * would loop forever — and the UI provides an explicit retry instead: `play()`
   * restarts the current track in track mode (see `play` below).
   *
   * It is deliberately independent of `state`. The previous implementation
   * retried only while `state === 'error'`, so any dead end that did not produce
   * exactly that state — a stall with no event at all, a rejected autoplay stuck
   * in 'loading', or the 'reconnecting' state that the effect itself set — never
   * re-armed and the player went silent until a page reload.
   *
   * Backoff widens the delay but never disables retries: the counter only feeds
   * the exponent, and every failure arms the next attempt.
   */
  const scheduleRecovery = useCallback(() => {
    if (modeRef.current === 'track') return
    if (!isPlayingRef.current) return
    if (retryTimerRef.current) return
    if (document.hidden) return

    const exponent = Math.min(retryCountRef.current, 5)
    const delay = Math.min(RETRY_BASE_DELAY * 2 ** exponent, MAX_RETRY_DELAY)
    retryCountRef.current += 1

    // Escalation is a UI label only; the chain above is already armed and every
    // subsequent failure re-arms it (see tryPlay/error/stalled/watchdog).
    if (retryCountRef.current > RECONNECT_AFTER_ATTEMPTS) {
      setState('reconnecting')
    }

    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      if (modeRef.current === 'track' || !isPlayingRef.current) return
      tryPlay(buildStreamUrl(savedSlugRef.current))
    }, delay)
  }, [tryPlay, buildStreamUrl])

  /**
   * The watchdog's decision, also fed by `stalled`/`suspend` after a grace
   * period. The invariant it protects: while the user intends to play, keep
   * trying until audio actually advances.
   *
   *   - `audio.paused` with `isPlayingRef.current === true` is always a dead end
   *     (an intended pause sets `isPlayingRef` false);
   *   - otherwise, no `timeupdate`/`playing` for longer than `STALL_TIMEOUT`
   *     means the bytes stopped flowing without an `error` event.
   *
   * No-op while paused on purpose (`isPlayingRef === false`), in on-demand track
   * mode, or while the tab is hidden.
   */
  const maybeRecover = useCallback(() => {
    if (modeRef.current === 'track') return
    if (!isPlayingRef.current) return
    if (document.hidden) return

    const audio = audioRef.current
    if (!audio) return

    const noProgressFor = Date.now() - lastProgressAtRef.current
    if (!audio.paused && noProgressFor <= STALL_TIMEOUT) return

    scheduleRecovery()
  }, [scheduleRecovery])

  // Publish the current closures to the once-registered audio listeners/watchdog.
  scheduleRecoveryRef.current = scheduleRecovery
  maybeRecoverRef.current = maybeRecover

  // Init on mount, cleanup on unmount
  useEffect(() => {
    initAudio()
    return () => {
      cleanupAudio()
    }
  }, [initAudio, cleanupAudio])

  // Restore persisted volume / mute once, after the audio element exists
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const savedVol = await storage.getItem(STORAGE_KEYS.VOLUME)
      const savedMuted = await storage.getItem(STORAGE_KEYS.MUTED)
      if (cancelled) return

      let v = 1
      if (savedVol !== null) {
        const parsed = parseFloat(savedVol)
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) v = parsed
      }
      const isMuted = savedMuted === 'true'

      prevVolumeRef.current = v
      setVolumeState(v)
      setMuted(isMuted)
      volumeRef.current = isMuted ? 0 : v
      if (audioRef.current) {
        audioRef.current.volume = isMuted ? 0 : v
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // When the slug changes, rebuild the audio element and start the new stream
  useEffect(() => {
    if (prevSlugRef.current !== slug) {
      prevSlugRef.current = slug
      retryCountRef.current = 0
      currentUrlRef.current = ''
      cleanupAudio()
      initAudio()
      tryPlay(buildStreamUrl(slug))
    }
  }, [slug, cleanupAudio, initAudio, tryPlay, buildStreamUrl])

  // Resume on tab focus (Telegram WebView / mobile browsers pause on background)
  // and re-run the watchdog on return. Background tabs throttle timers and media
  // events, so the hidden interval is discounted before judging progress; this
  // also recovers a stream that went silent while the tab was hidden.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        hiddenAtRef.current = Date.now()
        return
      }

      // Re-base the progress clock across the hidden gap so the throttled
      // interval is neither a false stall nor a false healthy signal:
      //   - if ANY progress event arrived while hidden, trust it and restart the
      //     baseline at "now" (a live stream keeps advancing even in background);
      //   - if NONE did, treat the moment of hiding as the last progress, so the
      //     watchdog recovers immediately on return instead of waiting another
      //     full threshold.
      if (hiddenAtRef.current) {
        lastProgressAtRef.current =
          lastProgressAtRef.current >= hiddenAtRef.current ? Date.now() : hiddenAtRef.current
        hiddenAtRef.current = 0
      }

      if (modeRef.current === 'track' || !isPlayingRef.current) return
      const audio = audioRef.current
      if (!audio) return

      if (audio.paused) {
        // Re-arm through the shared path: it handles NotAllowedError honestly
        // and gives a fresh cache-buster, unlike a bare `audio.play()`.
        tryPlay(buildStreamUrl(savedSlugRef.current))
      } else {
        // Not paused but possibly silent — let the watchdog decide.
        maybeRecoverRef.current()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [tryPlay, buildStreamUrl])

  const play = useCallback(() => {
    if (!audioRef.current) return
    retryCountRef.current = 0
    setError(null)

    // In on-demand mode `play` must restart the CURRENT track, not the radio
    // stream: `mode`/`currentTrack` — and the PlayerBar + Media Session metadata
    // — still describe the track, so starting radio underneath them would leave
    // the UI/tray describing a track while radio audio plays. It is also the
    // user-facing recovery for a failed track load (`playTrack` reports `error`
    // without arming an automatic retry).
    if (modeRef.current === 'track' && currentTrack) {
      playTrackRef.current(currentTrack)
      return
    }

    tryPlay(buildStreamUrl(savedSlugRef.current))
  }, [tryPlay, buildStreamUrl, currentTrack])

  const pause = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    const audio = audioRef.current
    if (!audio) return

    isPlayingRef.current = false
    audio.pause()
    setState('paused')
  }, [])

  const toggle = useCallback(() => {
    if (state === 'playing' || state === 'loading' || state === 'buffering' || state === 'reconnecting') {
      pause()
    } else {
      play()
    }
  }, [state, play, pause])

  const playTrack = useCallback(
    (track: OnDemandTrack) => {
      const audio = audioRef.current
      if (!audio) return

      // A backoff timer scheduled while the radio stream was down must not
      // resurrect the radio source on top of the on-demand track seconds later
      // (the timer fires `tryPlay(radio)` and overwrites `audio.src`).
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }

      setError(null)
      retryCountRef.current = 0
      savedSlugRef.current = slug

      setMode('track')
      modeRef.current = 'track'
      setCurrentTrack(track)
      setTrackProgress({ currentTime: 0, duration: track.duration || 0 })

      const url = getTrackStreamUrl(track.id)
      currentUrlRef.current = url
      isPlayingRef.current = true
      // `loadstart` also flips this, but setting it synchronously gives immediate
      // feedback for the tap (and keeps the state meaningful if the element never
      // fires `loadstart`).
      setState('loading')
      audio.src = url
      audio.play().catch((err: any) => {
        if (err?.name === 'NotAllowedError') {
          // Same honesty as `tryPlay`: never linger in 'loading' with no retry.
          isPlayingRef.current = false
          setState('paused')
          return
        }
        if (err?.name !== 'AbortError') {
          setError(err?.message || 'Track playback error')
          setState('error')
        }
      })
    },
    [slug],
  )

  // Publish the current `playTrack` to `play()` (declared earlier).
  playTrackRef.current = playTrack

  const stopTrack = useCallback(() => {
    setMode('radio')
    modeRef.current = 'radio'
    setCurrentTrack(null)
    setTrackProgress({ currentTime: 0, duration: 0 })
    setError(null)
    retryCountRef.current = 0
    tryPlay(buildStreamUrl(savedSlugRef.current))
  }, [tryPlay, buildStreamUrl])

  // Keep the ended-track callback pointing at the latest stopTrack
  useEffect(() => {
    onTrackEndedRef.current = stopTrack
  }, [stopTrack])

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    volumeRef.current = clamped
    setVolumeState(clamped)
    if (audioRef.current) {
      audioRef.current.volume = clamped
    }
    if (clamped > 0) {
      setMuted(false)
      prevVolumeRef.current = clamped
    }
    // Persistence is debounced by VolumeSlider (owns the high-frequency events).
  }, [])

  const toggleMute = useCallback(() => {
    const newMuted = !muted
    const newVolume = newMuted ? 0 : prevVolumeRef.current || 1
    volumeRef.current = newVolume
    setMuted(newMuted)
    setVolumeState(newVolume)
    if (audioRef.current) {
      audioRef.current.volume = newVolume
    }
    storage.setItem(STORAGE_KEYS.MUTED, String(newMuted))
  }, [muted])

  // Keep the latest controls reachable from the Media Session action handlers.
  playRef.current = play
  pauseRef.current = pause

  /**
   * Feed now-playing metadata into the OS media session. Called from the screen
   * when `status.trackTitle`/`status.trackArtist` change. Feature-detected and
   * fully best-effort: a missing/partial Media Session API must never throw or
   * interrupt playback.
   */
  const setNowPlaying = useCallback((meta: NowPlayingMeta) => {
    // `trackTitle`/`trackArtist` arrive over the WebSocket (untrusted): strip
    // control characters and cap the length before they reach the Media Session.
    // `null` is preserved so the render effect below keeps applying its existing
    // 'RAW Radio' / 'Listen Live' fallbacks and the dedup stays intact.
    const title = sanitizeMediaText(meta.title)
    const artist = sanitizeMediaText(meta.artist)
    setNowPlayingState((prev) =>
      prev.title === title && prev.artist === artist ? prev : { title, artist },
    )
  }, [])

  // Publish metadata + playback state to the OS tray. Runs whenever the track or
  // player state changes; guarded so unsupported browsers are a silent no-op.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

    try {
      const session = navigator.mediaSession
      const MediaMetadataCtor = (
        globalThis as typeof globalThis & { MediaMetadata?: typeof MediaMetadata }
      ).MediaMetadata

      if (MediaMetadataCtor) {
        const hasTrack = !!nowPlaying.title
        session.metadata = new MediaMetadataCtor({
          title: nowPlaying.title || 'RAW Radio',
          artist: nowPlaying.artist || (hasTrack ? 'RAW Radio' : 'Listen Live'),
          album: 'RAW Radio',
        })
      }

      const isActive =
        state === 'playing' ||
        state === 'loading' ||
        state === 'buffering' ||
        state === 'reconnecting'
      session.playbackState = isActive ? 'playing' : 'paused'
    } catch {
      // Media Session is best-effort — ignore unsupported browsers.
    }
  }, [nowPlaying, state])

  // Wire OS media controls (play/pause/stop) to the transport. Registered once;
  // the refs above always point at the latest callbacks.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

    const session = navigator.mediaSession
    try {
      session.setActionHandler('play', () => {
        if (!isPlayingRef.current) playRef.current()
      })
      session.setActionHandler('pause', () => {
        if (isPlayingRef.current) pauseRef.current()
      })
      session.setActionHandler('stop', () => {
        if (isPlayingRef.current) pauseRef.current()
      })
    } catch {
      // Not every browser supports every action — ignore.
    }

    return () => {
      try {
        session.setActionHandler('play', null)
        session.setActionHandler('pause', null)
        session.setActionHandler('stop', null)
      } catch {
        // ignore
      }
    }
  }, [])

  // Real watchdog (radio mode): while the user intends to play, keep trying
  // until audio actually progresses. This replaces the old `state === 'error'`
  // retry effect and the buffering-only safety net — together they left holes
  // ('loading', 'reconnecting', and any stall that fired no event at all were
  // unrecoverable). Recovery is now driven by observed progress, not by state.
  //
  // `scheduleRecovery`/`maybeRecover` themselves bail while paused on purpose,
  // in track mode, or when the tab is hidden (browsers throttle timers there;
  // the visibilitychange handler re-runs the check on return).
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return
      maybeRecoverRef.current()
    }, WATCHDOG_INTERVAL)
    return () => clearInterval(id)
  }, [])

  return {
    play,
    pause,
    toggle,
    state,
    error,
    volume,
    setVolume,
    muted,
    toggleMute,
    mode,
    currentTrack,
    trackProgress,
    playTrack,
    stopTrack,
    position: trackProgress.currentTime,
    duration: trackProgress.duration,
    setNowPlaying,
  }
}

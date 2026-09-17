import { useState, useEffect, useRef, useCallback } from 'react'
import { AppState, Image, Platform } from 'react-native'
import Constants from 'expo-constants'
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  State as TrackPlayerState,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player'
import { storage, STORAGE_KEYS } from './useStorage'
import { getTrackStreamUrl } from '../api/client'
import { sanitizeMediaText } from '../utils/format'
import type { PlayerState, PlayerMode, OnDemandTrack, NowPlayingMeta } from '../types'

const MAX_RETRY_DELAY = 30000
// Watchdog cadence and "no audio progress" threshold (radio mode only).
const WATCHDOG_INTERVAL = 5000
const STALL_TIMEOUT = 15000
// Fallback now-playing labels so the tray/lock-screen card is never blank.
const NOW_PLAYING_FALLBACK = 'RAW Radio'

/**
 * Notification / lock-screen capabilities. Kept in sync with the events handled
 * by `src/services/trackPlayerService.ts` — never advertise a control the
 * playback service does not implement:
 *   Play/Pause  ↔ Event.RemotePlay / Event.RemotePause
 *   Stop        ↔ Event.RemoteStop
 *   Skip*       ↔ Event.RemoteNext / Event.RemotePrevious
 */
const NOTIFICATION_CAPABILITIES = [
  Capability.Play,
  Capability.Pause,
  Capability.Stop,
  Capability.SkipToNext,
  Capability.SkipToPrevious,
]

/**
 * URI of the square 1024×1024 app icon (`assets/icon.png`), used as the
 * tray/lock-screen artwork of the radio stream (tracks have no artwork of their
 * own).
 *
 * `Image.resolveAssetSource` turns a `require()`d bundled asset into the URI
 * string that `updateNowPlayingMetadata` accepts. Caveat: in a **release
 * Android** build the JS bundle is loaded from the APK (not a `file://` path),
 * so React Native resolves the asset to a bare AAPT resource name — for this
 * asset `assets_icon` (emitted as `drawable-mdpi/assets_icon.png`) — with no
 * URI scheme, and Media3's Coil bitmap loader cannot load a scheme-less URI.
 * It is therefore rewritten to an `android.resource://` URI. In
 * development the resolved URI is an http URL and is used as-is.
 *
 * Resolved once per process and cached. Best-effort: never throws.
 */
let artworkUriCache: string | null | undefined

function getArtworkUri(): string | undefined {
  if (artworkUriCache !== undefined) return artworkUriCache ?? undefined

  try {
    // A static import cannot be used here: TypeScript has no `*.png` module
    // declaration in this project, so `require` is the RN-idiomatic way to
    // reference the bundled asset.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const resolved = Image.resolveAssetSource(require('../../assets/icon.png'))
    let uri = resolved?.uri
    if (uri && Platform.OS === 'android' && !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
      const pkg = Constants.expoConfig?.android?.package
      if (pkg) uri = `android.resource://${pkg}/drawable/${uri}`
    }
    artworkUriCache = uri || null
  } catch {
    artworkUriCache = null
  }

  return artworkUriCache ?? undefined
}

export function useAudioPlayer(currentSlug: string | undefined) {
  const [state, setState] = useState<PlayerState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)
  const [mode, setMode] = useState<PlayerMode>('radio')
  const [currentTrack, setCurrentTrack] = useState<OnDemandTrack | null>(null)

  const playbackState = usePlaybackState()
  const { position, duration } = useProgress(250)

  const trackProgress = { currentTime: position, duration }

  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPlayingRef = useRef(false)
  const currentUrlRef = useRef('')
  const savedSlugRef = useRef(currentSlug || 'main')
  const modeRef = useRef<PlayerMode>('radio')
  const initializedRef = useRef(false)
  const prevVolumeRef = useRef(1)
  // Resolves once TrackPlayer.setupPlayer() has completed.
  const setupPromiseRef = useRef<Promise<void> | null>(null)
  const readyRef = useRef(false)
  // Set only when the user explicitly starts playback (play/toggle).
  const userInitiatedRef = useRef(false)
  // A play request that arrived before setup completed.
  const pendingPlayRef = useRef(false)
  // Latest `playTrack`, so `play()` can restart the current on-demand track
  // (declared later in this hook, but reachable through the ref).
  const playTrackRef = useRef<(track: OnDemandTrack) => Promise<void>>(async () => {})
  // Monotonic id of the newest load request (radio or on-demand track). Every
  // await below re-checks it, because RNTP owns a single queue: an older request
  // that resumes after a newer one must not reset/add/play on top of it.
  const playRequestRef = useRef(0)

  // --- Now-playing / tray state (native only) -------------------------------
  // True once a track has been added to the RNTP queue. A WS status update can
  // arrive before the first `play()`, so the tray update must wait for a queue
  // (`updateNowPlayingMetadata` rejects with `no_current_item` without one).
  const hasQueueRef = useRef(false)
  // Latest now-playing metadata reported by the stream status (radio mode).
  const nowPlayingRef = useRef<{ title: string; artist: string }>({
    title: NOW_PLAYING_FALLBACK,
    artist: NOW_PLAYING_FALLBACK,
  })
  // What is currently displayed in the tray — skips redundant native calls when
  // a chatty WebSocket repeats the same track.
  const publishedNowPlayingRef = useRef<{ title: string; artist: string } | null>(null)

  // --- Stall watchdog state -------------------------------------------------
  // Timestamp of the last observed position change. RNTP reports "Playing"
  // even when the stream has silently frozen (dead-but-open connection), which
  // produces neither an Error nor a Buffering state — no watchdog, no recovery.
  const lastProgressAtRef = useRef(Date.now())
  // True once position has actually advanced for the current load. Guards the
  // progress rule so a stream that simply reports no position is not judged.
  const progressSeenRef = useRef(false)
  // Latest RNTP state for the interval callback (avoids stale closures).
  const playbackStateRef = useRef<TrackPlayerState | undefined>(TrackPlayerState.None)
  // Whether the app is in the foreground; the watchdog stays quiet in background.
  const appActiveRef = useRef(true)

  const buildStreamUrl = useCallback((slug: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL || ''
    return `${base}/${slug}.mp3`
  }, [])

  // Sync modeRef
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  // Map react-native-track-player state to PlayerState
  useEffect(() => {
    const ps = playbackState.state
    playbackStateRef.current = ps

    if (modeRef.current === 'track') {
      // On-demand mode owns `state` itself (set in playTrack/stopTrack), but a
      // player error must never be swallowed: without this branch a failed
      // HTTP/decoder load of the on-demand track kept the UI at "playing" with
      // no sound and no explanation anywhere.
      if (ps === TrackPlayerState.Error) {
        const errMessage =
          'error' in playbackState && playbackState.error ? playbackState.error.message : null
        setError(errMessage || 'Track playback error')
        setState('error')
      }
      return
    }

    if (ps === TrackPlayerState.Playing) {
      setState('playing')
      setError(null)
      retryCountRef.current = 0
    } else if (ps === TrackPlayerState.Buffering || ps === TrackPlayerState.Loading) {
      setState('buffering')
    } else if (ps === TrackPlayerState.Paused) {
      setState('paused')
    } else if (ps === TrackPlayerState.Error) {
      setState('error')
      setError('Stream playback error')
    } else if (ps === TrackPlayerState.None || ps === TrackPlayerState.Ready) {
      if (isPlayingRef.current) {
        setState('buffering')
      }
    }
  }, [playbackState])

  // Watchdog heartbeat: a changing position is the only evidence that audio is
  // really progressing (the state label can stay "Playing" on a frozen stream).
  useEffect(() => {
    lastProgressAtRef.current = Date.now()
    if (position > 0) progressSeenRef.current = true
  }, [position])

  // Resume playback when returning to the foreground (native only).
  // Some platforms pause the player when the app is backgrounded; if the user
  // intended it to keep playing, nudge it back into the playing state.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appActiveRef.current = nextState === 'active'
      if (nextState !== 'active' || !isPlayingRef.current) return
      TrackPlayer.getPlaybackState()
        .then((playback) => {
          if (playback.state === TrackPlayerState.Paused) {
            // Resuming from an OS-induced pause: the progress baseline may be a
            // whole background gap old, and `useProgress` will not refresh it
            // until the position actually changes. Without rebasing, the first
            // watchdog tick would judge the just-resumed stream as stalled
            // (STALL_TIMEOUT long gone) and force a full reconnect.
            lastProgressAtRef.current = Date.now()
            return TrackPlayer.play()
          }
        })
        .catch(() => {})
    })

    return () => subscription.remove()
  }, [])

  // Keep the hook's "the user intends to play" flag in sync with the OS media
  // controls (notification / lock-screen). The playback service
  // (src/services/trackPlayerService.ts) performs the actual transport action;
  // without this, a notification pause/stop would leave `isPlayingRef` true and
  // the stall watchdog would silently "recover" the stream ~15s later.
  useEffect(() => {
    const subscriptions = [
      TrackPlayer.addEventListener(Event.RemotePause, () => {
        isPlayingRef.current = false
        setState('paused')
      }),
      TrackPlayer.addEventListener(Event.RemotePlay, () => {
        isPlayingRef.current = true
        // Rebase the stall watchdog: a notification pause may have lasted
        // longer than STALL_TIMEOUT, and `useProgress(250)` only refreshes the
        // baseline when the position changes (RNTP dedups identical progress).
        // Without this, the first watchdog tick after a resume would see a stale
        // baseline while `playbackStateRef` is already Playing and force a full
        // reset/add/play reconnect — an offline-UI flash for a normal resume.
        lastProgressAtRef.current = Date.now()
      }),
      TrackPlayer.addEventListener(Event.RemoteStop, () => {
        isPlayingRef.current = false
        setState('paused')
      }),
    ]

    return () => subscriptions.forEach((subscription) => subscription.remove())
  }, [])

  // Initialize TrackPlayer once
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const setupPromise = TrackPlayer.setupPlayer()
      .then(async () => {
        // Notification / lock-screen controls. The advertised capabilities
        // mirror the events handled by src/services/trackPlayerService.ts
        // exactly: Play/Pause, Stop and SkipToNext/SkipToPrevious
        // (RemoteNext/RemotePrevious). `notificationCapabilities` is the v5
        // replacement for the v3 `compactCapabilities`. `ContinuePlayback`
        // keeps the radio alive when the app is swiped from recents.
        await TrackPlayer.updateOptions({
          android: {
            appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
          },
          capabilities: NOTIFICATION_CAPABILITIES,
          notificationCapabilities: NOTIFICATION_CAPABILITIES,
        }).catch(() => {
          // Best-effort: a failed updateOptions must not block playback setup.
        })

        const savedVol = await storage.getItem(STORAGE_KEYS.VOLUME)
        const savedMuted = await storage.getItem(STORAGE_KEYS.MUTED)
        if (savedVol !== null) {
          const v = parseFloat(savedVol)
          if (!isNaN(v) && v >= 0 && v <= 1) {
            setVolumeState(v)
            await TrackPlayer.setVolume(v)
            prevVolumeRef.current = v
          }
        }
        if (savedMuted === 'true') {
          setMuted(true)
          await TrackPlayer.setVolume(0)
        }
      })
      .then(() => {
        readyRef.current = true
        // Flush a play request that raced with setup (see slug-change effect).
        if (pendingPlayRef.current && userInitiatedRef.current) {
          pendingPlayRef.current = false
          void tryPlay(buildStreamUrl(savedSlugRef.current))
        }
      })
      .catch(() => {})
    setupPromiseRef.current = setupPromise

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Publish the latest now-playing metadata to the OS tray/lock-screen.
   *
   * On native the tray is owned by react-native-track-player (on web the Media
   * Session API does the same job — see useAudioPlayer.web.ts). `setNowPlaying`
   * only records the desired values; this function is what actually pushes
   * them, so it can also be re-run right after a track is added to the queue (a
   * status update that arrived before the first `play()` must not be lost).
   *
   * Best-effort by design: a missing queue or a rejected native call must never
   * interrupt playback.
   */
  const publishNowPlaying = useCallback(async () => {
    try {
      // Never touch TrackPlayer before setupPlayer() resolves.
      if (setupPromiseRef.current) await setupPromiseRef.current
      if (!readyRef.current || !hasQueueRef.current) return
      // On-demand mode owns its tray metadata (`TrackPlayer.add` in `playTrack`);
      // a radio status update must not overwrite it.
      if (modeRef.current === 'track') return

      // Read the desired values AFTER the await: a newer status may have
      // arrived while waiting for setup. The WS can also repeat the same track
      // many times, so skip no-op updates entirely.
      const meta = nowPlayingRef.current
      const published = publishedNowPlayingRef.current
      if (published && published.title === meta.title && published.artist === meta.artist) return

      await TrackPlayer.updateNowPlayingMetadata({
        title: meta.title,
        artist: meta.artist,
        artwork: getArtworkUri(),
      })
      publishedNowPlayingRef.current = { ...meta }
    } catch {
      // Best-effort — a metadata failure must not break playback.
    }
  }, [])

  const tryPlay = useCallback(
    async (url: string) => {
      // Invalidate any in-flight request: this one is now the newest.
      const requestId = ++playRequestRef.current
      try {
        // Never touch TrackPlayer before setupPlayer() resolves.
        if (setupPromiseRef.current) await setupPromiseRef.current
        if (requestId !== playRequestRef.current) return

        currentUrlRef.current = url
        isPlayingRef.current = true
        // A fresh attempt gets a full stall budget and its own progress evidence.
        lastProgressAtRef.current = Date.now()
        progressSeenRef.current = false
        setState('loading')

        await TrackPlayer.reset()
        if (requestId !== playRequestRef.current) return
        await TrackPlayer.add({
          id: url,
          url,
          title: NOW_PLAYING_FALLBACK,
          artist: NOW_PLAYING_FALLBACK,
          artwork: getArtworkUri(),
        })
        if (requestId !== playRequestRef.current) return
        hasQueueRef.current = true
        // `reset()` + `add()` above cleared the tray back to the fallback, so
        // the dedup cache must be invalidated or the real metadata (unchanged
        // since the previous load) would never be restored.
        publishedNowPlayingRef.current = null
        // A now-playing update that arrived before the first play must not be
        // lost: publish the latest known metadata now that a queue exists.
        void publishNowPlaying()
        await TrackPlayer.play()
      } catch (err: any) {
        if (requestId !== playRequestRef.current) return
        setError(err.message || 'Playback error')
        setState('error')
      }
    },
    [publishNowPlaying],
  )

  const play = useCallback(async () => {
    retryCountRef.current = 0
    setError(null)
    userInitiatedRef.current = true

    // In on-demand mode `play` must restart the CURRENT track, not the radio
    // stream: `mode`/`currentTrack` — and the PlayerBar + tray metadata that
    // `playTrack` published — describe the track, so starting radio underneath
    // them would desync the UI from the audio. This is also the user-facing
    // recovery for a failed track load: `playTrack` reports `error` but arms no
    // automatic retry (unlike the radio path).
    if (modeRef.current === 'track' && currentTrack) {
      await playTrackRef.current(currentTrack)
      return
    }

    const slug = currentSlug || 'main'
    savedSlugRef.current = slug
    const url = buildStreamUrl(slug)
    await tryPlay(url)
  }, [currentSlug, buildStreamUrl, tryPlay, currentTrack])

  const pause = useCallback(async () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    isPlayingRef.current = false
    await TrackPlayer.pause()
    setState('paused')
  }, [])

  const toggle = useCallback(async () => {
    if (state === 'playing' || state === 'loading' || state === 'buffering' || state === 'reconnecting') {
      await pause()
    } else {
      await play()
    }
  }, [state, play, pause])

  const playTrack = useCallback(async (track: OnDemandTrack) => {
    // Switch the mode SYNCHRONOUSLY, before any await. The reconnect loop, the
    // buffering watchdog and the slug effect are all gated on
    // `modeRef.current === 'track'`; `setMode()` alone only updates the ref one
    // render later, leaving a window where `reset()` below looks like a dying
    // radio stream and gets answered with a radio retry.
    setMode('track')
    modeRef.current = 'track'

    // A backoff timer scheduled while the radio stream was down must not
    // resurrect the radio source on top of the on-demand track.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    setError(null)
    retryCountRef.current = 0
    // Playback is user-initiated: after an on-demand track, switching substation
    // must actually switch the stream (`userInitiatedRef` gates the slug effect).
    userInitiatedRef.current = true
    savedSlugRef.current = currentSlug || 'main'
    setCurrentTrack(track)
    setState('loading')
    // The track supersedes any radio play that was queued while setup ran.
    pendingPlayRef.current = false

    const url = getTrackStreamUrl(track.id)
    currentUrlRef.current = url
    isPlayingRef.current = true

    const requestId = ++playRequestRef.current
    try {
      // Same discipline as `tryPlay`: on a cold start `setupPlayer()` has not
      // resolved yet and `reset()` would reject with "The player is not
      // initialized. Call setupPlayer first." — which used to be swallowed into
      // an `error` state, so nothing ever played. Wait for setup, don't fail.
      if (setupPromiseRef.current) await setupPromiseRef.current
      if (requestId !== playRequestRef.current) return

      await TrackPlayer.reset()
      if (requestId !== playRequestRef.current) return
      await TrackPlayer.add({
        id: track.id,
        url,
        title: track.title,
        artist: track.artist || undefined,
        duration: track.duration || undefined,
        // Tracks have no artwork of their own — fall back to the app logo.
        artwork: getArtworkUri(),
      })
      if (requestId !== playRequestRef.current) return
      hasQueueRef.current = true
      await TrackPlayer.play()
      if (requestId !== playRequestRef.current) return
      setState('playing')
    } catch (err: any) {
      if (requestId !== playRequestRef.current) return
      setError(err.message || 'Track playback error')
      setState('error')
    }
  }, [currentSlug])

  // Publish the current `playTrack` to `play()` (declared earlier).
  playTrackRef.current = playTrack

  const stopTrack = useCallback(async () => {
    setMode('radio')
    // Synchronous, so the radio-only effects below see the switch immediately
    // instead of one render later (same reasoning as `playTrack`).
    modeRef.current = 'radio'
    setCurrentTrack(null)
    setError(null)
    retryCountRef.current = 0

    const slug = savedSlugRef.current
    const url = buildStreamUrl(slug)
    await tryPlay(url)
  }, [buildStreamUrl, tryPlay])

  // When track ends, return to radio
  useEffect(() => {
    if (modeRef.current === 'track' && playbackState.state === TrackPlayerState.Ended) {
      stopTrack()
    }
  }, [playbackState.state, stopTrack])

  const setVolume = useCallback(async (v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    await TrackPlayer.setVolume(clamped)
    if (clamped > 0) {
      setMuted(false)
      prevVolumeRef.current = clamped
    }
    // Persistence is debounced by VolumeSlider (owns the high-frequency events).
  }, [])

  const toggleMute = useCallback(async () => {
    const newMuted = !muted
    const newVolume = newMuted ? 0 : prevVolumeRef.current || 1
    setMuted(newMuted)
    setVolumeState(newVolume)
    await TrackPlayer.setVolume(newMuted ? 0 : newVolume)
    storage.setItem(STORAGE_KEYS.MUTED, String(newMuted))
  }, [muted])

  // Feed now-playing metadata into the OS tray/lock-screen. The stream status
  // arrives over WebSocket (`app/index.tsx` watches `status.trackTitle` /
  // `status.trackArtist`); react-native-track-player owns the system controls
  // and is the only way to display it on native. Same platform-agnostic API as
  // the web hook, which implements this with the Media Session API.
  const setNowPlaying = useCallback(
    (meta: NowPlayingMeta) => {
      // `trackTitle`/`trackArtist` arrive over the WebSocket (untrusted), so
      // control characters are stripped and the length is capped before they
      // reach the Android notification. Fall back to the app name so the tray
      // card is never blank (idle / live without metadata).
      nowPlayingRef.current = {
        title: sanitizeMediaText(meta.title) ?? NOW_PLAYING_FALLBACK,
        artist: sanitizeMediaText(meta.artist) ?? NOW_PLAYING_FALLBACK,
      }
      void publishNowPlaying()
    },
    [publishNowPlaying],
  )

  // Reconnect on error with exponential backoff
  useEffect(() => {
    if (modeRef.current === 'track') return
    if (state === 'error' && isPlayingRef.current) {
      const delay = Math.min(2000 * Math.pow(2, retryCountRef.current), MAX_RETRY_DELAY)
      retryCountRef.current += 1

      retryTimerRef.current = setTimeout(() => {
        const slug = currentSlug || 'main'
        const url = buildStreamUrl(slug)
        tryPlay(url)
      }, delay)

      if (retryCountRef.current > 3) {
        setState('reconnecting')
      }
    }
  }, [state, currentSlug, buildStreamUrl, tryPlay])

  // Safety net: buffering timeout
  useEffect(() => {
    if (state !== 'buffering' || modeRef.current === 'track') return
    const timer = setTimeout(() => setState('error'), 10_000)
    return () => clearTimeout(timer)
  }, [state])

  // Stall watchdog (radio mode). The reconnect effect above only fires on an
  // explicit `state === 'error'`; the buffering net only on `state ===
  // 'buffering'`. A stream that goes silent without either state — an
  // unintended Pause (audio-focus loss, OS/decoder hiccup) or a frozen position
  // while RNTP still reports Playing — has no escalation and stays silent until
  // the app is restarted. Keep retrying while the user intends to play.
  //
  // Deliberately conservative to avoid churn on streams that never report a
  // position: escalate only after STALL_TIMEOUT of no progress AND (position
  // advanced at some point for this load, or RNTP explicitly says Paused).
  // Setting `state = 'error'` funnels into the existing backoff chain above
  // rather than arming a second, competing timer.
  useEffect(() => {
    const id = setInterval(() => {
      if (!isPlayingRef.current || modeRef.current === 'track') return
      if (!appActiveRef.current) return
      if (retryTimerRef.current) return

      if (Date.now() - lastProgressAtRef.current <= STALL_TIMEOUT) return

      const ps = playbackStateRef.current
      if (ps !== TrackPlayerState.Paused && !progressSeenRef.current) return

      setError('Stream stalled — reconnecting...')
      setState('error')
    }, WATCHDOG_INTERVAL)
    return () => clearInterval(id)
  }, [])

  // React to slug changes.
  // - On mount (or whenever the user hasn't started playback) do NOT auto-start:
  //   just remember the URL so the next user-initiated play uses the new slug.
  // - While playing, switch to the new substation's stream.
  // - If setup hasn't finished yet, defer the switch via pendingPlayRef.
  useEffect(() => {
    if (modeRef.current === 'track') return
    retryCountRef.current = 0
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    const slug = currentSlug || 'main'
    const url = buildStreamUrl(slug)
    currentUrlRef.current = url
    savedSlugRef.current = slug

    if (!userInitiatedRef.current || !isPlayingRef.current) return

    if (readyRef.current) {
      tryPlay(url)
    } else {
      pendingPlayRef.current = true
    }
  }, [currentSlug, buildStreamUrl, tryPlay])

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
    position,
    duration,
    setNowPlaying,
  }
}

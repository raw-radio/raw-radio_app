import { useState, useEffect, useRef, useCallback } from 'react'
import { storage, STORAGE_KEYS } from './useStorage'
import { getTrackStreamUrl } from '../api/client'
import type { PlayerState, PlayerMode, OnDemandTrack, NowPlayingMeta } from '../types'

const MAX_RETRY_DELAY = 30000
const BUFFERING_TIMEOUT = 10_000

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
      if (modeRef.current === 'track') {
        setTrackProgress({
          currentTime: audio.currentTime,
          duration: audio.duration && isFinite(audio.duration) ? audio.duration : 0,
        })
      }
    })

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
    })

    audioRef.current = audio
  }, [])

  const tryPlay = useCallback((url: string) => {
    const audio = audioRef.current
    if (!audio) return

    currentUrlRef.current = url
    isPlayingRef.current = true
    setState('loading')

    // Cache-bust stream URL to bypass browser Media Cache on retry/reconnect
    const separator = url.includes('?') ? '&' : '?'
    audio.src = `${url}${separator}_cb=${Date.now()}`
    audio.play().catch((err: any) => {
      if (err?.name === 'NotAllowedError') {
        // Autoplay blocked — wait for the user gesture / visibility resume.
        // Do not enter error state, otherwise the reconnect loop spins forever.
        return
      }
      if (err?.name !== 'AbortError') {
        setError(err?.message || 'Playback error')
        setState('error')
      }
    })
  }, [])

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
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const audio = audioRef.current
        if (audio && isPlayingRef.current && audio.paused) {
          audio.play().catch((err: any) => {
            if (err?.name !== 'AbortError') {
              console.warn('Resume playback failed:', err)
            }
          })
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  const play = useCallback(() => {
    if (!audioRef.current) return
    retryCountRef.current = 0
    setError(null)
    tryPlay(buildStreamUrl(savedSlugRef.current))
  }, [tryPlay, buildStreamUrl])

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
        if (err?.name === 'NotAllowedError') return
        if (err?.name !== 'AbortError') {
          setError(err?.message || 'Track playback error')
          setState('error')
        }
      })
    },
    [slug],
  )

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
    setNowPlayingState((prev) =>
      prev.title === (meta.title ?? null) && prev.artist === (meta.artist ?? null)
        ? prev
        : { title: meta.title ?? null, artist: meta.artist ?? null },
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

  // Infinite reconnect with exponential backoff (radio mode only)
  useEffect(() => {
    if (modeRef.current === 'track') return

    if (state === 'error' && isPlayingRef.current) {
      const delay = Math.min(2000 * Math.pow(2, retryCountRef.current), MAX_RETRY_DELAY)
      retryCountRef.current += 1

      retryTimerRef.current = setTimeout(() => {
        tryPlay(buildStreamUrl(savedSlugRef.current))
      }, delay)

      if (retryCountRef.current > 3) {
        setState('reconnecting')
      }
    }
  }, [state, tryPlay, buildStreamUrl])

  // Safety net: buffering for too long escalates to error -> reconnect
  useEffect(() => {
    if (state !== 'buffering' || modeRef.current === 'track') return
    const timer = setTimeout(() => setState('error'), BUFFERING_TIMEOUT)
    return () => clearTimeout(timer)
  }, [state])

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

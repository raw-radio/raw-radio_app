import { useState, useEffect, useRef, useCallback } from 'react'
import TrackPlayer, {
  State as TrackPlayerState,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player'
import { storage, STORAGE_KEYS } from './useStorage'
import { getTrackStreamUrl } from '../api/client'
import type { PlayerState, PlayerMode, OnDemandTrack } from '../types'

const MAX_RETRY_DELAY = 30000

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
    if (modeRef.current === 'track') return
    const ps = playbackState.state
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
  }, [playbackState.state])

  // Initialize TrackPlayer once
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    TrackPlayer.setupPlayer({ waitForBuffer: true })
      .then(async () => {
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
      .catch(() => {})

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  const tryPlay = useCallback(async (url: string) => {
    try {
      currentUrlRef.current = url
      isPlayingRef.current = true
      setState('loading')

      await TrackPlayer.reset()
      await TrackPlayer.add({
        id: url,
        url,
        title: 'RAW Radio',
        artist: '',
      })
      await TrackPlayer.play()
    } catch (err: any) {
      setError(err.message || 'Playback error')
      setState('error')
    }
  }, [])

  const play = useCallback(async () => {
    retryCountRef.current = 0
    setError(null)
    const slug = currentSlug || 'main'
    const url = buildStreamUrl(slug)
    await tryPlay(url)
  }, [currentSlug, buildStreamUrl, tryPlay])

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
    try {
      setError(null)
      retryCountRef.current = 0
      savedSlugRef.current = currentSlug || 'main'

      setMode('track')
      setCurrentTrack(track)

      const url = getTrackStreamUrl(track.id)
      currentUrlRef.current = url
      isPlayingRef.current = true

      await TrackPlayer.reset()
      await TrackPlayer.add({
        id: track.id,
        url,
        title: track.title,
        artist: track.artist || undefined,
        duration: track.duration || undefined,
      })
      await TrackPlayer.play()
      setState('playing')
    } catch (err: any) {
      setError(err.message || 'Track playback error')
      setState('error')
    }
  }, [currentSlug])

  const stopTrack = useCallback(async () => {
    setMode('radio')
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
    storage.setItem(STORAGE_KEYS.VOLUME, String(clamped))
  }, [])

  const toggleMute = useCallback(async () => {
    const newMuted = !muted
    const newVolume = newMuted ? 0 : prevVolumeRef.current || 1
    setMuted(newMuted)
    setVolumeState(newVolume)
    await TrackPlayer.setVolume(newMuted ? 0 : newVolume)
    storage.setItem(STORAGE_KEYS.MUTED, String(newMuted))
  }, [muted])

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

  // Re-init audio when slug changes
  useEffect(() => {
    if (modeRef.current === 'track') return
    retryCountRef.current = 0
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    const url = buildStreamUrl(currentSlug || 'main')
    tryPlay(url)
  }, [currentSlug])

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
  }
}

import { useEffect, useState, useRef, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { StreamStatus } from '../types'

const SOCKET_URL = process.env.EXPO_PUBLIC_WS_URL || ''

const INITIAL_STATUS: StreamStatus = {
  type: 'offline',
  substationId: null,
  trackTitle: null,
  trackArtist: null,
  djName: null,
  listeners: 0,
  startedAt: null,
  duration: null,
}

function isForActiveSubstation(
  data: { substationId?: string | null; substationSlug?: string | null } | null | undefined,
  activeSlug?: string | null,
): boolean {
  if (!activeSlug) return true
  if (!data) return false
  if (data.substationSlug) return data.substationSlug === activeSlug
  if (!data.substationId) return false
  return data.substationId === activeSlug
}

export function useStreamStatus(activeSlug?: string) {
  const [status, setStatus] = useState<StreamStatus>(INITIAL_STATUS)
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const activeSlugRef = useRef(activeSlug)
  activeSlugRef.current = activeSlug

  const handleTrackChange = useCallback(
    (data: { substationId?: string; substationSlug?: string; trackTitle?: string | null; trackArtist?: string | null }) => {
      if (!isForActiveSubstation(data, activeSlugRef.current)) return
      setStatus((prev) => ({
        ...prev,
        trackTitle: data.trackTitle ?? prev.trackTitle,
        trackArtist: data.trackArtist ?? prev.trackArtist,
      }))
    },
    [],
  )

  const handleNowPlaying = useCallback(
    (data: { substationId?: string; substationSlug?: string; trackTitle?: string | null; trackArtist?: string | null; source?: string; djName?: string | null; duration?: number | null }) => {
      if (!isForActiveSubstation(data, activeSlugRef.current)) return
      setStatus((prev) => ({
        ...prev,
        substationId: data.substationId ?? prev.substationId,
        type: data.source ? (data.source === 'live' ? 'live' : 'auto') : prev.type,
        trackTitle: data.trackTitle ?? null,
        trackArtist: data.trackArtist ?? null,
        djName: data.djName ?? null,
        duration: data.duration ?? null,
      }))
    },
    [],
  )

  const handleDjChange = useCallback(
    (data: { djName: string | null; substationId?: string; substationSlug?: string }) => {
      if (!isForActiveSubstation(data, activeSlugRef.current)) return
      setStatus((prev) => ({
        ...prev,
        djName: data.djName ?? prev.djName,
        type: data.djName ? 'live' : 'auto',
      }))
    },
    [],
  )

  const handleAdminStats = useCallback((data: { listeners: number | Record<string, number>; count?: number }) => {
    let count = 0
    if (typeof data.listeners === 'object' && data.listeners !== null) {
      count = data.listeners['main'] ?? 0
    } else if (typeof data.listeners === 'number') {
      count = data.listeners
    } else if (typeof data.count === 'number') {
      count = data.count
    }
    setStatus((prev) => (prev.listeners === count ? prev : { ...prev, listeners: count }))
  }, [])

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    })
    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('stream:status', (dto: StreamStatus) => {
      if (!isForActiveSubstation(dto, activeSlugRef.current)) return
      setStatus((prev) => ({
        ...prev,
        type: dto.type === 'offline' ? 'offline' : prev.type,
        substationId: dto.substationId ?? prev.substationId,
        trackTitle: prev.trackTitle ?? dto.trackTitle,
        trackArtist: prev.trackArtist ?? dto.trackArtist,
        djName: dto.djName ?? prev.djName,
        listeners: dto.listeners ?? prev.listeners,
        startedAt: dto.startedAt ?? prev.startedAt,
        duration: dto.duration ?? prev.duration,
      }))
    })
    socket.on('stream:now-playing', handleNowPlaying)
    socket.on('stream:track-change', handleTrackChange)
    socket.on('stream:dj-change', handleDjChange)
    socket.on('admin:stats-update', handleAdminStats)

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [handleNowPlaying, handleTrackChange, handleDjChange, handleAdminStats])

  const refreshNowPlaying = useCallback(() => {
    const slug = activeSlugRef.current ?? null
    if (!slug) return
    const base = process.env.EXPO_PUBLIC_API_URL || ''
    fetch(`${base}/api/v1/playlist/now-playing?substationId=${encodeURIComponent(slug)}`)
      .then((res) => res.json())
      .then((entry) => {
        const data = entry?.data || entry
        if (data) {
          setStatus((prev) => ({
            ...prev,
            trackTitle: data.title ?? data.trackTitle ?? null,
            trackArtist: data.artist ?? data.trackArtist ?? null,
          }))
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activeSlug) refreshNowPlaying()
  }, [activeSlug, refreshNowPlaying])

  return { status, connected, refreshNowPlaying }
}

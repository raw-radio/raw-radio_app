import { useState, useEffect, useRef, useCallback } from 'react'
import { searchTracks } from '../api/client'

export function useTrackSearch(query: string) {
  const [tracks, setTracks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const pageRef = useRef(1)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflightRef = useRef(0)

  const performSearch = useCallback(async (searchQuery: string, page: number) => {
    const requestId = ++inflightRef.current
    setLoading(true)
    setError(null)

    try {
      const result = await searchTracks({ search: searchQuery, page, limit: 20, isActive: true })
      if (requestId !== inflightRef.current) return

      if (page === 1) {
        setTracks(result.items)
      } else {
        setTracks((prev) => [...prev, ...result.items])
      }
      setTotal(result.total)
      setHasMore(result.page < result.totalPages)
    } catch (err) {
      if (requestId !== inflightRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to search tracks')
    } finally {
      if (requestId === inflightRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    const trimmed = query.trim()

    if (!trimmed) {
      setTracks([])
      setTotal(0)
      setHasMore(false)
      setError(null)
      pageRef.current = 1
      return
    }

    debounceTimerRef.current = setTimeout(() => {
      pageRef.current = 1
      performSearch(trimmed, 1)
    }, 300)

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [query, performSearch])

  const loadMore = useCallback(() => {
    const trimmed = query.trim()
    if (!trimmed || loading || !hasMore) return
    pageRef.current += 1
    performSearch(trimmed, pageRef.current)
  }, [query, loading, hasMore, performSearch])

  const reset = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    inflightRef.current += 1
    setTracks([])
    setTotal(0)
    setHasMore(false)
    setError(null)
    setLoading(false)
    pageRef.current = 1
  }, [])

  return { tracks, loading, error, total, hasMore, loadMore, reset }
}

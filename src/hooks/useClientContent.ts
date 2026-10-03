import { useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { PromoBlock } from '../components/content/types'

/**
 * Client Content CMS — live promo pages.
 *
 * `app/` is a standalone Expo repository (not an npm workspace), so the DTOs
 * from `@raw-radio/shared` are mirrored here. Only the fields the client
 * consumes are declared; keep them in sync with the shared source of truth
 * (`packages/shared/src/index.ts`).
 *
 * The block payload itself is typed by the local renderer mirror
 * (`../components/content/types`), so `PromoContentDTO.blocks` stays assignable
 * to `<PageContent blocks={…} />`.
 */

/** Prompt shown as a banner above the player — `GET /api/v1/content/active`. */
export interface ActivePromoDTO {
  id: string
  slug: string
  /** URL namespace of the page — the `[prefix]` segment in `/:prefix/:slug`. */
  routePrefix: string
  buttonLabel: string
  buttonEnabled: boolean
}

/** Full published promo page — `GET /api/v1/content/:slug`. */
export interface PromoContentDTO {
  id: string
  slug: string
  /** URL namespace of the page — the `[prefix]` segment in `/:prefix/:slug`. */
  routePrefix: string
  title: string
  buttonLabel: string
  buttonEnabled: boolean
  blocks: PromoBlock[]
  status: 'draft' | 'published'
  startAt: string | null
  endAt: string | null
  pageTitle: string | null
  pageDescription: string | null
  createdAt: string
  updatedAt: string
}

/** `client-content:update` payload (room `listeners`). */
export interface ClientContentUpdatePayload {
  promos: ActivePromoDTO[]
}

const SOCKET_URL = process.env.EXPO_PUBLIC_WS_URL || ''
const API_BASE = process.env.EXPO_PUBLIC_API_URL || ''

/** WS event name — mirrors `WSEvent.CLIENT_CONTENT_UPDATE` in shared. */
const CLIENT_CONTENT_UPDATE = 'client-content:update'

/**
 * One-shot fetch of the active promo list. Resolves to `null` on any failure
 * (offline / non-JSON / malformed payload) so callers can leave the current
 * list untouched instead of clearing the banner.
 */
async function fetchActivePromos(): Promise<ActivePromoDTO[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/content/active`)
    const data = await res.json()
    if (data?.success && Array.isArray(data.data)) {
      return data.data as ActivePromoDTO[]
    }
  } catch {
    // Offline / non-JSON — leave the list empty, the banner simply hides.
  }
  return null
}

export interface UseClientContentResult {
  promos: ActivePromoDTO[]
  isLoading: boolean
}

/**
 * Live list of active promo pages. Mirrors the `useChat` pattern: one initial
 * REST fetch, then a socket subscription that replaces the whole list on every
 * `client-content:update`. The public socket auto-joins the `listeners` room on
 * the server, so no explicit subscription is needed.
 *
 * The socket also refetches on every (re)connect: updates emitted while the
 * client was offline are not replayed, so the REST snapshot is the only way to
 * catch up after a dropped connection.
 */
export function useClientContent(): UseClientContentResult {
  const [promos, setPromos] = useState<ActivePromoDTO[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    fetchActivePromos()
      .then((list) => {
        if (cancelled || !list) return
        setPromos(list)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    })

    const handleUpdate = (payload: ClientContentUpdatePayload) => {
      if (Array.isArray(payload?.promos)) {
        setPromos(payload.promos)
      }
    }

    // Fires on the initial connect and on every reconnect — refetch so a
    // `client-content:update` missed while offline is picked up.
    const handleConnect = () => {
      void fetchActivePromos().then((list) => {
        if (list) setPromos(list)
      })
    }

    socket.on(CLIENT_CONTENT_UPDATE, handleUpdate)
    socket.on('connect', handleConnect)

    return () => {
      socket.off(CLIENT_CONTENT_UPDATE, handleUpdate)
      socket.off('connect', handleConnect)
      socket.disconnect()
    }
  }, [])

  return { promos, isLoading }
}

export interface UsePromoPageResult {
  page: PromoContentDTO | null
  isLoading: boolean
  /** Server answered 404 — missing, draft, or outside its [startAt, endAt] window. */
  notFound: boolean
  /** Network / malformed-response failure. Mutually exclusive with `notFound`. */
  error: string | null
}

/**
 * Loads a single published promo page by slug and verifies it belongs to the
 * URL's `prefix` namespace. The server hides draft pages behind a 404, so a
 * non-published page is indistinguishable from a missing one (both surface as
 * `notFound`) — this hook never asks for drafts.
 *
 * A page whose `routePrefix` does not match the requested `prefix` is treated
 * as `notFound` too, so `/:anything/<slug>` can never resolve a page that was
 * published under a different namespace.
 */
export function usePromoPage(
  slug: string | undefined,
  prefix: string | undefined,
): UsePromoPageResult {
  const [page, setPage] = useState<PromoContentDTO | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug || !prefix) {
      setPage(null)
      setNotFound(true)
      setError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setNotFound(false)
    setError(null)

    fetch(`${API_BASE}/api/v1/content/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (cancelled) return
          setPage(null)
          setNotFound(true)
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const data = await res.json()
        if (cancelled) return
        if (data?.success && data.data) {
          const loaded = data.data as PromoContentDTO
          if (loaded.routePrefix !== prefix) {
            setPage(null)
            setNotFound(true)
            return
          }
          setPage(loaded)
        } else {
          setNotFound(true)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить страницу')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug, prefix])

  return { page, isLoading, notFound, error }
}

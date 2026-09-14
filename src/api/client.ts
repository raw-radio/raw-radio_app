import { storage } from '../hooks/useStorage'

const API_BASE = process.env.EXPO_PUBLIC_API_URL || ''
const STORAGE_KEY_TOKEN = 'raw_radio_token'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`
  const token = await storage.getItem(STORAGE_KEY_TOKEN)
  const method = options?.method || 'GET'
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method)

  const headers: Record<string, string> = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(options?.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, { ...options, headers })

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) errorMsg = body.error
      else if (body?.message) errorMsg = body.message
    } catch {
      // ignore
    }
    throw new Error(errorMsg)
  }

  const json = await res.json()
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    return json.data as T
  }
  return json as T
}

export const apiClient = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
}

export async function getNowPlaying(substationId?: string): Promise<any | null> {
  const params = substationId ? `?substationId=${encodeURIComponent(substationId)}` : ''
  return request<any | null>(`/api/v1/playlist/now-playing${params}`)
}

export interface TrackSearchParams {
  search?: string
  genreId?: string
  page?: number
  limit?: number
  isActive?: boolean
}

export async function searchTracks(params: TrackSearchParams = {}): Promise<any> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.genreId) query.set('genreId', params.genreId)
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.isActive !== undefined) query.set('isActive', String(params.isActive))
  const qs = query.toString()
  return request<any>(`/api/v1/tracks${qs ? `?${qs}` : ''}`)
}

export function getTrackStreamUrl(trackId: string): string {
  return `${API_BASE}/api/v1/tracks/${trackId}/stream`
}

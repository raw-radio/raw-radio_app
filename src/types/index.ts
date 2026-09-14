/** Player state */
export type PlayerState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'error'
  | 'offline'
  | 'reconnecting'

export type StreamType = 'live' | 'auto' | 'offline'

export interface StreamStatus {
  type: StreamType
  substationId: string | null
  trackTitle: string | null
  trackArtist: string | null
  djName: string | null
  listeners: number
  startedAt: string | null
  duration: number | null
}

export interface ListenerStats {
  count: number
  timestamp: string
}

export interface OnDemandTrack {
  id: string
  title: string
  artist: string | null
  duration: number | null
}

export type PlayerMode = 'radio' | 'track'

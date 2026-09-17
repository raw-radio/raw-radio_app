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

/**
 * Now-playing metadata consumed by the OS media session.
 * On web it feeds the Media Session API; on native it is a no-op because
 * react-native-track-player drives the system controls.
 */
export interface NowPlayingMeta {
  title: string | null
  artist: string | null
}

export type PlayerMode = 'radio' | 'track'

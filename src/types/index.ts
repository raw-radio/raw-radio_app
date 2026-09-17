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
 * On web it feeds the Media Session API; on native it is pushed to the Android
 * notification via react-native-track-player's `updateNowPlayingMetadata`.
 */
export interface NowPlayingMeta {
  title: string | null
  artist: string | null
}

export type PlayerMode = 'radio' | 'track'

/**
 * A newer Android build published on GitHub Releases (the sideload source of
 * truth). `current` is the installed `versionName`, `latest` is the release
 * tag's version and `apkUrl` is the `raw-radio-universal.apk` asset URL.
 */
export interface AppUpdateInfo {
  current: string
  latest: string
  apkUrl: string
}

import TrackPlayer, { Event } from 'react-native-track-player'
import { switchStation } from './stationSwitcher'
import { getArtworkUri } from '../utils/artwork'

// Fallback label so the notification / lock-screen card is never blank while
// the new station's now-playing metadata is still loading over the WebSocket.
const FALLBACK_TITLE = 'RAW Radio'

/**
 * On-demand tracks stream from the API at `${API_BASE}/api/v1/tracks/{id}/stream`
 * (`getTrackStreamUrl`); live stations stream at `.../{slug}.mp3`
 * (`stationSwitcher.buildStreamUrl`). The two have opposite resume semantics, so
 * the headless service — which has no React state to consult — tells them apart
 * by URL. Matching the path keeps this correct for both the relative
 * (`EXPO_PUBLIC_API_URL` empty) and absolute deployments.
 */
function isOnDemandTrackUrl(url: string | undefined | null): boolean {
  return !!url && /\/api\/v1\/tracks\/[^/]+\/stream/.test(url)
}

/**
 * Resumes the current queue item with the semantics its type requires.
 *
 * Live radio: a plain `TrackPlayer.play()` resumes from ExoPlayer's buffered
 * position, which after a pause sits behind the live edge — audio then drifts
 * away from the now-playing metadata (delivered live over the WebSocket). That
 * desync is exactly what this fixes. Rebuild the single-item queue
 * (`reset()` → `add()` → `play()`) so the decoder reconnects at the live edge;
 * the 1–3s gap on resume is the accepted trade-off. `reset()` is awaited before
 * `add()` so the old item's buffer is dropped first.
 *
 * On-demand tracks: keep normal resume — continue from the stored position.
 *
 * Best-effort by design: never throws, so a failed resume can never take the
 * playback service down.
 */
async function resumeFromLiveEdge(): Promise<void> {
  let active: Awaited<ReturnType<typeof TrackPlayer.getActiveTrack>>
  try {
    active = await TrackPlayer.getActiveTrack()
  } catch {
    active = undefined
  }

  const url = active?.url
  if (url && !isOnDemandTrackUrl(url)) {
    try {
      await TrackPlayer.reset()
      await TrackPlayer.add({
        id: url,
        url,
        title: active?.title || FALLBACK_TITLE,
        artist: active?.artist || FALLBACK_TITLE,
        artwork: getArtworkUri(),
      })
      await TrackPlayer.play()
      return
    } catch {
      // Rebuild failed — fall through to the plain resume below as a last
      // resort (e.g. no network for the fresh connection).
    }
  }

  try {
    await TrackPlayer.play()
  } catch {
    // Best-effort — an empty/failed queue must not crash the service.
  }
}

/**
 * Headless playback service: reacts to the OS media controls (notification /
 * lock-screen / Bluetooth). Runs without React, so it owns no hook state.
 *
 * Play/Pause/Stop drive the transport directly. Previous/Next do NOT use
 * `skipToNext()` / `skipToPrevious()`: the queue always holds a single live
 * stream, so those are no-ops. They cycle stations instead (with wraparound) via
 * `switchStation`, which persists the new selection and notifies the UI.
 *
 * Every promise is awaited and caught — an unhandled rejection here would be a
 * crash / silent failure in the playback service.
 */
export async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause().catch(() => {})
  })

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    // Live-edge reload for radio; a normal resume for an on-demand track.
    void resumeFromLiveEdge()
  })

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void TrackPlayer.stop().catch(() => {})
  })

  // Cyclic station switching: first ← → last, last → → first.
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void switchStation(1).catch(() => {})
  })

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void switchStation(-1).catch(() => {})
  })

  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    try {
      if (event.paused) {
        await TrackPlayer.pause()
      } else if (event.permanent) {
        await TrackPlayer.stop()
      } else {
        // End of a transient duck / interruption: same live-edge semantics as a
        // notification resume — radio must rejoin the live edge, a track resumes
        // from its position.
        await resumeFromLiveEdge()
      }
    } catch {
      // Best-effort — a failed duck transition must not take the service down.
    }
  })
}

import TrackPlayer, { Event } from 'react-native-track-player'
import { switchStation } from './stationSwitcher'

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
    void TrackPlayer.play().catch(() => {})
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
        await TrackPlayer.play()
      }
    } catch {
      // Best-effort — a failed duck transition must not take the service down.
    }
  })
}

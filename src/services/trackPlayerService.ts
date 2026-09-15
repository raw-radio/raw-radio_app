import TrackPlayer, { Event } from 'react-native-track-player'

export async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause()
  })

  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play()
  })

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.stop()
  })

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    TrackPlayer.skipToNext()
  })

  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    TrackPlayer.skipToPrevious()
  })

  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    if (event.paused) {
      await TrackPlayer.pause()
    } else if (event.permanent) {
      await TrackPlayer.stop()
    } else {
      await TrackPlayer.play()
    }
  })
}

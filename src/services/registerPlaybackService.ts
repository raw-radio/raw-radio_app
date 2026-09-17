import TrackPlayer from 'react-native-track-player'
import { playbackService } from './trackPlayerService'

// Must run at module scope, before TrackPlayer.setupPlayer()
TrackPlayer.registerPlaybackService(() => playbackService)

import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import TrackPlayer from 'react-native-track-player'
import { playbackService } from '../src/services/trackPlayerService'

// Register the playback service at module scope so it is wired up BEFORE
// TrackPlayer.setupPlayer() runs (setup happens in useAudioPlayer's effect).
// Without this, remote events (notification pause/play/skip) update the
// notification UI but never reach the player.
TrackPlayer.registerPlaybackService(() => playbackService)

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0d0d0d' },
          }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
})

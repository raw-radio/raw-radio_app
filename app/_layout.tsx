import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

// Register the playback service at module scope so it is wired up BEFORE
// TrackPlayer.setupPlayer() runs (setup happens in useAudioPlayer's effect).
// Without this, remote events (notification pause/play/skip) update the
// notification UI but never reach the player.
//
// This import intentionally has NO file extension: _layout.tsx is shared
// between web and native, so Metro resolves the platform variant —
// registerPlaybackService.ts (native, RNTP) vs registerPlaybackService.web.ts
// (web no-op). Web must not pull in react-native-track-player: its web path
// depends on shaka-player, which is unreliable for live ICY/MP3 radio.
import '../src/services/registerPlaybackService'

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

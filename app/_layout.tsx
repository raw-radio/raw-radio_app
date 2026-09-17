import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
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

// Same platform-split trick: oneSignal.ts (native, react-native-onesignal)
// vs oneSignal.web.ts (intentional no-op — the SDK does not support RN Web).
import { initOneSignal } from '../src/services/oneSignal'

/**
 * Only in-app deep links are acceptable as a push navigation target.
 * Rejects absolute URLs (`https://…`), protocol-relative URLs (`//evil.com`)
 * and anything that is not a plain `/path` — the tap payload is remote input.
 */
function isSafeInternalUrl(url: string | null): url is string {
  return !!url && /^\/(?!\/)/.test(url)
}

export default function RootLayout() {
  const router = useRouter()

  useEffect(() => {
    const appId = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID || ''
    if (!appId) return

    const unsubscribe = initOneSignal(appId, (url) => {
      if (!isSafeInternalUrl(url)) return
      try {
        router.push(url)
      } catch {
        // Malformed target — ignore the tap rather than crash the app.
      }
    })

    return unsubscribe
  }, [router])

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

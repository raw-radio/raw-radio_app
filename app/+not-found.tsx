import { Redirect } from 'expo-router'

/**
 * Catch-all for any path the router cannot match.
 *
 * Without this route Expo Router renders its built-in `Unmatched` component,
 * which on a standalone build tries to build a deep-link URL and throws
 * `Cannot make a deep link into a standalone app with no custom scheme defined`
 * — a FATAL JS crash that kills the JS thread. That is exactly what a tap on
 * the media notification used to trigger: react-native-track-player sets the
 * notification content intent's data to `trackplayer://notification.click`
 * (MusicService.kt:104), React Native hands that URI to the router, no route
 * matches, and the app crashed back to the launcher.
 *
 * Silently replace with the home screen: an unknown / stale / third-party
 * deep-link must never surface an error screen or take the player down.
 */
export default function NotFoundScreen() {
  return <Redirect href="/" />
}

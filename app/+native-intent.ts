import type { NativeIntent } from 'expo-router'

/**
 * Normalises native deep links before Expo Router matches them.
 *
 * Two classes of incoming URLs need handling:
 *
 * 1. `trackplayer://…` — react-native-track-player sets the media notification /
 *    lock-screen content intent's data to `trackplayer://notification.click`
 *    (and `trackplayer://service-bound` when it self-wakes the activity) —
 *    see `android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt:104,768`.
 *    These are sentinels, not routes: without this rewrite the router sees the
 *    path `notification.click`, matches nothing and (before `+not-found` existed)
 *    crashed with "Cannot make a deep link into a standalone app with no custom
 *    scheme defined". Rewrite them to `/` so the tap simply opens the player.
 *
 * 2. `rawradio://…` — our own scheme (declared in `app.json`). Strip the scheme
 *    so `rawradio://copyright` becomes the `/copyright` route instead of relying
 *    on Expo Router's host-as-path heuristic.
 *
 * Everything else (https universal links, plain `/path`, OneSignal pushes that
 * are routed through `router.push`) is returned untouched. Never throws — a
 * malformed URL must not take the app down (the docs explicitly warn that a
 * throw here crashes the app).
 */
export const redirectSystemPath: NonNullable<NativeIntent['redirectSystemPath']> = ({ path }) => {
  try {
    if (!path) return '/'

    if (path.startsWith('trackplayer://')) return '/'

    if (path.startsWith('rawradio://')) {
      const rest = path.slice('rawradio://'.length)
      return rest ? '/' + rest.replace(/^\/+/, '') : '/'
    }

    return path
  } catch {
    return '/'
  }
}

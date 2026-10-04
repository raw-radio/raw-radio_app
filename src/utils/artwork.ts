import { Image, Platform } from 'react-native'
import Constants from 'expo-constants'

/**
 * URI of the square 1024×1024 app icon (`assets/icon.png`), used as the
 * tray/lock-screen artwork of the radio stream (tracks have no artwork of their
 * own).
 *
 * `Image.resolveAssetSource` turns a `require()`d bundled asset into the URI
 * string that `updateNowPlayingMetadata` accepts. Caveat: in a **release
 * Android** build the JS bundle is loaded from the APK (not a `file://` path),
 * so React Native resolves the asset to a bare AAPT resource name — for this
 * asset `assets_icon` (emitted as `drawable-mdpi/assets_icon.png`) — with no
 * URI scheme, and Media3's Coil bitmap loader cannot load a scheme-less URI.
 * It is therefore rewritten to an `android.resource://` URI. In development the
 * resolved URI is an http URL and is used as-is.
 *
 * Resolved once per process and cached. Best-effort: never throws.
 */
let artworkUriCache: string | null | undefined

export function getArtworkUri(): string | undefined {
  if (artworkUriCache !== undefined) return artworkUriCache ?? undefined

  try {
    // A static import cannot be used here: TypeScript has no `*.png` module
    // declaration in this project, so `require` is the RN-idiomatic way to
    // reference the bundled asset.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const resolved = Image.resolveAssetSource(require('../../assets/icon.png'))
    let uri = resolved?.uri
    if (uri && Platform.OS === 'android' && !/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
      const pkg = Constants.expoConfig?.android?.package
      if (pkg) uri = `android.resource://${pkg}/drawable/${uri}`
    }
    artworkUriCache = uri || null
  } catch {
    artworkUriCache = null
  }

  return artworkUriCache ?? undefined
}

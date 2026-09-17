/**
 * Android APK download URL — intentionally EMPTY on native.
 *
 * The download link is web-only (Android/iOS users already run the app), and
 * the URL is a static string literal: keeping it in a module that the native
 * bundle resolves would ship it inside the Hermes bytecode even though no
 * native code path can reach it (the handler goes through `useCallback`, which
 * the optimizer cannot drop). Metro resolves `androidAppDownload.web.ts` for
 * web and this file for android/ios, so the literal never enters the native
 * bundle at all.
 *
 * Empty value is safe: `handleDownloadAndroidApp` in `app/index.tsx` is only
 * reachable behind `Platform.OS === 'web'`.
 */
export const ANDROID_APP_DOWNLOAD_URL = ''

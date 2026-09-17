/**
 * Android APK download — the stable GitHub "latest release" asset URL.
 *
 * The asset NAME (`raw-radio-universal.apk`) is load-bearing: the link resolves
 * to whatever release is currently tagged `latest`, but the file inside it must
 * keep this exact name. Renaming the artifact in a future release breaks this
 * link.
 *
 * Web-only by construction — see `androidAppDownload.ts` for the native
 * counterpart (and why the URL must not live in a shared module).
 */
export const ANDROID_APP_DOWNLOAD_URL =
  'https://github.com/raw-radio/raw-radio_app/releases/latest/download/raw-radio-universal.apk'

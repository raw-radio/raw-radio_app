import type { AppUpdateInfo } from '../types'

/**
 * Web variant of the sideloaded-APK updater — an intentional no-op.
 *
 * The browser build keeps the plain `Скачать APK` link (`ANDROID_APP_DOWNLOAD_URL`)
 * and never reports an update, so the Android-only modules (`expo-file-system`,
 * `expo-intent-launcher`) are never pulled into the web bundle.
 */

/** Always `null`: a web tab cannot (and should not) install an APK. */
export async function checkForUpdate(): Promise<AppUpdateInfo | null> {
  return null
}

/** No-op on web — the download link is handled by the caller. */
export async function downloadAndInstall(_apkUrl: string): Promise<void> {}

/** No-op on web: there is no cached APK to sweep. */
export function cleanupUpdateArtifacts(): void {}

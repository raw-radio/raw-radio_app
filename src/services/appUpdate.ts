import { Platform } from 'react-native'
import * as Application from 'expo-application'
import Constants from 'expo-constants'
import { File, Paths } from 'expo-file-system'
import * as IntentLauncher from 'expo-intent-launcher'
import type { AppUpdateInfo } from '../types'

/**
 * Sideloaded-APK updater (native variant).
 *
 * RAW Radio for Android ships through GitHub Releases, not the Play Store, so
 * there is no Play in-app-update API. Instead we compare the installed
 * `versionName` against the latest release tag and, if it is older, download
 * the APK and hand it to the system package installer.
 *
 * Every failure mode (offline, non-200, GitHub rate limit, malformed payload,
 * missing asset, unparseable tag) degrades to `null` / a rejected promise the
 * caller swallows — an update check must never nag or crash the player.
 *
 * The web build resolves `appUpdate.web.ts` instead, so `expo-intent-launcher`,
 * `expo-file-system` and `expo-application` never reach the browser bundle.
 */

/** Public, unauthenticated GitHub Releases endpoint for the app repo. */
const RELEASES_API_URL = 'https://api.github.com/repos/raw-radio/raw-radio_app/releases/latest'
/** Load-bearing asset name (same one the web download link points at). */
const APK_ASSET_NAME = 'raw-radio-universal.apk'
/** Fixed cache filename — overwritten on every download (`idempotent`). */
const APK_DESTINATION_NAME = 'raw-radio-update.apk'
/**
 * Matches every APK this service may have written to the cache. The `.` keeps
 * the separator optional so an older build that appended a number
 * (`raw-radio-update-2.apk`) is still swept, while unrelated cache entries
 * (`raw-radio-logo.png`, `ExperienceData`, …) never match.
 */
const UPDATE_ARTIFACT_PATTERN = /^raw-radio-update.*\.apk$/i
/**
 * Minimum age before the app-start sweep will delete a cached APK.
 *
 * The sweep runs from a component-mount effect, not from process start: a JS
 * reload, navigation re-entry, or the OS restarting the process with the
 * installer in the foreground can remount the screen while the system installer
 * is still reading a just-downloaded APK. Deleting it then makes the install
 * fail with "there was a problem parsing the package". A file this young is
 * never touched by the start-up sweep; the pre-download sweep in
 * `downloadAndInstall` (age `0`) removes it once the user asks for a new build.
 */
const UPDATE_ARTIFACT_MIN_AGE_MS = 10 * 60_000
const APK_MIME_TYPE = 'application/vnd.android.package-archive'
const ACTION_VIEW = 'android.intent.action.VIEW'
/** `Intent.FLAG_GRANT_READ_URI_PERMISSION` — lets the installer read our `content://` URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 1
/** Abort the release lookup instead of hanging the check forever. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Hosts we are willing to download an APK from. The release payload is fetched
 * over HTTPS but its `browser_download_url` is then passed straight to
 * `File.downloadFileAsync`, and OkHttp follows redirects — so without a check a
 * compromised/tampered response could point the download (and the installer
 * prompt) anywhere. GitHub serves release assets from `github.com` and
 * redirects to `objects.githubusercontent.com`.
 *
 * This is defence in depth, NOT the trust boundary: the installer only accepts
 * an APK signed with the app's release key, which is what actually prevents a
 * substituted package. Pinning the origin just avoids even fetching from hosts
 * we have no reason to trust. Any mismatch returns `null`, so the UI simply
 * shows no update affordance.
 */
const ALLOWED_APK_URL = /^https:\/\/(?:github\.com|objects\.githubusercontent\.com)\//i

/** Minimal shape of the GitHub release payload we consume. */
interface GitHubRelease {
  tag_name?: unknown
  assets?: unknown
}

/**
 * The installed Android `versionName` (`android.versionCode` is unrelated).
 * Falls back to the Expo config version for dev builds where the native value
 * is unavailable.
 */
function getCurrentVersion(): string | null {
  const nativeVersion = Application.nativeApplicationVersion
  if (nativeVersion) return nativeVersion

  const configVersion = Constants.expoConfig?.version
  return configVersion ?? null
}

/**
 * Parses the numeric core of a semantic version (`1.2.3`), tolerating a
 * pre-release / build suffix (`1.2.3-beta.1`, `1.2.3+build7`). The suffix is
 * ignored on purpose: the Android `versionName` is always a plain triplet.
 */
function parseVersion(raw: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Strict semver comparison on the numeric core — never a string compare, so
 * `0.1.10` correctly beats `0.1.9`. Returns `true` only when `latest` is
 * strictly greater than `current`; equal or unparseable versions are `false`.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const next = parseVersion(latest)
  const installed = parseVersion(current)
  if (!next || !installed) return false

  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index]
  }
  return false
}

/** `app-v0.2.0` → `0.2.0`; also tolerates a bare `v0.2.0`. */
function versionFromTag(tag: string): string | null {
  const stripped = tag.trim().replace(/^app-v/i, '').replace(/^v/i, '')
  return parseVersion(stripped) ? stripped : null
}

/** Finds the APK asset URL in an unvalidated release payload. */
function findApkAssetUrl(release: GitHubRelease): string | null {
  if (!Array.isArray(release.assets)) return null

  for (const asset of release.assets) {
    if (typeof asset !== 'object' || asset === null) continue
    const { name, browser_download_url: url } = asset as {
      name?: unknown
      browser_download_url?: unknown
    }
    if (name === APK_ASSET_NAME && typeof url === 'string' && ALLOWED_APK_URL.test(url)) {
      return url
    }
  }
  return null
}

/**
 * Fetches the latest release. Returns `null` for any non-2xx response — this
 * covers the unauthenticated 60 req/h rate limit (403) and a missing release
 * (404) — as well as for a body that is not an object.
 */
async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'raw-radio-app',
      },
      signal: controller.signal,
    })
    if (!response.ok) return null

    const payload = (await response.json()) as unknown
    if (typeof payload !== 'object' || payload === null) return null
    return payload as GitHubRelease
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Resolves the update for this install, or `null` when there is nothing newer
 * (or the check could not be completed). Never rejects.
 *
 * Call once on mount — the unauthenticated GitHub API allows 60 requests/hour
 * per IP and a stale "update available" flag is harmless.
 */
export async function checkForUpdate(): Promise<AppUpdateInfo | null> {
  if (Platform.OS !== 'android') return null

  const current = getCurrentVersion()
  if (!current) return null

  try {
    const release = await fetchLatestRelease()
    if (!release) return null

    const apkUrl = findApkAssetUrl(release)
    const latest = typeof release.tag_name === 'string' ? versionFromTag(release.tag_name) : null
    if (!apkUrl || !latest) return null
    if (!isNewerVersion(latest, current)) return null

    return { current, latest, apkUrl }
  } catch {
    // Offline, DNS failure, abort, invalid JSON — show nothing.
    return null
  }
}

/**
 * Removes update APKs this service has written to the app cache, optionally
 * skipping recently written ones.
 *
 * Called once on screen mount (default `maxAgeMs` = {@link
 * UPDATE_ARTIFACT_MIN_AGE_MS}) to bound the cache footprint, and by
 * `downloadAndInstall` with `0` right before it writes a new file. The installer
 * reads its APK asynchronously after `startActivityAsync` resolves, so the
 * mount-time sweep must never delete a file that might still be feeding the
 * installer: mount is not process start (a remount mid-install would otherwise
 * break it), hence the age gate. The pre-download sweep is safe because the user
 * just tapped the update affordance.
 *
 * The sweep enumerates `Paths.cache` and deletes only files whose name matches
 * {@link UPDATE_ARTIFACT_PATTERN} — never unrelated cache entries, never
 * anything outside the cache dir, and never a directory. An unknown modification
 * time is treated as "too new" (skipped), since deleting a possibly-live APK is
 * the failure mode we are guarding against. It is a no-op when the cache
 * directory or the artifact is absent. Every failure is swallowed: a cleanup
 * problem must never surface in, or block, the update UI.
 *
 * Synchronous on purpose — `Directory.list()`/`File.delete()` are sync in the
 * SDK 57 `expo-file-system` API, and the cache listing is tiny.
 */
export function cleanupUpdateArtifacts(maxAgeMs: number = UPDATE_ARTIFACT_MIN_AGE_MS): void {
  if (Platform.OS !== 'android') return

  try {
    // `Directory.list()` throws if the directory does not exist, so guard.
    const cache = Paths.cache
    if (!cache.exists) return

    const cutoff = Date.now() - maxAgeMs
    for (const entry of cache.list()) {
      if (!(entry instanceof File)) continue
      if (!UPDATE_ARTIFACT_PATTERN.test(entry.name)) continue
      if (maxAgeMs > 0) {
        const modified = entry.lastModified
        if (modified === null || modified > cutoff) continue
      }
      try {
        entry.delete()
      } catch {
        // Locked, already removed, or raced with the system — nothing to do.
      }
    }
  } catch {
    // Cache unreadable / odd filesystem state — never propagate.
  }
}

/**
 * Downloads the APK into the app cache and launches the system package
 * installer. Rejects on download/launch failure; the caller swallows it.
 *
 * The URI handed to the installer is a `content://` FileProvider URI, not the
 * raw `file://` path: since Android 7 a `file://` intent throws
 * `FileUriExposedException`. Do NOT use `getContentUriAsync` from the
 * `expo-file-system` ROOT — in SDK 57 that export is a deprecation stub that
 * throws at runtime (`build/legacyWarnings.d.ts`). The unified `File` class
 * exposes the real helper as `file.contentUri`
 * (`FileSystemModule.kt:231` → `FileSystemFile.asContentUri()` →
 * `FileProvider.getUriForFile(app, "<package>.FileSystemFileProvider", file)`).
 *
 * The system installer confirmation dialog is unavoidable for sideloaded APKs;
 * `REQUEST_INSTALL_PACKAGES` is what allows that dialog to appear at all.
 *
 * Idempotent: the destination is a fixed cache name and `idempotent: true`
 * overwrites it, so repeated attempts never accumulate numbered copies. A stale
 * artifact from a previous session is swept first so it can never be mistaken
 * for this download.
 */
export async function downloadAndInstall(apkUrl: string): Promise<void> {
  if (Platform.OS !== 'android') return

  // Safe here: the user just tapped the in-app affordance, so no installer is
  // reading a previous artifact. Age gate disabled (`0`) so even a fresh file
  // cannot be mistaken for the one we are about to write.
  cleanupUpdateArtifacts(0)

  const destination = new File(Paths.cache, APK_DESTINATION_NAME)
  const file = await File.downloadFileAsync(apkUrl, destination, {
    // The fixed cache path already exists on the second attempt — overwrite it
    // instead of failing with `DestinationAlreadyExists`.
    idempotent: true,
  })

  const contentUri = file.contentUri
  if (!contentUri) throw new Error('Could not resolve a content:// URI for the APK')

  await IntentLauncher.startActivityAsync(ACTION_VIEW, {
    data: contentUri,
    type: APK_MIME_TYPE,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  })
}

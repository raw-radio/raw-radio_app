#!/usr/bin/env node
/**
 * CI-only release preparation (run by .github/workflows/release.yml).
 *
 * Rewrites app.json **inside the runner workspace only** — the change is never committed.
 * `expo prebuild` runs right after this script and turns the values into Android Gradle
 * versionName / versionCode / OneSignal config for the signed release build.
 *
 * What it does:
 *   1. Takes the version from the pushed tag (`app-v1.2.3` → `1.2.3`) or from RELEASE_VERSION.
 *   2. Sets a monotonically increasing `android.versionCode`
 *      (major*10000 + minor*100 + patch, never lower than the value already in app.json).
 *   3. Forces the OneSignal Expo plugin into "production" mode. Note: that option only sets the
 *      iOS `aps-environment` entitlement — it has no effect on the Android APK — but a release
 *      build should not ship a "development" declaration.
 *
 * Usage:
 *   RELEASE_VERSION=app-v1.2.3 node scripts/prepare-release.mjs
 *   node scripts/prepare-release.mjs            # keeps the version from app.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ONESIGNAL_PLUGIN = 'onesignal-expo-plugin'
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appJsonPath = join(root, 'app.json')

const config = JSON.parse(readFileSync(appJsonPath, 'utf8'))
const expo = config.expo

if (!expo || typeof expo !== 'object') {
  throw new Error('app.json: missing the "expo" object')
}

// ── 1. Version ───────────────────────────────────────────────────────
const rawVersion = (process.env.RELEASE_VERSION ?? '').trim()
const version = rawVersion.replace(/^app-v/, '').replace(/^v/, '')

if (version && !SEMVER.test(version)) {
  throw new Error(
    `RELEASE_VERSION="${rawVersion}" is not a valid version. ` +
      'Expected a tag like app-v1.2.3 or a version like 1.2.3.',
  )
}

if (version) {
  expo.version = version
}

// ── 2. versionCode (must never decrease — Google Play rejects it) ────
const [major = 0, minor = 0, patch = 0] = String(expo.version)
  .split(/[.-]/)
  .map((part) => Number.parseInt(part, 10))
  .map((part) => (Number.isFinite(part) ? part : 0))

const derivedVersionCode = major * 10000 + minor * 100 + patch
const currentVersionCode = Number.isInteger(expo.android?.versionCode)
  ? expo.android.versionCode
  : 0
const versionCode = Math.max(currentVersionCode, derivedVersionCode)

expo.android = { ...(expo.android ?? {}), versionCode }

// ── 3. OneSignal plugin mode ─────────────────────────────────────────
const plugins = Array.isArray(expo.plugins) ? expo.plugins : []
let onesignalEntries = 0

expo.plugins = plugins.map((entry) => {
  const name = Array.isArray(entry) ? entry[0] : entry
  if (name !== ONESIGNAL_PLUGIN) return entry

  onesignalEntries += 1
  const options = Array.isArray(entry) ? { ...(entry[1] ?? {}) } : {}
  options.mode = 'production'
  return [ONESIGNAL_PLUGIN, options]
})

if (onesignalEntries !== 1) {
  throw new Error(
    `app.json: expected exactly one "${ONESIGNAL_PLUGIN}" entry in expo.plugins, ` +
      `found ${onesignalEntries}. Refusing to build a release with an unknown OneSignal config.`,
  )
}

// ── Write + verify ───────────────────────────────────────────────────
writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`)

const written = JSON.parse(readFileSync(appJsonPath, 'utf8')).expo
const onesignalMode = (written.plugins.find(
  (entry) => (Array.isArray(entry) ? entry[0] : entry) === ONESIGNAL_PLUGIN,
)?.[1] ?? {}).mode

if (onesignalMode !== 'production') {
  throw new Error(`app.json: OneSignal mode is "${onesignalMode}", expected "production"`)
}

console.log('Release app config prepared (runner workspace only, not committed):')
console.log(`  version     : ${written.version}`)
console.log(`  versionCode : ${written.android.versionCode}`)
console.log(`  onesignal   : ${onesignalMode}`)
console.log(`  package     : ${written.android.package}`)

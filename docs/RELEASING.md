# Releasing the Android app

Everything signing-related lives **only** in GitHub Secrets. This repository is public, so a
committed keystore (or its passwords) would let anybody else publish updates pretending to be
RAW Radio — and would permanently compromise the app's identity.

Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)
Tag pattern: `app-v*` → signed release APK → GitHub Release.

---

## 0. TL;DR

```bash
# one-time: keystore + GitHub secrets (sections 1 and 2)

# every release:
#  1. bump the version in app.json (optional — CI can take it from the tag)
#  2. commit + push
git tag app-v0.2.0
git push origin --tags
# CI builds the signed APK and publishes it to Releases
```

Download (stable URL, always the newest release):

```
https://github.com/raw-radio/raw-radio_app/releases/latest/download/raw-radio-universal.apk
```

---

## 1. One-time: generate the release keystore

Run this locally (never in CI, never inside the repository). Replace the placeholder
passwords with your own — do **not** reuse the placeholders, and do not commit the file:

```bash
keytool -genkeypair -v \
  -keystore release.keystore \
  -storetype PKCS12 \
  -alias raw-radio \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=RAW Radio, OU=Mobile, O=RAW Radio, L=Moscow, C=RU" \
  -storepass "<STORE_PASSWORD>" \
  -keypass "<STORE_PASSWORD>"
```

Notes:

- `release.keystore` matches `*.keystore` in `.gitignore` — verify with
  `git status --porcelain` that it never shows up before you commit anything.
- **Use the same value for `-storepass` and `-keypass`.** `PKCS12` keystores do not support
  different store/key passwords (Java's `keytool` refuses it). That is why the two GitHub
  secrets below normally hold the same string; if you prefer different passwords, generate a
  legacy JKS keystore (`-storetype JKS`) and set the repo variable `ANDROID_KEYSTORE_TYPE=jks`.
- `-validity 10000` (≈27 years) — the key must outlive the app's lifetime on Google Play.
- Keep an offline backup (password manager + encrypted archive on a USB drive/another
  provider). **If you lose the keystore you can no longer publish updates** for
  `com.rawradio.app`: Google Play only accepts updates signed with the same key
  (unless you have Play App Signing enabled with an upload key you can reset).

Check what is inside the keystore (prints the SHA-256 fingerprint you should also store):

```bash
keytool -list -v -keystore release.keystore -storetype PKCS12 -alias raw-radio
```

---

## 2. One-time: GitHub secrets and variables

Repository → **Settings → Secrets and variables → Actions**.

### Secrets

| Secret                    | Value                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64` | base64 of `release.keystore` (command below)                       |
| `KEYSTORE_PASSWORD`       | store password used with `-storepass`                              |
| `KEY_ALIAS`               | `raw-radio` (whatever was passed to `-alias`)                      |
| `KEY_PASSWORD`            | key password used with `-keypass` (same as the store password)     |

Produce the base64 value (single line, no wrapping):

```bash
# macOS
base64 -i release.keystore | tr -d '\n' | pbcopy

# Linux
base64 -w0 release.keystore | xclip -selection clipboard
```

Paste the result into the secret value. Never commit it, never paste it into issues,
chats or logs — the workflow only decodes it into `$RUNNER_TEMP` for the duration of the job
and deletes it afterwards.

### Variables

| Variable                       | Required | Default                  | Purpose                                             |
| ------------------------------ | -------- | ------------------------ | --------------------------------------------------- |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | **yes**  | —                        | OneSignal app id (public). May be stored as a repository **variable** (preferred, it is not a secret) or as a **secret** with the same name — the workflow resolves `vars.… \|\| secrets.…`. Either way the build fails without it, otherwise push would silently be disabled in the release |
| `EXPO_PUBLIC_API_URL`          | no       | `https://raw-radio.ru`   | API base URL baked into the bundle                  |
| `EXPO_PUBLIC_WS_URL`           | no       | `https://raw-radio.ru`   | socket.io URL baked into the bundle                 |
| `ANDROID_KEYSTORE_TYPE`        | no       | `pkcs12`                 | `pkcs12` (default) or `jks`                          |

The workflow refuses to build if the URL variables are empty, not `https://`, or point at
`localhost` / `127.0.0.1` / `10.0.2.2` / `host.docker.internal` — a release APK must talk to
the production API.

---

## 3. Release process

1. **Bump the version** (optional but recommended): set `expo.version` in
   [`app.json`](../app.json) to the version you are about to publish. The tag is the source of
   truth — CI overrides `app.json` in its own workspace — but keeping them in sync avoids
   confusion for local builds.
2. Commit and push to the default branch.
3. Tag and push the tag:

   ```bash
   git tag app-v0.2.0
   git push origin --tags
   ```

4. The workflow runs (`Actions → RAW Radio App Release`):

   | Step | What happens |
   |------|--------------|
   | Setup | Node 22, JDK 17, Android SDK + NDK `27.1.12297006` + CMake `3.22.1` |
   | `npm ci` | installs the app dependencies |
   | `scripts/prepare-release.mjs` | version from the tag → `expo.version`; monotonic `android.versionCode`; OneSignal plugin → `production` (CI workspace only) |
   | `npx expo prebuild --platform android --clean` | regenerates `android/` from `app.json` |
   | keystore | decoded from `ANDROID_KEYSTORE_BASE64` into `$RUNNER_TEMP/release.keystore`, validated with `keytool -list` before the build |
   | `./gradlew assembleRelease` | signs the release APK with the injected signing config |
   | verification | `apksigner verify`; the APK's certificate SHA-256 must equal the keystore's key SHA-256; a debug-signed APK fails the job |
   | publish | `softprops/action-gh-release` attaches `raw-radio-universal.apk` to the tag's release with generated release notes |

5. Verify the release: open the release page, check the artifact name and the SHA-256 printed in
   the workflow summary, then install it on a device:

   ```bash
   adb install -r raw-radio-universal.apk
   ```

**Manual run:** `Actions → RAW Radio App Release → Run workflow` builds the APK and uploads it as
a workflow artifact only (no release is created, no tag needed). The optional `version` input
overrides the version.

---

## 4. How signing works (and why no `android/` patching)

`android/` is git-ignored and regenerated by `expo prebuild --clean` on every run, so the
workflow never hand-edits it. The generated `android/app/build.gradle` signs the release build
type with the **debug** keystore by default; the workflow overrides that with Android Gradle
Plugin's built-in injected signing:

```bash
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file="$KEYSTORE_PATH" \
  -Pandroid.injected.signing.store.password="$KEYSTORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$KEY_PASSWORD" \
  -Pandroid.injected.signing.store.type="$ANDROID_KEYSTORE_TYPE"
```

`android.injected.signing.*` is the standard AGP interface used by Android Studio's
*Generate Signed APK*. In AGP the injected config becomes the variant's `signingConfigOverride`
and takes precedence over the DSL `signingConfig` for every variant — i.e. the debug keystore
in `build.gradle` is ignored for `assembleRelease`. Because this works out of the box, no Expo
config plugin (`withAppBuildGradle`) is needed, and the repository keeps no Android build logic
of its own. If you ever see the build signing with `debug`, the injected properties were not
passed through.

Trade-off: the passwords travel as Gradle command-line properties, which is exactly how Android
Studio does it. They are never written to disk, they are masked in the workflow logs, and the
runner is a throwaway VM; the keystore file itself is decoded into `$RUNNER_TEMP` and removed by
the `Remove keystore` step (`if: always()`). Nothing signing-related is uploaded as an artifact.

---

## 5. Building a release APK locally (for testing)

> Gradle must run on **JDK 17 or 21** — on JDK 24/25 AGP's prefab task fails with
> `IllegalStateException: WARNING: A restricted method in java.lang.System has been called`.
> `scripts/prepare-android-studio.sh` pins the Gradle daemon to a usable JDK for you; see
> [`DEVELOPMENT.md`](./DEVELOPMENT.md) §3.

```bash
cd app

# 1. deps + native project (prefer the helper: it also pins the Gradle daemon JDK)
npm ci
scripts/prepare-android-studio.sh         # = prebuild --clean + local-only settings
# …or, if you want to do it by hand (then make sure the Gradle daemon runs on 17/21):
npx expo prebuild --platform android --clean

# 2. build, signed with your local keystore (kept outside the repo, or at the repo root — it is git-ignored)
export KEYSTORE_PATH="/absolute/path/to/release.keystore"
export KEYSTORE_PASSWORD="<STORE_PASSWORD>"
export KEY_ALIAS="raw-radio"
export KEY_PASSWORD="<STORE_PASSWORD>"

cd android
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file="$KEYSTORE_PATH" \
  -Pandroid.injected.signing.store.password="$KEYSTORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$KEY_PASSWORD" \
  -Pandroid.injected.signing.store.type=pkcs12 \
  -PreactNativeArchitectures=arm64-v8a

# 3. result
# app/build/outputs/apk/release/app-release.apk
```

For a debug build (no keystore needed): `npm run android` or
`cd android && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.

Check the signature of any APK:

```bash
"$ANDROID_HOME"/build-tools/<version>/apksigner verify --print-certs app-release.apk
```

---

## 6. APK size

Reference: a **debug** APK is ≈226 MB — it contains every ABI (`armeabi-v7a`, `arm64-v8a`,
`x86`, `x86_64`), unstripped native libraries and no resource shrinking.

The release config already shrinks it:

- CI builds only `armeabi-v7a,arm64-v8a` (`-PreactNativeArchitectures=…`) — `x86`/`x86_64`
  only matter for emulators, so they are dropped from release builds.

Options for further reduction:

| Goal | How |
|------|-----|
| Smallest single APK (modern devices only, arm64) | add `-PreactNativeArchitectures=arm64-v8a` to the Gradle command |
| One APK per ABI (arm64 ≈ half the universal size) | ABI splits. Not enabled by default; the generated `build.gradle` has to be extended, which — because `android/` is regenerated — means a local Expo config plugin (`withAppBuildGradle`) that injects into `android { … }`:<br>`splits { abi { isEnable = true; reset(); isUniversalApk = false; include("arm64-v8a", "armeabi-v7a") } }` |
| Google Play upload (Play generates per-device splits itself) | `./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab` |
| Code/resource shrinking (R8) | add `-Pandroid.enableMinifyInReleaseBuilds=true -Pandroid.enableShrinkResourcesInReleaseBuilds=true`. **Not enabled in CI** — R8 can break reflection-heavy native modules (OneSignal, Track Player, Reanimated): test the resulting APK on a device before enabling it permanently |

The size and SHA-256 of every published APK are printed in the workflow summary.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Repository secret KEYSTORE_PASSWORD is not set` | secrets are missing/typo'd — see section 2 |
| `keytool error: java.io.IOException: keystore password was incorrect` | `KEYSTORE_PASSWORD` does not match the keystore, or the base64 got line-wrapped — regenerate it without newlines |
| `Alias <…> does not exist` | `KEY_ALIAS` ≠ the `-alias` used with `keytool -genkeypair` |
| `APK is signed with the DEBUG keystore` | the `android.injected.signing.*` properties were not passed to Gradle |
| `NDK not configured` / `No version of NDK matched` | bump `ANDROID_NDK_VERSION` in the workflow to the NDK version Expo SDK 57 pins (`node_modules/expo-modules-autolinking` → `ndkVersion`) |
| `IllegalStateException: WARNING: A restricted method in java.lang.System has been called` | the Gradle daemon is running on JDK 24/25. CI uses Temurin 17; locally run `scripts/prepare-android-studio.sh` (see [`DEVELOPMENT.md`](./DEVELOPMENT.md) §3) |
| `Cannot run program "node"` | local/IDE builds only — the Gradle daemon cannot see `node` on its `PATH`. See [`DEVELOPMENT.md`](./DEVELOPMENT.md) §4 |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID is not set (checked repository variable and repository secret)` | set it under Settings → Secrets and variables → Actions, as a **variable** (preferred) or a **secret** |
| Build fails on `EXPO_PUBLIC_*` validation | set the repository variables, and make sure the API/WS URLs are public `https://` — never localhost |
| The version in the release is unexpected | the tag (`app-vX.Y.Z`) wins over `app.json`; the workflow summary and release name print the effective version |

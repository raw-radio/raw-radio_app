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

# every release — PREFERRED: build here, ship that exact binary (section 5)
export KEYSTORE_PATH=/path/to/release.keystore      # passwords are prompted (hidden) when unset
scripts/release-local.sh --version=0.2.0

# alternative: let CI build it (push a tag — CI publishes the release itself)
git tag app-v0.2.0 && git push origin --tags
```

Either way the tag is the release marker and CI never overwrites a release that already
exists (section 3.1), so a local release is not clobbered by the tag-triggered build.

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
   | `preflight` | on a tag: if a release for the tag already exists, the whole build is skipped (a locally published release wins — section 3.1) |
   | `npm ci` | installs the app dependencies |
   | `scripts/prepare-release.mjs` | version from the tag → `expo.version`; monotonic `android.versionCode`; OneSignal plugin → `production` (CI workspace only) |
   | `npx expo prebuild --platform android --clean` | regenerates `android/` from `app.json` |
   | memory guard | `android/gradle.properties` must carry the raised `org.gradle.jvmargs` (applied by `plugins/withGradleJvmArgs.js` inside prebuild) — fails in seconds otherwise |
   | keystore | decoded from `ANDROID_KEYSTORE_BASE64` into `$RUNNER_TEMP/release.keystore`, validated with `keytool -list` before the build |
   | `./gradlew assembleRelease` | signs the release APK with the injected signing config; **Android Lint is skipped on purpose** (section 3.2) |
   | verification | `scripts/verify-apk.sh` — manifest readable (`aapt2 dump badging`), package + launchable activity present, versionCode as expected, signed, signer ≠ debug key, signer's SHA-256 == keystore key's SHA-256 |
   | publish | `softprops/action-gh-release` attaches `raw-radio-universal.apk` to the tag's release with generated release notes — unless a release for the tag already exists (release gate) |

5. Verify the release: open the release page, check the artifact name and the SHA-256 printed in
   the workflow summary, then install it on a device:

   ```bash
   adb install -r raw-radio-universal.apk
   ```

**Manual run:** `Actions → RAW Radio App Release → Run workflow` builds the APK and uploads it as
a workflow artifact only — never a release, no tag needed, and the publish step additionally
requires `github.event_name == 'push'`, so even a manual run started *on* an `app-v*` tag is
build-only. The optional `version` input overrides the version, `r8` enables R8/resource
shrinking (experimental — section 6).

### 3.1 Local release vs. tag-triggered CI build

Both flows end in a GitHub Release whose tag is `app-vX.Y.Z`. They must not fight:

- `scripts/release-local.sh` pushes the tag and creates the release within a second or two.
- The tag push triggers this workflow. Its `preflight` job asks the API whether a release for
  that tag exists; if it does, the build is skipped entirely (~20 CI minutes saved).
- The tag is created a moment before the release object, so a very fast runner could still see
  "no release yet". That is why there is a **second gate** immediately before publishing: after
  the ~20 min build it re-checks and skips the upload, leaving the locally built APK untouched.
  It **narrows** the race to the seconds between `gh release view` and the publish step rather
  than eliminating it — it is a check-then-act, not a compare-and-swap (the release action has
  no CAS), so a release published inside that window is still clobbered. The CI-built APK is
  also uploaded as a workflow artifact for comparison.
- Accepted failure mode: if both checks were to fail (e.g. GitHub API outage at both
  moments), CI publishes its own build of the same commit under the same asset name — same
  version, different SHA-256. The workflow summary prints the hash, so a mismatch is
  detectable, and re-running the workflow after the API recovers restores the guard.

### 3.2 Android Lint is not part of the release build

`assembleRelease` normally also runs the release-only `lintVitalRelease` /
`lintVitalAnalyzeRelease` gate. CI passes `-x lint -x lintVitalRelease -x
lintVitalAnalyzeRelease -x lintVitalReportRelease` because that gate linted every one of the
~50 native modules and died with `java.lang.OutOfMemoryError` plus *"Unexpected failure during
lint analysis (this is a bug in lint or one of the libraries it depends on)"* (run
35212151391; google issuetracker 178631052). It is not needed to produce a working APK, and
`expo run:android` skips lint in exactly the same way.

**Trade-off, explicitly:** fatal-severity lint findings would no longer fail CI. Compensation:
the daemon memory is raised (`plugins/withGradleJvmArgs.js`) so lint *can* run, the artifact
must pass `scripts/verify-apk.sh`, and the release should be installed on a device before it
is announced. To bring lint back, drop the four `-x` flags, keep the memory settings, and
verify one green run before trusting it.

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

## 5. Building and publishing a release locally (preferred)

> Gradle must run on **JDK 17 or 21** — on JDK 24/25 AGP's prefab task fails with
> `IllegalStateException: WARNING: A restricted method in java.lang.System has been called`.
> On macOS `scripts/release-local.sh` calls `scripts/prepare-android-studio.sh --skip-prebuild`,
> which pins the Gradle daemon to a usable JDK for you; see [`DEVELOPMENT.md`](./DEVELOPMENT.md) §3.

One command does prebuild → signed build → verification → tag → release:

```bash
cd app
export KEYSTORE_PATH="/absolute/path/to/release.keystore"   # default: ./release.keystore
# KEYSTORE_PASSWORD / KEY_PASSWORD / KEY_ALIAS are prompted (hidden) when unset.
# Exporting them is fine too. NOTE: they are NOT invisible in the process table — `gradlew`
# receives them as `-Pandroid.injected.signing.*` Gradle properties, so they are visible in
# `ps` to local users for the ~10–20 min the build runs. `keytool` and `verify-apk.sh` get the
# store password via the environment instead (`-storepass:env` / `--storepass-env`). Do not run
# this on a shared/multi-user machine; see the header of scripts/release-local.sh.
scripts/release-local.sh --version=0.2.0
```

What it does, in order:

1. `scripts/prepare-release.mjs` — version from `--version`, monotonic `android.versionCode`,
   OneSignal plugin in `production` mode. `app.json` is restored on exit (the mutation is
   workspace-only, exactly like CI).
2. `expo prebuild --platform android --clean` (skip with `--skip-prebuild`), then local
   settings via `scripts/prepare-android-studio.sh --skip-prebuild` on macOS.
3. `./gradlew assembleRelease` with the same flags as CI — injected signing
   (`-Pandroid.injected.signing.*`), `-PreactNativeArchitectures=armeabi-v7a,arm64-v8a` and the
   deliberate lint skip.
4. `scripts/verify-apk.sh` — the same gate CI runs (structure, versionCode, signature,
   certificate fingerprint must equal the keystore's).
5. `git tag -a app-v0.2.0` + `git push origin app-v0.2.0`, then `gh release create` with
   `build-artifacts/raw-radio-universal.apk`.

The APK lands in `build-artifacts/raw-radio-universal.apk` (git-ignored; kept out of `dist/`
so a later `expo export --platform web` cannot delete it).

Flags: `--no-publish` / `--dry-run` (build + verify only, no git/gh changes), `--abis=`, `--skip-prebuild`,
`--notes-file=`, `--keystore=`, `--yes` (skip the confirmation prompt when the tree is dirty).

Warnings built into the script:

- a **dirty working tree** is called out (the release should be traceable to a commit) and needs
  confirmation;
- an **existing tag** is reused only if it points at `HEAD`, otherwise the script aborts;
- an **existing release** for the tag is updated with `gh release upload --clobber` instead of
  failing — re-running a release is safe and idempotent.

### Doing it by hand (fallback)

```bash
cd app
npm ci
npx expo prebuild --platform android --clean --no-install   # applies plugins/withGradleJvmArgs
export KEYSTORE_PATH="/absolute/path/to/release.keystore"   # outside the repo, or at its root (git-ignored)
export KEYSTORE_PASSWORD="<STORE_PASSWORD>"
export KEY_ALIAS="raw-radio"
export KEY_PASSWORD="<STORE_PASSWORD>"

cd android
./gradlew assembleRelease \
  -x lint -x lintVitalRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease \
  -Pandroid.injected.signing.store.file="$KEYSTORE_PATH" \
  -Pandroid.injected.signing.store.password="$KEYSTORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$KEY_PASSWORD" \
  -Pandroid.injected.signing.store.type=pkcs12 \
  -PreactNativeArchitectures=armeabi-v7a,arm64-v8a

cd .. && scripts/verify-apk.sh --apk android/app/build/outputs/apk/release/app-release.apk \
  --keystore "$KEYSTORE_PATH" --storepass-env KEYSTORE_PASSWORD --alias "$KEY_ALIAS"
```

For a debug build (no keystore needed): `npm run android` or
`cd android && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.

Check the signature of any APK:

```bash
scripts/verify-apk.sh --apk app-release.apk          # structure + signer, no keystore needed
"$ANDROID_HOME"/build-tools/<version>/apksigner verify --print-certs app-release.apk
```

---

## 6. APK size, R8 and resource shrinking

Measured locally (Expo SDK 57, this app, release build, `-PreactNativeArchitectures` as noted):

| Variant | Size |
|---------|------|
| debug, all 4 ABIs, unstripped | ≈226 MB |
| release, `arm64-v8a` only | ≈49 MB |
| release, `armeabi-v7a,arm64-v8a` (what CI/local publish) | **≈64 MB** |

What takes the space (uncompressed entries of the universal APK): `classes*.dex` ≈51 MB
(5 dex files — the Java/Kotlin code of all native modules), `lib/` ≈36 MB (native `.so`),
`res/` ≈6 MB, `assets/index.android.bundle` ≈3.6 MB (Hermes bytecode).

The release config already shrinks the APK:

- CI/local builds only `armeabi-v7a,arm64-v8a` (`-PreactNativeArchitectures=…`) — `x86`/`x86_64`
  only matter for emulators, so they are dropped from release builds.
- AAPT2 PNG crunching is on (`android.enablePngCrunchInReleaseBuilds=true`).

Options for further reduction:

| Goal | How |
|------|-----|
| Smaller single APK (modern devices only, arm64) | `-PreactNativeArchitectures=arm64-v8a` (≈49 MB, but 32-bit-only devices can no longer install) |
| One APK per ABI | ABI splits. Not enabled by default; the generated `build.gradle` has to be extended, which — because `android/` is regenerated — means a config plugin that injects into `android { … }`:<br>`splits { abi { isEnable = true; reset(); isUniversalApk = false; include("arm64-v8a", "armeabi-v7a") } }` |
| Google Play upload (Play generates per-device splits itself) | `./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab` |
| Code/resource shrinking (R8) | `-Pandroid.enableMinifyInReleaseBuilds=true -Pandroid.enableShrinkResourcesInReleaseBuilds=true` — see below |

**R8 is deliberately OFF for tag builds.** The dex files are the biggest chunk (≈51 MB
uncompressed), so R8 would visibly help — but it rewrites every reflective call path, and this
app leans on reflection-heavy modules (OneSignal, react-native-track-player, Reanimated, and
Expo's module registry). A blind enable can produce an APK that builds, installs, and then
crashes or silently loses push/playback.

To test it without shipping it:

```bash
# manual run, artifact only — never published to a release
Actions → RAW Radio App Release → Run workflow → r8: true
```

…or locally with the same two `-P` flags added to the Gradle command. Then, **before** enabling
it for tags, verify on a real device (not just an emulator):

1. cold start + navigation through every screen (`/`, `/copyright`, chat, substation switch);
2. playback: start/pause/skip, background playback + notification controls (Track Player);
3. push: receive a OneSignal push, tap it, check the deep link;
4. JSI/Reanimated animations (agenda/chat) — no `Cannot read property of undefined` from
   stripped classes;
5. `adb logcat | grep -iE 'ClassNotFound|NoSuchMethod|No virtual method'` stays empty.

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
| `java.lang.OutOfMemoryError: Java heap space` during `lintVitalAnalyzeRelease` / `Unexpected failure during lint analysis` | the release lint gate on a 2 GiB daemon (Expo's default). CI skips lint (section 3.2) and raises `org.gradle.jvmargs` via `plugins/withGradleJvmArgs.js`; if it reappears in the workflow, the memory guard step fails in seconds with the reason |
| `android/gradle.properties does not carry the expected org.gradle.jvmargs` | `plugins/withGradleJvmArgs.js` is no longer registered in `app.json`, or Expo changed its prebuild template — see the plugin's docstring and update both it and the workflow guard together |
| `verify-apk: APK has no launchable-activity` / `aapt2 could not read the APK manifest` | the APK is truncated or the merge step broke — re-run with `--stacktrace` and inspect `:app:packageRelease` |
| `verify-apk: APK is signed with the DEBUG keystore` | the `android.injected.signing.*` properties were not passed to Gradle (local: `scripts/release-local.sh` sets them; CI: check the secrets) |
| CI ran a full build even though the release already existed | the tag/release race — the release gate still protected the asset; nothing to do, just ~20 wasted CI minutes |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID is not set (checked repository variable and repository secret)` | set it under Settings → Secrets and variables → Actions, as a **variable** (preferred) or a **secret** |
| Build fails on `EXPO_PUBLIC_*` validation | set the repository variables, and make sure the API/WS URLs are public `https://` — never localhost |
| The version in the release is unexpected | the tag (`app-vX.Y.Z`) wins over `app.json`; the workflow summary and release name print the effective version |

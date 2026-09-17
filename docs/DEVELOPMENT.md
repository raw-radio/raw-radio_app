# Developing the Android app

How to open `android/` in Android Studio and build it from the IDE, and why the generated
project needs a small machine-local preparation step first.

- Releasing (signing, secrets, tags) → [`RELEASING.md`](./RELEASING.md)
- Everything below is **local development only**. CI never uses any of it.

---

## 0. TL;DR

```bash
cd app

# one-time / after every `expo prebuild --clean`
scripts/prepare-android-studio.sh            # regenerates android/ + applies local settings
scripts/prepare-android-studio.sh --verify   # optional: prove Gradle can configure the project

# open the IDE (this is the supported way — see §4)
scripts/open-android-studio.sh           # then just wait for "Gradle sync"
```

Run from Android Studio: pick the `app` configuration, target `arm64-v8a` (see §5).

---

## 1. Prerequisites

| Tool | Version | Notes |
| ---- | ------- | ----- |
| Node.js | 22 (CI uses 22) | `node` **must** be reachable from the Gradle daemon — see §4 |
| JDK for Gradle | **17** (preferred, same as CI) or 21 | *Not* 24/25 — see §3. `brew install --cask temurin@17` |
| Android Studio | any recent build | its **bundled** JDK (25 on current builds) is fine as the *launcher*, see §3 |
| Android SDK | API 36 platform + `ndk;27.1.12297006` + `cmake;3.22.1` | Studio → SDK Manager; the NDK/CMake pins match Expo SDK 57 / RN 0.86 |

`prepare-android-studio.sh` auto-detects all of these at runtime — nothing is hard-coded and
nothing machine-specific is ever written into a tracked file.

---

## 2. `android/` is generated, not source

`android/` is in `.gitignore` and is rebuilt from `app.json` on demand:

```bash
npx expo prebuild --platform android --clean
```

Consequences:

- Never hand-edit anything under `android/` — the next `prebuild --clean` deletes it.
- A fresh `android/` has **no** `local.properties`, **no** `.idea/`, and **no**
  `gradle/gradle-daemon-jvm.properties`. Those are re-created by
  `scripts/prepare-android-studio.sh` (and, for `local.properties`, by Studio on first sync).
- The generated Gradle scripts shell out to the literal command `node`. That is hard-coded in
  the compiled expo/React Native Gradle plugins, so it cannot be redirected by a Gradle
  property — it has to be on the daemon's `PATH` (§4).

---

## 3. Which JDK Gradle runs on (the important part)

### Symptom

```
Execution failed for task ':react-native-worklets:configureCMakeDebug[x86]'.
> java.lang.IllegalStateException: WARNING: A restricted method in java.lang.System has been called
    at com.android.build.gradle.tasks.GeneratePrefabPackagesKt$reportErrors$1$1.invoke(GeneratePrefabPackages.kt:304)
```

### Cause

JDK 24+ prints `WARNING: A restricted method in java.lang.System has been called` whenever a
restricted (native-access) method is called. AGP's `GeneratePrefabPackages` writes its CMake
configure log to a file and then turns **every line of that log into a build error**
(`FilesKt.forEachLine` → `reportErrors`), so a purely informational JVM warning aborts the
task. Android Studio bundles JBR **25**, so a default Studio sync dies here.

This is *not* an ABI problem: the same failure happens for `arm64-v8a`, `x86` and `x86_64`.
The emulator-only ABIs are simply where people usually notice it, because Studio configures
all four while `expo run:android` narrows them down.

### Fix

Pin the **Gradle daemon** to JDK 17/21 through Gradle's daemon JVM criteria file,
`android/gradle/gradle-daemon-jvm.properties`:

```properties
toolchainVersion=17
```

Notes:

- The daemon JVM criteria **take precedence over `org.gradle.java.home`** — setting that
  property in `gradle.properties`, `~/.gradle/gradle.properties`, or Studio's "Gradle JDK"
  field does *not* avoid the failure. The criteria file is the only reliable lever.
- The criteria file is written by `scripts/prepare-android-studio.sh`, so it is machine-local
  and never committed. It is regenerated with `android/`.
- Because the *daemon* is pinned, Studio's own "Gradle JDK" setting only picks the launcher and
  can be left on the embedded JDK (25). Verified: launcher JDK 25 + daemon JDK 17 builds fine.
- `prepare-android-studio.sh` also writes
  `org.gradle.java.installations.paths` (every 17/21 JDK it finds) and
  `org.gradle.java.installations.auto-download=false`, so Gradle uses a JDK that actually
  exists locally instead of trying to download one.
- Why 17 and not 21? CI builds with Temurin **17** (`.github/workflows/release.yml` →
  `JAVA_VERSION: '17'`). Matching it means a local build exercises the same toolchain as the
  release build. 21 also works and is used automatically as a fallback. Pass
  `--jdk-major=21` to prefer it.

---

## 4. Launching Android Studio so Gradle can find `node`

The generated Gradle scripts run `node`:

| Where | Call |
| ----- | ---- |
| `android/settings.gradle` | `commandLine("node", "--print", "require.resolve(…)")` |
| `android/app/build.gradle` | `["node", "-e", "require('expo/scripts/resolveAppEntry')", …].execute(…)` |
| `ExpoAutolinkingPlugin` / `ExpoAutolinkingSettingsPlugin` (Kotlin, compiled) | `spec.commandLine("node", "--no-warnings", …)` |
| `@react-native/gradle-plugin` | `nodeExecutableAndArgs` defaults to `node` |

Only the React Native one is configurable (and only for bundling), so the practical rule is:
**`node` must be on the `PATH` that the Gradle daemon inherits**, which is the environment of
the process that started Android Studio.

Launched from the **Dock / Finder / Spotlight**, macOS hands an app launchd's minimal
`PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) where `node` never lives, and sync fails with:

```
Cannot run program "node" (in directory "…/android"): error=2, No such file or directory
```

### Supported way: launch Studio through the wrapper

```bash
scripts/open-android-studio.sh          # opens <repo>/android
scripts/open-android-studio.sh <dir>    # opens any other project dir
```

It resolves `node`, prepends its directory to `PATH`, and then runs Studio's own launcher
binary **directly**. That last part matters: `open -a "Android Studio"` does *not* forward the
calling shell's environment, so `open` cannot be used for this. The IDE is detached with
`nohup`, so closing the terminal does not kill it.

### Dock/Finder launches (opt-in)

If you want the Dock icon to work too, install a tiny login agent that adds the `node`
directory to the **GUI** PATH:

```bash
scripts/prepare-android-studio.sh --install-gui-path    # writes ~/Library/LaunchAgents/ru.rawradio.gradle-path.plist
scripts/prepare-android-studio.sh --uninstall-gui-path  # removes it again
```

It runs `launchctl setenv PATH …` at login, applies immediately for new processes (quit and
relaunch Studio), and is fully reversible. It is opt-in because it changes the environment of
*all* GUI applications, not just the IDE.

---

## 5. ABI caveat

`reactNativeArchitectures` decides which ABIs Gradle builds:

- Studio, on a fresh `prebuild`, configures **all four** (`armeabi-v7a,arm64-v8a,x86,x86_64`).
  That is slow and produces a ~226 MB debug APK.
- `expo run:android` narrows it to the host ABI (`-PreactNativeArchitectures=arm64-v8a`).
- `prepare-android-studio.sh` writes the host ABI into `gradle.properties` so IDE builds behave
  like the CLI ones: `arm64-v8a` on Apple Silicon, `x86_64` on Intel.

**Caveat:** "Run" installs the APK for the ABIs that were built. A single-ABI build will not
install on a device/emulator with a different ABI. On Apple Silicon the emulator is
`arm64-v8a`, so the default is correct; if you use an x86_64 emulator (or want one APK that
covers old 32-bit ARM devices), override it:

```bash
scripts/prepare-android-studio.sh --abis=arm64-v8a,x86_64   # or:
scripts/prepare-android-studio.sh --abis=all                # all four, slowest
RAW_RADIO_ANDROID_ABIS=x86_64 scripts/prepare-android-studio.sh
```

The release build is unaffected: CI passes `-PreactNativeArchitectures=armeabi-v7a,arm64-v8a`
explicitly (see [`RELEASING.md`](./RELEASING.md) §6).

---

## 6. What `prepare-android-studio.sh` changes

Only inside the git-ignored `android/` directory (plus `~/Library/LaunchAgents` with
`--install-gui-path`):

| File | What is written | Why |
| ---- | --------------- | --- |
| `android/gradle/gradle-daemon-jvm.properties` | `toolchainVersion=<17\|21>` | §3 — the actual fix |
| `android/gradle.properties` | managed block: `org.gradle.java.installations.paths`, `…auto-download=false`, `org.gradle.jvmargs`, `reactNativeArchitectures` | local JDK discovery, faster IDE builds |
| `android/local.properties` | `sdk.dir=<detected SDK>` | prebuild does not create it |
| `~/Library/LaunchAgents/ru.rawradio.gradle-path.plist` | only with `--install-gui-path` | §4, Dock launches |

The `gradle.properties` block is delimited by `# >>> RAW Radio local dev overrides >>>` /
`# <<< RAW Radio local dev overrides <<<` and is **replaced**, not appended, so re-running the
script is idempotent. Nothing is ever written outside those paths, and no detected path is
hard-coded anywhere in the repository.

### Flags

| Flag | Effect |
| ---- | ------ |
| `--skip-prebuild` | re-apply local settings without regenerating `android/` |
| `--verify` | afterwards run `./gradlew --version` and `./gradlew :app:tasks` (the same configuration work a Studio sync does) |
| `--abis=<list>` / `--abis=all` | override the ABI list (§5) |
| `--jdk-major=17\|21` | prefer the other supported JDK |
| `--install-gui-path` / `--uninstall-gui-path` | GUI PATH agent (§4) |
| `--help` | usage |

---

## 7. Verifying a local setup

```bash
# regenerate + apply + prove Gradle can configure the project
scripts/prepare-android-studio.sh --verify

# debug build (what Studio's "Run" does)
cd android && ./gradlew :app:assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk

# release build signed with your local keystore — see RELEASING.md §5
```

`./gradlew :app:tasks` is a good non-interactive stand-in for a Studio sync: it configures every
module, which is exactly the phase that used to fail.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| `IllegalStateException: WARNING: A restricted method in java.lang.System has been called` | the Gradle daemon is on JDK 24/25. Re-run `scripts/prepare-android-studio.sh`; confirm with `cd android && ./gradlew --version` that "Daemon JVM" says 17/21 |
| `Cannot run program "node"` | Studio was launched without `node` on `PATH` — use `scripts/open-android-studio.sh` or `--install-gui-path` (§4) |
| `No JDK 17 or 21 found` | install one (`brew install --cask temurin@17`) and re-run the script |
| `Unable to download toolchain matching the requirements` | something rewrote `gradle/gradle-daemon-jvm.properties` without the local JDK paths — re-run the script |
| Studio asks for the Android SDK location | `ANDROID_HOME` is unset and the SDK is not in a standard location; re-run the script with `ANDROID_HOME` exported |
| `local.properties` / `.idea/` disappeared | expected — `prebuild --clean` wiped `android/`; re-run the script |
| Sync works but "Run" builds all four ABIs | an old `gradle.properties` survived; re-run the script (§5) |
| Everything fails after switching branches | `android/` is generated: `scripts/prepare-android-studio.sh` (it runs `prebuild --clean` for you) |

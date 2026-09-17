#!/usr/bin/env bash
#
# release-local.sh — build a signed release APK on this machine and publish it as a GitHub
# Release. The tag is the release marker; CI never overwrites what you built here.
#
# Why local first
# ---------------
# The CI build (`.github/workflows/release.yml`) compiles ~50 native modules and takes
# ~20 minutes per release, and every rebuild produces a different binary (Gradle/AAPT2
# timestamps), so the asset's SHA-256 is not reproducible. Building here and shipping the
# exact artifact gives one build → one hash → one release, and the CI copy of the build is
# skipped automatically (see the workflow's `preflight` job + release gate).
#
# Usage
# -----
#   scripts/release-local.sh                        # version from app.json
#   scripts/release-local.sh --version=0.2.0        # version (and tag app-v0.2.0)
#   scripts/release-local.sh --no-publish           # build + verify only, no git/gh changes
#   scripts/release-local.sh --dry-run              # same as --no-publish, extra verbose
#   scripts/release-local.sh --abis=arm64-v8a       # override ABIs (default: universal)
#   scripts/release-local.sh --skip-prebuild        # reuse the current android/ project
#   scripts/release-local.sh --notes-file=NOTES.md  # release body instead of generated notes
#   scripts/release-local.sh --yes                  # no confirmation prompts
#
# Credentials (never passed on the command line)
# ----------------------------------------------
# Exported by you, or typed when prompted (input is hidden, nothing lands in shell history):
#   KEYSTORE_PATH      path to the release keystore (default: ./release.keystore)
#   KEYSTORE_PASSWORD  store password
#   KEY_ALIAS          key alias (default: raw-radio)
#   KEY_PASSWORD       key password (defaults to KEYSTORE_PASSWORD; PKCS12 uses one password)
#   ANDROID_KEYSTORE_TYPE  pkcs12 (default) or jks
#
# The passwords reach Gradle as `-Pandroid.injected.signing.*` properties — the same channel
# Android Studio and CI use. They are visible in `ps` for the lifetime of the build on this
# (your) machine, and nowhere else: nothing is written to disk or to the repository.
#
# Docs: docs/RELEASING.md §5

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

APK_NAME="raw-radio-universal.apk"
# Universal = 32-bit + 64-bit ARM; matches what CI ships so the stable asset URL carries the
# same kind of build no matter who produced it.
ABIS="armeabi-v7a,arm64-v8a"

VERSION=""
SKIP_PREBUILD=0
PUBLISH=1
ASSUME_YES=0
NOTES_FILE=""
KEYSTORE_PATH="${KEYSTORE_PATH:-${ROOT_DIR}/release.keystore}"
KEY_ALIAS="${KEY_ALIAS:-raw-radio}"
ANDROID_KEYSTORE_TYPE="${ANDROID_KEYSTORE_TYPE:-pkcs12}"

info() { printf '\033[34m·\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# macOS ships shasum, Linux ships sha256sum.
sha256_of() {
  if command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

usage() { sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

for arg in "$@"; do
  case "$arg" in
    -h|--help)          usage ;;
    --version=*)        VERSION="${arg#--version=}" ;;
    --abis=*)           ABIS="${arg#--abis=}" ;;
    --keystore=*)       KEYSTORE_PATH="${arg#--keystore=}" ;;
    --notes-file=*)     NOTES_FILE="${arg#--notes-file=}" ;;
    --skip-prebuild)    SKIP_PREBUILD=1 ;;
    --no-publish|--dry-run) PUBLISH=0 ;;
    --yes|-y)           ASSUME_YES=1 ;;
    *) die "unknown option: $arg (try --help)" ;;
  esac
done

# ─── 1. Version (X.Y.Z) — release marker and tag app-vX.Y.Z ──────────────────
if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('./app.json').expo.version")"
fi
VERSION="${VERSION#v}"
VERSION="${VERSION#app-v}"
case "$VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) die "--version must look like 1.2.3 (got '$VERSION')" ;;
esac
TAG="app-v${VERSION}"

# ─── 2. Credentials — hidden input, never argv ───────────────────────────────
ask_secret() { # $1 = env var name, $2 = prompt
  local value
  if [ -n "${!1:-}" ]; then return 0; fi
  [ -t 0 ] || die "$1 is not set and there is no TTY to prompt on (export it or run interactively)"
  read -rsp "$2: " value
  printf '\n' >&2
  export "$1=$value"
  unset value
}

[ -f "$KEYSTORE_PATH" ] || die "keystore not found: $KEYSTORE_PATH (set KEYSTORE_PATH or pass --keystore=PATH)"
ask_secret KEYSTORE_PASSWORD "Keystore password ($(basename "$KEYSTORE_PATH"))"
KEY_PASSWORD="${KEY_PASSWORD:-$KEYSTORE_PASSWORD}"
# Fail before the (long) build if the password/alias do not match the keystore.
keytool -list -keystore "$KEYSTORE_PATH" -storetype "$ANDROID_KEYSTORE_TYPE" \
  -storepass "$KEYSTORE_PASSWORD" -alias "$KEY_ALIAS" > /dev/null \
  || die "keystore/alias/password combination is invalid (alias '$KEY_ALIAS')"
ok "keystore OK: $KEYSTORE_PATH (alias $KEY_ALIAS, $ANDROID_KEYSTORE_TYPE)"

# ─── 3. Repo state — a release must be traceable to a commit ────────────────
[ -d .git ] || die "not a git repository: $ROOT_DIR"
if [ -n "$(git status --porcelain)" ]; then
  warn "working tree is dirty — the released APK would not match a clean commit:"
  git status --short >&2
  if [ "$ASSUME_YES" -ne 1 ] && [ "$PUBLISH" -eq 1 ]; then
    [ -t 0 ] || die "dirty working tree (run with --yes to override)"
    printf '\033[33m? Continue anyway? [y/N] \033[0m' >&2
    read -r answer
    case "$answer" in [yY]*) ;; *) die "aborted" ;; esac
  fi
fi
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
[ -n "$REPO" ] || die "could not resolve the GitHub repository (run 'gh auth login')"

info "Version : $VERSION  (tag $TAG)"
info "ABIs    : $ABIS"
info "Repo    : $REPO"
[ "$PUBLISH" -eq 1 ] || info "Publish : no (--no-publish)"
echo ""

# ─── 4. app.json mutation (CI-parity), restored on exit ─────────────────────
APP_JSON_BACKUP="$(mktemp)"
cp app.json "$APP_JSON_BACKUP"
restore_app_json() { cp "$APP_JSON_BACKUP" app.json && rm -f "$APP_JSON_BACKUP"; }
trap restore_app_json EXIT

# Same script as CI: version from the tag, monotonic versionCode, OneSignal "production".
RELEASE_VERSION="v$VERSION" node scripts/prepare-release.mjs
VERSION_CODE="$(node -p "require('./app.json').expo.android.versionCode")"

# ─── 5. Native project ──────────────────────────────────────────────────────
if [ "$SKIP_PREBUILD" -eq 1 ]; then
  [ -f android/gradle.properties ] || die "android/ is missing — drop --skip-prebuild"
  info "skipping expo prebuild (--skip-prebuild)"
else
  [ -d node_modules ] || die "node_modules missing — run 'npm ci' first"
  info "expo prebuild --platform android --clean"
  EXPO_NO_TELEMETRY=1 ./node_modules/.bin/expo prebuild --platform android --clean --no-install
fi

# On macOS the helper pins the Gradle daemon to JDK 17/21 (JDK 24+ breaks AGP's prefab task)
# and writes local.properties. CI does not need it (Temurin 17 launcher).
if [ -x scripts/prepare-android-studio.sh ] && [ "$(uname -s)" = "Darwin" ]; then
  info "applying local Android settings (scripts/prepare-android-studio.sh --skip-prebuild)"
  scripts/prepare-android-studio.sh --skip-prebuild
fi

grep -qE '^org\.gradle\.jvmargs=.*-Xmx' android/gradle.properties \
  || warn "android/gradle.properties has no org.gradle.jvmargs — the daemon may OOM (see plugins/withGradleJvmArgs.js)"

# ─── 6. Build (same flags as CI, including the deliberate lint skip) ────────
info "gradle assembleRelease (10–20 min on a laptop)…"
(
  cd android
  chmod +x gradlew
  ./gradlew assembleRelease --stacktrace \
    -x lint \
    -x lintVitalRelease \
    -x lintVitalAnalyzeRelease \
    -x lintVitalReportRelease \
    -Pandroid.injected.signing.store.file="$KEYSTORE_PATH" \
    -Pandroid.injected.signing.store.password="$KEYSTORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$KEY_PASSWORD" \
    -Pandroid.injected.signing.store.type="$ANDROID_KEYSTORE_TYPE" \
    -PreactNativeArchitectures="$ABIS"
)

APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK_SRC" ] || die "release APK not found at $APK_SRC"
# Not `dist/`: that is where `npx expo export --platform web` writes (and it wipes its output
# directory), so the APK would be deleted by a web export. git-ignored.
OUT_DIR="build-artifacts"
mkdir -p "$OUT_DIR"
cp "$APK_SRC" "$OUT_DIR/$APK_NAME"

# ─── 7. Structure + signature gate (identical code to CI) ───────────────────
scripts/verify-apk.sh \
  --apk "$OUT_DIR/$APK_NAME" \
  --keystore "$KEYSTORE_PATH" \
  --storepass "$KEYSTORE_PASSWORD" \
  --alias "$KEY_ALIAS" \
  --storetype "$ANDROID_KEYSTORE_TYPE" \
  --expect-version-code "$VERSION_CODE"

SHA256="$(sha256_of "$OUT_DIR/$APK_NAME")"
SIZE="$(du -h "$OUT_DIR/$APK_NAME" | awk '{print $1}')"
ok "APK ready: $OUT_DIR/$APK_NAME ($SIZE, sha256 $SHA256)"

if [ "$PUBLISH" -ne 1 ]; then
  info "not publishing (--no-publish). Nothing in git/GitHub was modified."
  exit 0
fi

# ─── 8. Tag + release ───────────────────────────────────────────────────────
# The tag is pushed first (that is what makes it a release marker and what triggers CI), then
# the release is created within a second or two — well before the CI runner finishes spinning
# up, so the workflow's preflight sees it and skips its own build.
HEAD_SHA="$(git rev-parse HEAD)"
if git rev-parse -q --verify "refs/tags/$TAG" > /dev/null; then
  [ "$(git rev-list -n1 "$TAG")" = "$HEAD_SHA" ] \
    || die "tag $TAG already exists and does not point at HEAD ($HEAD_SHA) — nothing was published"
  info "tag $TAG already exists locally and points at HEAD"
else
  git tag -a "$TAG" -m "RAW Radio App $VERSION"
  ok "created tag $TAG ($HEAD_SHA)"
fi

git push origin "$TAG"
ok "pushed tag $TAG"

if gh release view "$TAG" --repo "$REPO" > /dev/null 2>&1; then
  warn "release $TAG already exists — re-uploading the asset with --clobber (release body kept)"
  gh release upload "$TAG" "$OUT_DIR/$APK_NAME" --repo "$REPO" --clobber
  gh release edit "$TAG" --repo "$REPO" --title "RAW Radio App v$VERSION" > /dev/null
else
  if [ -n "$NOTES_FILE" ]; then
    [ -f "$NOTES_FILE" ] || die "notes file not found: $NOTES_FILE"
    gh release create "$TAG" "$OUT_DIR/$APK_NAME" \
      --repo "$REPO" --verify-tag \
      --title "RAW Radio App v$VERSION" \
      --notes-file "$NOTES_FILE"
  else
    gh release create "$TAG" "$OUT_DIR/$APK_NAME" \
      --repo "$REPO" --verify-tag \
      --title "RAW Radio App v$VERSION" \
      --generate-notes
  fi
fi

# ─── 9. Verify what is actually published ───────────────────────────────────
ASSETS="$(gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[].name')"
printf '%s\n' "$ASSETS" | grep -qx "$APK_NAME" \
  || die "release $TAG does not carry an asset named '$APK_NAME' (got: ${ASSETS:-none})"

ok "published $TAG with asset $APK_NAME"
echo ""
echo "Stable download URL (always the newest release):"
echo "  https://github.com/${REPO}/releases/latest/download/${APK_NAME}"
echo ""
echo "CI (${TAG}) will skip its own build because the release already exists."
echo "SHA-256 of the shipped APK: ${SHA256}"

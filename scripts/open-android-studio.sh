#!/usr/bin/env bash
#
# open-android-studio.sh — launch Android Studio with an environment in which the
# generated Gradle scripts can actually find `node`.
#
# Why
# ---
# The generated `android/settings.gradle`, `android/app/build.gradle` and the compiled
# expo / React Native Gradle plugins all shell out to the literal command `node`:
#
#   settings.gradle : providers.exec { commandLine("node", "--print", ...) }
#   app/build.gradle: ["node", "-e", "require('expo/scripts/resolveAppEntry')", ...].execute(...)
#   ExpoAutolinkingPlugin (Kotlin): spec.commandLine("node", "--no-warnings", ...)
#
# The Kotlin plugins hard-code the name, so no Gradle property can redirect it — `node`
# must be on the PATH of the Gradle daemon, which inherits the environment of the process
# that started Android Studio.
#
# Launched from the Dock / Finder / Spotlight, macOS gives an app launchd's minimal PATH
# (/usr/bin:/bin:/usr/sbin:/sbin — where node is never installed), and Gradle sync dies with:
#
#   Cannot run program "node" (in directory ".../android"): error=2, No such file or directory
#
# This wrapper resolves node, puts it on PATH and then exec's Studio's own launcher binary
# *directly* (not via `open`), so the environment is inherited. Studio is detached with
# nohup so closing this terminal does not kill the IDE.
#
# Prefer it over a LaunchAgents hack: no system-wide state, nothing to remember to undo.
# If you really want Dock launches to work, run
#   scripts/prepare-android-studio.sh --install-gui-path
#
# Usage
# -----
#   scripts/open-android-studio.sh                # opens <repo>/android
#   scripts/open-android-studio.sh <project-dir>
#   ANDROID_STUDIO_HOME=/path/to/studio scripts/open-android-studio.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
else
  C_RESET=''; C_RED=''; C_GREEN=''; C_YELLOW=''
fi
die()  { printf '%s\n' "${C_RED}✖ $*${C_RESET}" >&2; exit 1; }
warn() { printf '%s\n' "${C_YELLOW}!${C_RESET} $*" >&2; }

PROJECT_DIR="${1:-$ROOT_DIR/android}"

# ── 1. node ──────────────────────────────────────────────────────────────────
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for glob in "$HOME/.nvm/versions/node"/*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$glob" ]; then NODE_BIN="$glob"; break; fi
  done
fi
[ -n "$NODE_BIN" ] || die "node not found — it is required for Gradle sync. Install Node.js and retry."

NODE_DIR="$(cd "$(dirname "$NODE_BIN")" && pwd)"
case ":$PATH:" in
  *":$NODE_DIR:"*) ;;
  *) export PATH="$NODE_DIR:$PATH" ;;
esac
printf '%s\n' "${C_GREEN}✔${C_RESET} node: $NODE_BIN ($("$NODE_BIN" --version))"

# ── 2. project dir ───────────────────────────────────────────────────────────
[ -d "$PROJECT_DIR" ] || die "project directory not found: $PROJECT_DIR
   Run 'scripts/prepare-android-studio.sh' first — it generates android/ via expo prebuild."
[ -f "$PROJECT_DIR/settings.gradle" ] || die "$PROJECT_DIR is not a Gradle project.

   Run 'scripts/prepare-android-studio.sh' first — it generates android/ via expo prebuild."

# ── 3. Studio installation ───────────────────────────────────────────────────
STUDIO_BIN=''
if [ -n "${ANDROID_STUDIO_HOME:-}" ]; then
  for rel in 'Contents/MacOS/studio' 'bin/studio.sh'; do
    [ -x "$ANDROID_STUDIO_HOME/$rel" ] && STUDIO_BIN="$ANDROID_STUDIO_HOME/$rel" && break
  done
fi

if [ -z "$STUDIO_BIN" ]; then
  for app in "/Applications/Android Studio.app" "$HOME/Applications/Android Studio.app" \
             "/Applications/Android Studio Preview.app"; do
    if [ -x "$app/Contents/MacOS/studio" ]; then
      STUDIO_BIN="$app/Contents/MacOS/studio"; break
    fi
  done
fi

if [ -z "$STUDIO_BIN" ]; then
  for cand in /opt/android-studio/bin/studio.sh /usr/local/android-studio/bin/studio.sh \
              /snap/bin/android-studio; do
    [ -x "$cand" ] && STUDIO_BIN="$cand" && break
  done
fi

[ -n "$STUDIO_BIN" ] || die "Android Studio not found. Set ANDROID_STUDIO_HOME to its install dir."

printf '%s\n' "${C_GREEN}✔${C_RESET} studio: $STUDIO_BIN"
printf '%s\n' "${C_GREEN}✔${C_RESET} project: $PROJECT_DIR"

# ── 4. launch (detached, env inherited) ──────────────────────────────────────
# Running the binary directly (instead of `open -a`) is the whole point: `open` does not
# pass this shell's environment on to the launched application.
nohup "$STUDIO_BIN" "$PROJECT_DIR" >/dev/null 2>&1 &
disown 2>/dev/null || true

printf '%s\n' "${C_GREEN}✔${C_RESET} Android Studio launching …"
printf '%s\n' "  If Gradle sync still fails, re-run 'scripts/prepare-android-studio.sh --verify'."

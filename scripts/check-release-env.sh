#!/usr/bin/env bash
#
# check-release-env.sh — preflight guard for a RELEASE build.
#
# Why this exists (0.2.0 incident)
# --------------------------------
# A developer's git-ignored `app/.env.local` held
#   EXPO_PUBLIC_API_URL=http://localhost:3001
# `expo prebuild`/Metro load `.env.local` with a HIGHER priority than `.env`, so the local
# value was inlined into the JS bundle (babel-preset-expo replaces `process.env.EXPO_PUBLIC_*`
# at transform time). The shipped `app-v0.2.0` APK therefore talked to localhost — no
# substations beyond `main`, no audio, no chat socket.
#
# The fix is defence in depth:
#   1. `.env.local` containing a local URL is a hard error — a release must not be built
#      while a local override is present (this script).
#   2. The production values are exported into the shell before the build; a shell variable
#      WINS over `.env*` (dotenv never overrides an existing process.env), so even if
#      `.env.local` sneaks back in the build stays correct (release-local.sh).
#   3. `verify-apk.sh` scans the built APK's `assets/index.android.bundle` and refuses to
#      ship a bundle that contains localhost/10.0.2.2 (shared by CI and local). That is the
#      backstop: it inspects the ARTIFACT, not the inputs.
#
# Usage
# -----
#   scripts/check-release-env.sh            # validate, print resolved values
#   eval "$(scripts/check-release-env.sh)"  # validate, then export into the current shell
#
# stdout (tab-separated, only when everything is valid):
#   EXPO_PUBLIC_API_URL<TAB>https://raw-radio.ru
#   EXPO_PUBLIC_WS_URL<TAB>https://raw-radio.ru
# Warnings/progress go to stderr. Exit 0 = safe to release.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ENV_FILE="${ROOT_DIR}/.env"
ENV_LOCAL="${ROOT_DIR}/.env.local"
DEFAULT_PROD_URL="https://raw-radio.ru"

# Any of these in the bundle means the APK cannot reach production.
FORBIDDEN_RE='localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|host\.docker\.internal'

die()  { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
info() { printf '\033[34m·\033[0m %s\n' "$*" >&2; }

# Read KEY from a dotenv file without executing it. `export KEY=` and surrounding quotes are
# tolerated; the LAST occurrence wins (matching dotenv's override semantics).
read_env_var() { # $1 = key, $2 = file
  local key="$1" file="$2" value
  [ -f "$file" ] || return 1
  value="$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=[[:space:]]*//p" "$file" | tail -n1)"
  [ -n "$value" ] || return 1
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

# ─── 1. Refuse to build while a local override is on disk ───────────────────
if [ -f "$ENV_LOCAL" ]; then
  if grep -Eqi "$FORBIDDEN_RE" "$ENV_LOCAL"; then
    printf '\033[31m✖ release env guard: %s contains a local/dev URL:\033[0m\n' "$ENV_LOCAL" >&2
    grep -Eni "$FORBIDDEN_RE" "$ENV_LOCAL" | sed 's/^/    /' >&2 || true
    die "delete $ENV_LOCAL (or remove its local EXPO_PUBLIC_* values) before building a release"
  fi
  warn "$ENV_LOCAL exists but has no local URL — it can still shadow other EXPO_PUBLIC_* values; consider deleting it."
fi

# ─── 2. Resolve the production values (from .env, else the built-in default) ─
PROD_API_URL="$(read_env_var EXPO_PUBLIC_API_URL "$ENV_FILE" || true)"
PROD_WS_URL="$(read_env_var EXPO_PUBLIC_WS_URL "$ENV_FILE" || true)"
PROD_API_URL="${PROD_API_URL:-$DEFAULT_PROD_URL}"
PROD_WS_URL="${PROD_WS_URL:-$DEFAULT_PROD_URL}"

# ─── 3. The resolved values must be public https:// URLs ────────────────────
for pair in "EXPO_PUBLIC_API_URL=$PROD_API_URL" "EXPO_PUBLIC_WS_URL=$PROD_WS_URL"; do
  name="${pair%%=*}"
  value="${pair#*=}"
  [ -n "$value" ] || die "$name resolved to an empty value"
  case "$value" in
    http://*|*localhost*|*127.0.0.1*|*0.0.0.0*|*10.0.2.2*|*host.docker.internal*)
      die "$name must be a public https:// URL for a release build (got '$value')"
      ;;
    https://*) ;;
    *) die "$name must start with https:// for a release build (got '$value')" ;;
  esac
done

info "release env OK: API=$PROD_API_URL WS=$PROD_WS_URL"
printf 'EXPO_PUBLIC_API_URL\t%s\n' "$PROD_API_URL"
printf 'EXPO_PUBLIC_WS_URL\t%s\n' "$PROD_WS_URL"

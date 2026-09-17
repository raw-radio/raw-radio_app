#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  RAW Radio — verify a web export before it is shipped
#
#  Guard against the "stale Metro cache" trap:
#    `npx expo export --platform web` WITHOUT `--clear` reuses a cached
#    Metro bundle and silently ignores changed EXPO_PUBLIC_* values. A build
#    that was meant to be same-origin (empty EXPO_PUBLIC_API_URL /
#    EXPO_PUBLIC_WS_URL) can therefore ship the absolute
#    https://raw-radio.ru URLs baked into the previous bundle — with no
#    warning and no error. This script is the assertion that catches it.
#
#  Rule: no ABSOLUTE raw-radio.ru URL of any scheme may appear in the exported JS
#  bundles — not only `https://raw-radio.ru`, but also `wss://raw-radio.ru`
#  (the socket origin, which is the other half of the same-origin contract) and any
#  subdomain (`https://www.raw-radio.ru`, `https://api.raw-radio.ru`, …). Matching
#  only the bare `https://raw-radio.ru` host left `wss://raw-radio.ru` and
#  subdomains undetected. The only allowed occurrence of the domain is the
#  `copyright@raw-radio.ru` e-mail in the legal copy (no scheme → not matched).
#
#  Usage:
#    bash scripts/verify-web-export.sh            # verifies ./dist
#    bash scripts/verify-web-export.sh path/to/dist
#
#  Exits 0 on success, 1 on a violation or a missing export.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

DIST="${1:-dist}"

die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\033[34m·\033[0m %s\n' "$*"; }

[ -d "${DIST}" ] || die "export directory not found: ${DIST} (run 'npx expo export --platform web --clear' first)"
[ -f "${DIST}/index.html" ] || die "${DIST}/index.html is missing — not an Expo web export"

# Bundles the browser will execute. entry-*.js is the app itself; any other
# emitted chunk is checked too, so a split chunk cannot smuggle the URL in.
# (No `mapfile`: macOS still ships bash 3.2.)
BUNDLE_LIST="$(find "${DIST}" -type f -name '*.js' -path '*_expo*' | sort)"
BUNDLE_COUNT="$(printf '%s\n' "${BUNDLE_LIST}" | grep -c . || true)"

if [ "${BUNDLE_COUNT}" -eq 0 ]; then
  die "no exported JS bundles found under ${DIST}/_expo — the export looks empty"
fi

info "checking ${BUNDLE_COUNT} bundle(s) for absolute raw-radio.ru URLs (any scheme/subdomain)"

# Same-origin assertion. The host part is optional-subdomain (`([a-z0-9.-]+\.)?`) and the
# scheme covers both transports the app uses: http(s) for the API and ws(s) for the socket.
# Case-insensitive: a bundle may contain `HTTPS://WWW.RAW-RADIO.RU`.
URL_RE='(https?|wss?)://([a-z0-9.-]+\.)?raw-radio\.ru'
# Positive character class for the rest of the URL. A positive class avoids the
# nested-quoting gymnastics of `[^"'` )]` (bash 3.2 has no clean way to spell a
# single quote inside a double-quoted regex) and stops exactly where the old class did:
# at `"`, `'`, a backtick, a space and `)`. Hyphen last keeps the range unambiguous.
URL_TAIL='[A-Za-z0-9/._:%?&=#~+@,-]*'

FOUND=""
while IFS= read -r bundle; do
  [ -n "${bundle}" ] || continue
  # Strip the allowed e-mail first (defensive: no scheme, so it is not matched anyway),
  # then look for the domain as an URL host. `sed` on the bundle text keeps this
  # independent of bundler formatting.
  matches="$(sed 's/copyright@raw-radio\.ru//g' "${bundle}" \
    | grep -oiE "${URL_RE}${URL_TAIL}" | sort -u || true)"
  if [ -n "${matches}" ]; then
    FOUND="${FOUND}${bundle#"${DIST}/"}:
${matches}
"
  fi
done <<< "${BUNDLE_LIST}"

if [ -n "${FOUND}" ]; then
  printf '\033[31m✖ absolute raw-radio.ru URLs found in the export:\033[0m\n' >&2
  printf '%s' "${FOUND}" >&2
  echo "" >&2
  die "same-origin assertion FAILED. Rebuild with a clean cache:
    rm -rf dist
    EXPO_PUBLIC_API_URL= EXPO_PUBLIC_WS_URL= npx expo export --platform web --clear
  (without --clear Metro reuses the cached bundle and ignores the env change)"
fi

ok "same-origin assertion passed (no absolute raw-radio.ru URL in the bundles)"

# The self-destruct service worker must reach the export — without it the
# legacy Vite-PWA worker is never evicted (see docs/WEB_STATIC_DEPLOY.md §8).
if [ -f "${DIST}/sw.js" ]; then
  ok "sw.js present (legacy service-worker eviction)"
else
  printf '\033[33m!\033[0m %s\n' "${DIST}/sw.js is missing — app/public/sw.js did not reach the export; the legacy Vite-PWA service worker would never be evicted" >&2
fi

# Legal/static files the site must expose.
for f in robots.txt copyright.html; do
  if [ -f "${DIST}/${f}" ]; then
    ok "${f} present"
  else
    printf '\033[33m!\033[0m %s\n' "${DIST}/${f} is missing — check app/public/" >&2
  fi
done

echo ""
ok "export verified: ${DIST}"

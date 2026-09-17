#!/usr/bin/env bash
#
# verify-apk.sh — assert that an APK is a shippable, release-signed Android package.
#
# Used by BOTH `.github/workflows/release.yml` and `scripts/release-local.sh`, so CI and
# local releases are verified by exactly the same code (the digest comparison used to live
# inline in the workflow and was subtly wrong once — see the `-F': '` / `$NF` note below).
#
# Checks, in order:
#   1. the file exists and is non-empty;
#   2. the manifest is readable and declares `package: name=` + a `launchable-activity`
#      (a truncated/empty APK passes `apksigner verify` on some build-tools versions, and
#      `assembleRelease` no longer runs `lintVital` — see the workflow comment);
#   3. it is signed, and NOT with the Android debug key;
#   4. when --keystore is given, the signing certificate's SHA-256 equals the keystore key's.
#
# Usage:
#   scripts/verify-apk.sh --apk dist/raw-radio-universal.apk
#   scripts/verify-apk.sh --apk app-release.apk \
#     --keystore release.keystore --storepass "$KEYSTORE_PASSWORD" \
#     --alias raw-radio --storetype pkcs12 [--expect-version-code 10000]
#
# Flags:
#   --apk PATH | --apk=PATH                (required)
#   --keystore PATH                        verify the signer against this keystore
#   --storepass PW                         store password (also used as key password for PKCS12)
#   --alias NAME                           key alias inside the keystore
#   --storetype TYPE                       pkcs12 (default) or jks
#   --expect-version-code N                fail unless versionCode == N
#   --apksigner PATH, --aapt2 PATH         override tool lookup
#   -h | --help
#
# Prints machine-readable facts on stdout, e.g.:
#   apk-package=com.rawradio.app
#   apk-version-code=10000
#   apk-cert-sha256=AB12…
# All diagnostics go to stderr. Exit 0 = shippable.

set -euo pipefail

APK=""
KEYSTORE=""
STOREPASS=""
ALIAS=""
STORETYPE="pkcs12"
EXPECT_VERSION_CODE=""
APKSIGNER_OVERRIDE=""
AAPT2_OVERRIDE=""

die() { printf 'verify-apk: %s\n' "$*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apk) APK="${2:-}"; shift 2 ;;
    --apk=*) APK="${1#--apk=}"; shift ;;
    --keystore) KEYSTORE="${2:-}"; shift 2 ;;
    --keystore=*) KEYSTORE="${1#--keystore=}"; shift ;;
    --storepass) STOREPASS="${2:-}"; shift 2 ;;
    --storepass=*) STOREPASS="${1#--storepass=}"; shift ;;
    --alias) ALIAS="${2:-}"; shift 2 ;;
    --alias=*) ALIAS="${1#--alias=}"; shift ;;
    --storetype) STORETYPE="${2:-}"; shift 2 ;;
    --storetype=*) STORETYPE="${1#--storetype=}"; shift ;;
    --expect-version-code) EXPECT_VERSION_CODE="${2:-}"; shift 2 ;;
    --expect-version-code=*) EXPECT_VERSION_CODE="${1#--expect-version-code=}"; shift ;;
    --apksigner) APKSIGNER_OVERRIDE="${2:-}"; shift 2 ;;
    --apksigner=*) APKSIGNER_OVERRIDE="${1#--apksigner=}"; shift ;;
    --aapt2) AAPT2_OVERRIDE="${2:-}"; shift 2 ;;
    --aapt2=*) AAPT2_OVERRIDE="${1#--aapt2=}"; shift ;;
    -h|--help) sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$APK" ] || die "--apk is required"
[ -f "$APK" ] || die "APK not found: $APK"
[ -s "$APK" ] || die "APK is empty: $APK"

if [ -n "$KEYSTORE" ]; then
  [ -f "$KEYSTORE" ] || die "keystore not found: $KEYSTORE"
  [ -n "$STOREPASS" ] || die "--storepass is required together with --keystore"
  [ -n "$ALIAS" ] || die "--alias is required together with --keystore"
fi

# ─── Tool lookup: build-tools/<highest version>/… ────────────────────────────
# Same resolution order as the workflow/Android Studio; CI sets ANDROID_HOME.
find_build_tool() {
  local tool="$1" sdk candidate
  for sdk in \
    "${ANDROID_HOME:-}" \
    "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" \
    "$HOME/Android/Sdk" \
    "$HOME/Android/sdk" \
    /usr/local/share/android-sdk \
    /opt/android-sdk
  do
    [ -n "$sdk" ] && [ -d "$sdk/build-tools" ] || continue
    candidate="$(ls -1 "$sdk"/build-tools/*/"$tool" 2>/dev/null | sort -V | tail -1 || true)"
    if [ -n "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
  done
  return 1
}

APKSIGNER="$APKSIGNER_OVERRIDE"
if [ -z "$APKSIGNER" ]; then
  APKSIGNER="$(find_build_tool apksigner || true)"
fi
[ -n "$APKSIGNER" ] || die "apksigner not found (set ANDROID_HOME or pass --apksigner)"

AAPT2="$AAPT2_OVERRIDE"
if [ -z "$AAPT2" ]; then
  AAPT2="$(find_build_tool aapt2 || true)"
fi
[ -n "$AAPT2" ] || die "aapt2 not found (set ANDROID_HOME or pass --aapt2)"

# ─── 2. Structure ───────────────────────────────────────────────────────────
BADGING="$("$AAPT2" dump badging "$APK" 2>/dev/null || true)"
[ -n "$BADGING" ] || die "aapt2 could not read the APK manifest — the file is corrupt: $APK"

PKG_LINE="$(printf '%s\n' "$BADGING" | grep -m1 '^package:' || true)"
PKG="$(printf '%s' "$PKG_LINE" | sed -n "s/.*package: name='\([^']*\)'.*/\1/p")"
[ -n "$PKG" ] || die "APK declares no package name (not a valid APK): $APK"
printf '%s\n' "$BADGING" | grep -q '^launchable-activity:' \
  || die "APK has no launchable-activity — it would install but never open: $APK"

VERSION_CODE="$(printf '%s' "$PKG_LINE" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p")"
if [ -n "$EXPECT_VERSION_CODE" ] && [ "$VERSION_CODE" != "$EXPECT_VERSION_CODE" ]; then
  die "APK versionCode is '$VERSION_CODE', expected '$EXPECT_VERSION_CODE'"
fi

printf 'apk-package=%s\n' "$PKG"
printf 'apk-version-code=%s\n' "${VERSION_CODE:-unknown}"

# ─── 3. Signature present, and not the debug key ────────────────────────────
CERTS="$("$APKSIGNER" verify --print-certs "$APK" 2>&1 || true)"
if ! "$APKSIGNER" verify "$APK" > /dev/null 2>&1; then
  printf '%s\n' "$CERTS" >&2
  die "apksigner verify FAILED — the APK is unsigned or its signature is broken"
fi

if printf '%s' "$CERTS" | grep -qi 'CN=Android Debug'; then
  die "APK is signed with the DEBUG keystore — signing secrets are wrong/missing"
fi

norm() { tr -d ':' | tr '[:lower:]' '[:upper:]'; }
# apksigner prints "V2 Signer: certificate SHA-256 digest: <hex>". The digest is the LAST
# ": "-separated field — NOT $2, which is the label ("certificate SHA-256 digest").
ACTUAL="$(printf '%s\n' "$CERTS" | awk -F': ' '/certificate SHA-256 digest/ {print $NF; exit}')"
[ -n "$ACTUAL" ] || die "could not read a certificate SHA-256 digest from apksigner output"

if [ -n "$KEYSTORE" ]; then
  EXPECTED="$(keytool -list -v \
      -keystore "$KEYSTORE" \
      -storetype "$STORETYPE" \
      -storepass "$STOREPASS" \
      -alias "$ALIAS" 2>/dev/null | awk '/SHA256:/ {print $2; exit}')"
  [ -n "$EXPECTED" ] || die "could not read the SHA-256 fingerprint of alias '$ALIAS' from $KEYSTORE"
  if [ "$(printf '%s' "$EXPECTED" | norm)" != "$(printf '%s' "$ACTUAL" | norm)" ]; then
    die "APK signer ($ACTUAL) does not match the release keystore key ($EXPECTED)"
  fi
  printf 'apk-signature=OK (matches keystore %s)\n' "$ALIAS" >&2
else
  printf 'apk-signature=OK (signer not compared against a keystore)\n' >&2
fi

printf 'apk-cert-sha256=%s\n' "$(printf '%s' "$ACTUAL" | norm)"

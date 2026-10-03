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
#   4. when --keystore is given, the signing certificate's SHA-256 equals the keystore key's;
#   5. the JS bundle (`assets/index.android.bundle`) contains the production host and NO local
#      URL (localhost/10.0.2.2/…). This is the backstop against the app-v0.2.0 regression,
#      where a developer's `.env.local` leaked http://localhost:3001 into the shipped APK.
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
#   --storepass-env VAR                    read the store password from $VAR instead of argv
#   --alias NAME                           key alias inside the keystore
#   --storetype TYPE                       pkcs12 (default) or jks
#   --expect-version-code N                fail unless versionCode == N
#   --expect-bundle-host HOST              host the bundle must contain (default raw-radio.ru;
#                                          empty string disables the positive check)
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
STOREPASS_ENV=""
ALIAS=""
STORETYPE="pkcs12"
EXPECT_VERSION_CODE=""
# Host that must appear in the JS bundle; set to an empty string to disable the positive check.
EXPECT_BUNDLE_HOST="${EXPECT_BUNDLE_HOST:-raw-radio.ru}"
APKSIGNER_OVERRIDE=""
AAPT2_OVERRIDE=""

die() { printf 'verify-apk: %s\n' "$*" >&2; exit 1; }

# Value-taking flags: a missing value must say so, not fall out of `shift 2` with no message.
opt_value() { # $1 = flag name, $2 = remaining arg count
  [ "$2" -ge 2 ] || die "$1 needs a value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apk) opt_value "--apk" "$#"; APK="$2"; shift 2 ;;
    --apk=*) APK="${1#--apk=}"; shift ;;
    --keystore) opt_value "--keystore" "$#"; KEYSTORE="$2"; shift 2 ;;
    --keystore=*) KEYSTORE="${1#--keystore=}"; shift ;;
    --storepass) opt_value "--storepass" "$#"; STOREPASS="$2"; shift 2 ;;
    --storepass=*) STOREPASS="${1#--storepass=}"; shift ;;
    --storepass-env) opt_value "--storepass-env" "$#"; STOREPASS_ENV="$2"; shift 2 ;;
    --storepass-env=*) STOREPASS_ENV="${1#--storepass-env=}"; shift ;;
    --alias) opt_value "--alias" "$#"; ALIAS="$2"; shift 2 ;;
    --alias=*) ALIAS="${1#--alias=}"; shift ;;
    --storetype) opt_value "--storetype" "$#"; STORETYPE="$2"; shift 2 ;;
    --storetype=*) STORETYPE="${1#--storetype=}"; shift ;;
    --expect-version-code) opt_value "--expect-version-code" "$#"; EXPECT_VERSION_CODE="$2"; shift 2 ;;
    --expect-version-code=*) EXPECT_VERSION_CODE="${1#--expect-version-code=}"; shift ;;
    --expect-bundle-host) opt_value "--expect-bundle-host" "$#"; EXPECT_BUNDLE_HOST="$2"; shift 2 ;;
    --expect-bundle-host=*) EXPECT_BUNDLE_HOST="${1#--expect-bundle-host=}"; shift ;;
    --apksigner) opt_value "--apksigner" "$#"; APKSIGNER_OVERRIDE="$2"; shift 2 ;;
    --apksigner=*) APKSIGNER_OVERRIDE="${1#--apksigner=}"; shift ;;
    --aapt2) opt_value "--aapt2" "$#"; AAPT2_OVERRIDE="$2"; shift 2 ;;
    --aapt2=*) AAPT2_OVERRIDE="${1#--aapt2=}"; shift ;;
    -h|--help)
      # Print the whole leading comment block: the old `sed -n '2,40p'` ran past the usage
      # block and printed real code once the header grew.
      awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$APK" ] || die "--apk is required"
[ -f "$APK" ] || die "APK not found: $APK"
[ -s "$APK" ] || die "APK is empty: $APK"

# ─── Store password: argv, environment variable, or neither ─────────────────
# `--storepass-env VAR` keeps the password out of the process table entirely; resolve it into
# the same variable the rest of the script uses. Prefer it over `--storepass` when both are set.
if [ -n "$STOREPASS_ENV" ]; then
  STOREPASS="${!STOREPASS_ENV:-}"
  [ -n "$STOREPASS" ] || die "--storepass-env $STOREPASS_ENV: environment variable is empty or unset"
fi

if [ -n "$KEYSTORE" ]; then
  [ -f "$KEYSTORE" ] || die "keystore not found: $KEYSTORE"
  [ -n "$STOREPASS" ] || die "--storepass (or --storepass-env) is required together with --keystore"
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
  # Prefer `-storepass:env` (avoids putting the password in argv) when the caller asked for it.
  KEYTOOL_PASS_ARGS=(-storepass "$STOREPASS")
  if [ -n "$STOREPASS_ENV" ]; then
    KEYTOOL_PASS_ARGS=("-storepass:env" "$STOREPASS_ENV")
  fi
  EXPECTED="$(keytool -list -v \
      -keystore "$KEYSTORE" \
      -storetype "$STORETYPE" \
      "${KEYTOOL_PASS_ARGS[@]}" \
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

# ─── 5. JS bundle content — production host present, no local/dev URL ───────
# Root cause of the app-v0.2.0 regression: a developer's git-ignored `.env.local` held
# `EXPO_PUBLIC_API_URL=http://localhost:3001`, which babel-preset-expo inlined into
# `assets/index.android.bundle`. `apksigner` cannot see that, so this step inspects the
# artifact itself. It is shared by CI and `release-local.sh`, so a leaked bundle can never
# be published by either path. Works on plain JS *and* Hermes bytecode (URLs live in the
# string table). The scan is skipped (with a note) if `unzip` is unavailable.
BUNDLE_FORBIDDEN_RE='localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|host\.docker\.internal'

if command -v unzip > /dev/null 2>&1; then
  BUNDLE_TMP="$(mktemp)"
  trap 'rm -f "$BUNDLE_TMP"' EXIT
  if unzip -p "$APK" assets/index.android.bundle > "$BUNDLE_TMP" 2>/dev/null && [ -s "$BUNDLE_TMP" ]; then
    if grep -Eq "$BUNDLE_FORBIDDEN_RE" "$BUNDLE_TMP"; then
      printf 'verify-apk: assets/index.android.bundle contains a local/dev URL — the APK would not reach production:\n' >&2
      grep -Eo "$BUNDLE_FORBIDDEN_RE" "$BUNDLE_TMP" | sort -u | sed 's/^/    /' >&2 || true
      die "local URL baked into the JS bundle — check app/.env.local and EXPO_PUBLIC_* (release-local.sh forces https://raw-radio.ru)"
    fi
    if [ -n "$EXPECT_BUNDLE_HOST" ] && ! grep -qF "$EXPECT_BUNDLE_HOST" "$BUNDLE_TMP"; then
      die "assets/index.android.bundle does not contain '$EXPECT_BUNDLE_HOST' — the release would ship without the production API host"
    fi
    if [ -n "$EXPECT_BUNDLE_HOST" ]; then
      printf 'apk-bundle=OK (no local URLs; %s present)\n' "$EXPECT_BUNDLE_HOST" >&2
    else
      printf 'apk-bundle=OK (no local URLs; positive host check disabled)\n' >&2
    fi
  else
    printf 'verify-apk: note: assets/index.android.bundle not found in APK — bundle URL scan skipped\n' >&2
  fi
else
  printf 'verify-apk: note: unzip not available — bundle URL scan skipped\n' >&2
fi

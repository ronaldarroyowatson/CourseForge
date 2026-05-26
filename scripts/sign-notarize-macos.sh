#!/usr/bin/env bash
set -euo pipefail

APP_PATH=""
DMG_PATH=""
REQUIRE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-path)
      APP_PATH="$2"
      shift 2
      ;;
    --dmg-path)
      DMG_PATH="$2"
      shift 2
      ;;
    --require)
      REQUIRE=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SIGN_IDENTITY="${COURSEFORGE_MAC_SIGN_IDENTITY:-}"
NOTARY_PROFILE="${COURSEFORGE_MAC_NOTARY_PROFILE:-}"

if [[ -z "$SIGN_IDENTITY" ]]; then
  if [[ "$REQUIRE" == "true" ]]; then
    echo "[mac-sign] Signing is required but COURSEFORGE_MAC_SIGN_IDENTITY is not set." >&2
    exit 1
  fi
  echo "[mac-sign] COURSEFORGE_MAC_SIGN_IDENTITY not set; skipping signing/notarization."
  exit 0
fi

if [[ -n "$APP_PATH" ]]; then
  if [[ ! -d "$APP_PATH" ]]; then
    echo "[mac-sign] App path does not exist: $APP_PATH" >&2
    exit 1
  fi

  echo "[mac-sign] Signing app bundle: $APP_PATH"
  codesign --force --deep --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_PATH"
fi

if [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]]; then
  echo "[mac-sign] Signing dmg artifact: $DMG_PATH"
  codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG_PATH"
fi

if [[ -z "$NOTARY_PROFILE" ]]; then
  if [[ "$REQUIRE" == "true" ]]; then
    echo "[mac-sign] Notarization is required but COURSEFORGE_MAC_NOTARY_PROFILE is not set." >&2
    exit 1
  fi
  echo "[mac-sign] COURSEFORGE_MAC_NOTARY_PROFILE not set; skipping notarization."
  exit 0
fi

if [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]]; then
  echo "[mac-sign] Submitting DMG for notarization: $DMG_PATH"
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG_PATH"
fi

if [[ -n "$APP_PATH" && -d "$APP_PATH" ]]; then
  xcrun stapler staple "$APP_PATH" || true
fi

echo "[mac-sign] Signing/notarization flow complete."

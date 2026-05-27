#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.version);" "$REPO_ROOT/package.json")"
ARTIFACT="$REPO_ROOT/release/CourseForge-${VERSION}-macos-portable.zip"
DMG_ARTIFACT="$REPO_ROOT/release/CourseForge-${VERSION}-macos.dmg"

if [[ ! -f "$ARTIFACT" ]]; then
  echo "Missing package artifact: $ARTIFACT" >&2
  exit 1
fi

if [[ ! -f "$DMG_ARTIFACT" ]]; then
  echo "Missing DMG artifact: $DMG_ARTIFACT" >&2
  exit 1
fi

LISTING="$(unzip -l "$ARTIFACT")"

for required in \
  "Start-CourseForge-macos.sh" \
  "AutoUpdate-CourseForge.sh" \
  "Install-CourseForge-macos.sh" \
  "Uninstall-CourseForge-macos.sh" \
  "courseforge-serve.cjs" \
  "courseforge-serve.js" \
  "package-manifest.json"; do
  if ! grep -q "$required" <<<"$LISTING"; then
    echo "Package missing required entry: $required" >&2
    exit 1
  fi
done

for required in \
  "CourseForge.app/Contents/MacOS/CourseForge" \
  "CourseForge.app/Contents/Resources/CourseForge/courseforge-serve.cjs" \
  "CourseForge.app/Contents/Resources/CourseForge/courseforge-serve.js" \
  "CourseForge.app/Contents/Resources/CourseForge/webapp/index.html"; do
  if ! grep -q "$required" <<<"$LISTING"; then
    echo "Package missing app-bundle entry: $required" >&2
    exit 1
  fi
done

ATTACHED_DEVICE=""
ATTACHED_MOUNT=""

detach_existing_image_mounts() {
  local existing_devices
  existing_devices="$(hdiutil info | awk -v img="$DMG_ARTIFACT" '
    /^image-path[[:space:]]*:/ {
      path=$0
      sub(/^image-path[[:space:]]*:[[:space:]]*/, "", path)
      in_image=(path==img)
      next
    }
    in_image && $1 ~ /^\/dev\// { print $1 }
  ' | sort -u)"

  if [[ -z "$existing_devices" ]]; then
    return
  fi

  while IFS= read -r dev; do
    [[ -z "$dev" ]] && continue
    hdiutil detach "$dev" >/dev/null 2>&1 || true
  done <<<"$existing_devices"
}

cleanup() {
  if [[ -n "$ATTACHED_DEVICE" ]]; then
    hdiutil detach "$ATTACHED_DEVICE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

detach_existing_image_mounts
ATTACH_OUTPUT_PLIST="$(hdiutil attach "$DMG_ARTIFACT" -readonly -nobrowse -plist)"
ATTACHED_DEVICE="$(printf '%s' "$ATTACH_OUTPUT_PLIST" | plutil -extract system-entities.0.dev-entry raw - 2>/dev/null || true)"
ATTACHED_MOUNT="$(printf '%s' "$ATTACH_OUTPUT_PLIST" | plutil -extract system-entities.0.mount-point raw - 2>/dev/null || true)"

if [[ -z "$ATTACHED_DEVICE" || "$ATTACHED_DEVICE" == "(null)" ]]; then
  ATTACHED_DEVICE="$(printf '%s' "$ATTACH_OUTPUT_PLIST" | plutil -extract system-entities.1.dev-entry raw - 2>/dev/null || true)"
fi

if [[ -z "$ATTACHED_MOUNT" || ! -d "$ATTACHED_MOUNT" ]]; then
  echo "Could not determine mounted DMG path." >&2
  exit 1
fi

if [[ ! -d "$ATTACHED_MOUNT/CourseForge.app" ]]; then
  echo "DMG missing CourseForge.app." >&2
  exit 1
fi

if [[ ! -L "$ATTACHED_MOUNT/Applications" ]]; then
  echo "DMG missing Applications shortcut symlink." >&2
  exit 1
fi

echo "Verified $ARTIFACT"
echo "Verified $DMG_ARTIFACT"

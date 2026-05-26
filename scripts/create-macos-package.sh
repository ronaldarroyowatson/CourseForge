#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$REPO_ROOT/release"
VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.version);" "$REPO_ROOT/package.json")"
STAGE_DIR="$RELEASE_DIR/CourseForge-${VERSION}-macos"
ARTIFACT="$RELEASE_DIR/CourseForge-${VERSION}-macos-portable.zip"
DMG_ARTIFACT="$RELEASE_DIR/CourseForge-${VERSION}-macos.dmg"
APP_BUNDLE_NAME="CourseForge.app"
APP_BUNDLE_PATH="$STAGE_DIR/$APP_BUNDLE_NAME"
DMG_STAGE_DIR="$RELEASE_DIR/.tmp-macos-dmg-stage"
RW_DMG_PATH="$RELEASE_DIR/.tmp-CourseForge-${VERSION}-macos-rw.dmg"
ICON_SOURCE_PRIMARY="$REPO_ROOT/src/assets/CourseForge.ico"
ICON_SOURCE_FALLBACK="$REPO_ROOT/src/webapp/public/CourseForge.ico"

ZIP_ONLY=false
DMG_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zip-only)
      ZIP_ONLY=true
      shift
      ;;
    --dmg-only)
      DMG_ONLY=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$ZIP_ONLY" == "true" && "$DMG_ONLY" == "true" ]]; then
  echo "--zip-only and --dmg-only cannot be used together." >&2
  exit 1
fi

build_web_assets() {
  if [[ ! -f "$REPO_ROOT/dist/webapp/index.html" ]]; then
    echo "dist/webapp/index.html missing; building webapp bundle for mac package..."
    npm --prefix "$REPO_ROOT" run build
  fi
}

copy_runtime_assets() {
  local payload_root="$1"

  if [[ -d "$REPO_ROOT/dist/webapp" && -f "$REPO_ROOT/dist/webapp/index.html" ]]; then
    cp -R "$REPO_ROOT/dist/webapp" "$payload_root/webapp"
  elif [[ -d "$REPO_ROOT/dist" && -f "$REPO_ROOT/dist/index.html" ]]; then
    cp -R "$REPO_ROOT/dist" "$payload_root/webapp"
  elif [[ -d "$REPO_ROOT/webapp" && -f "$REPO_ROOT/webapp/index.html" ]]; then
    cp -R "$REPO_ROOT/webapp" "$payload_root/webapp"
  else
    echo "Expected runtime-ready webapp assets in dist/ (preferred) or webapp/index.html." >&2
    exit 1
  fi

  [[ -d "$REPO_ROOT/extension" ]] && cp -R "$REPO_ROOT/extension" "$payload_root/extension"
  [[ -f "$REPO_ROOT/scripts/installer/courseforge-serve.js" ]] && cp -f "$REPO_ROOT/scripts/installer/courseforge-serve.js" "$payload_root/courseforge-serve.js"
  [[ -f "$REPO_ROOT/scripts/installer/courseforge-serve.cjs" ]] && cp -f "$REPO_ROOT/scripts/installer/courseforge-serve.cjs" "$payload_root/courseforge-serve.cjs"
  cp -f "$REPO_ROOT/scripts/installer/Start-CourseForge-macos.sh" "$payload_root/Start-CourseForge-macos.sh"
  cp -f "$REPO_ROOT/scripts/installer/AutoUpdate-CourseForge.sh" "$payload_root/AutoUpdate-CourseForge.sh"
  cp -f "$REPO_ROOT/scripts/installer/Install-CourseForge-macos.sh" "$payload_root/Install-CourseForge-macos.sh"
  cp -f "$REPO_ROOT/scripts/installer/Uninstall-CourseForge-macos.sh" "$payload_root/Uninstall-CourseForge-macos.sh"
  cp -f "$REPO_ROOT/package.json" "$payload_root/package-manifest.json"

  chmod +x "$payload_root/Start-CourseForge-macos.sh" \
    "$payload_root/AutoUpdate-CourseForge.sh" \
    "$payload_root/Install-CourseForge-macos.sh" \
    "$payload_root/Uninstall-CourseForge-macos.sh"
}

generate_app_icon() {
  local app_resources="$1"
  local icon_source=""
  local temp_dir
  local iconset_dir
  local base_png

  if [[ -f "$ICON_SOURCE_PRIMARY" ]]; then
    icon_source="$ICON_SOURCE_PRIMARY"
  elif [[ -f "$ICON_SOURCE_FALLBACK" ]]; then
    icon_source="$ICON_SOURCE_FALLBACK"
  else
    echo "No CourseForge icon source found for macOS app icon." >&2
    return
  fi

  if ! command -v sips >/dev/null 2>&1 || ! command -v iconutil >/dev/null 2>&1; then
    echo "sips/iconutil unavailable; skipping .icns generation." >&2
    return
  fi

  temp_dir="$(mktemp -d /tmp/courseforge-iconset.XXXXXX)"
  iconset_dir="$temp_dir/CourseForge.iconset"
  base_png="$temp_dir/base.png"
  mkdir -p "$iconset_dir"

  sips -s format png "$icon_source" --out "$base_png" >/dev/null

  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$base_png" --out "$iconset_dir/icon_${size}x${size}.png" >/dev/null
    sips -z "$((size * 2))" "$((size * 2))" "$base_png" --out "$iconset_dir/icon_${size}x${size}@2x.png" >/dev/null
  done

  iconutil -c icns "$iconset_dir" -o "$app_resources/CourseForge.icns"
  rm -rf "$temp_dir"
}

generate_dmg_background() {
  local bg_path="$1"

  mkdir -p "$(dirname "$bg_path")"

  if ! command -v swift >/dev/null 2>&1; then
    return
  fi

  swift - "$bg_path" <<'SWIFT'
import AppKit

let outputPath = CommandLine.arguments[1]
let size = NSSize(width: 760, height: 420)
let image = NSImage(size: size)

image.lockFocus()
let rect = NSRect(origin: .zero, size: size)
NSColor(calibratedRed: 0.94, green: 0.97, blue: 1.0, alpha: 1.0).setFill()
rect.fill()

let accentRect = NSRect(x: 0, y: 320, width: size.width, height: 100)
NSColor(calibratedRed: 0.82, green: 0.90, blue: 1.0, alpha: 1.0).setFill()
accentRect.fill()

let title = "Install CourseForge"
let help = "Drag CourseForge.app to Applications to install"
let arrow = "→"

let titleAttrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.boldSystemFont(ofSize: 34),
  .foregroundColor: NSColor(calibratedRed: 0.10, green: 0.22, blue: 0.40, alpha: 1.0)
]
let helpAttrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 20, weight: .medium),
  .foregroundColor: NSColor(calibratedRed: 0.15, green: 0.30, blue: 0.45, alpha: 1.0)
]
let arrowAttrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 72, weight: .bold),
  .foregroundColor: NSColor(calibratedRed: 0.13, green: 0.44, blue: 0.75, alpha: 1.0)
]

title.draw(at: NSPoint(x: 30, y: 352), withAttributes: titleAttrs)
help.draw(at: NSPoint(x: 30, y: 320), withAttributes: helpAttrs)
arrow.draw(at: NSPoint(x: 358, y: 150), withAttributes: arrowAttrs)

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:])
else {
  exit(1)
}

try png.write(to: URL(fileURLWithPath: outputPath))
SWIFT
}

build_app_bundle() {
  local app_bundle="$1"
  local app_contents="$app_bundle/Contents"
  local app_macos="$app_contents/MacOS"
  local app_resources="$app_contents/Resources"
  local payload_root="$app_resources/CourseForge"

  mkdir -p "$app_macos" "$payload_root"
  copy_runtime_assets "$payload_root"

  cp -f "$REPO_ROOT/scripts/installer/Start-CourseForge-macos.sh" "$app_macos/CourseForge"
  chmod +x "$app_macos/CourseForge"
  generate_app_icon "$app_resources"

  cat >"$app_contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>CourseForge</string>
  <key>CFBundleDisplayName</key>
  <string>CourseForge</string>
  <key>CFBundleIdentifier</key>
  <string>com.ronaldarroyowatson.CourseForge</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleExecutable</key>
  <string>CourseForge</string>
  <key>CFBundleIconFile</key>
  <string>CourseForge.icns</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
PLIST
}

create_portable_zip() {
  rm -f "$ARTIFACT"
  ditto -c -k --sequesterRsrc --keepParent "$STAGE_DIR" "$ARTIFACT"
  echo "Created $ARTIFACT"
}

create_dmg() {
  local attach_output_plist
  local dmg_device
  local mount_path
  local bg_dir
  local bg_png

  rm -rf "$DMG_STAGE_DIR"
  mkdir -p "$DMG_STAGE_DIR"
  cp -R "$APP_BUNDLE_PATH" "$DMG_STAGE_DIR/$APP_BUNDLE_NAME"
  ln -s /Applications "$DMG_STAGE_DIR/Applications"

  rm -f "$RW_DMG_PATH" "$DMG_ARTIFACT"
  hdiutil create -size 512m -fs HFS+ -volname "CourseForge" -ov "$RW_DMG_PATH" >/dev/null

  attach_output_plist="$(hdiutil attach "$RW_DMG_PATH" -readwrite -nobrowse -plist)"
  dmg_device="$(printf '%s' "$attach_output_plist" | plutil -extract system-entities.0.dev-entry raw - 2>/dev/null || true)"
  mount_path="$(printf '%s' "$attach_output_plist" | plutil -extract system-entities.1.mount-point raw - 2>/dev/null || true)"

  if [[ -z "$mount_path" || "$mount_path" == "(null)" ]]; then
    mount_path="$(printf '%s' "$attach_output_plist" | plutil -extract system-entities.0.mount-point raw - 2>/dev/null || true)"
  fi

  if [[ -z "$dmg_device" || "$dmg_device" == "(null)" ]]; then
    dmg_device="$(printf '%s' "$attach_output_plist" | plutil -extract system-entities.1.dev-entry raw - 2>/dev/null || true)"
  fi

  if [[ -z "$dmg_device" || -z "$mount_path" ]]; then
    echo "Failed to attach writable DMG for layout." >&2
    exit 1
  fi

  cp -R "$DMG_STAGE_DIR/$APP_BUNDLE_NAME" "$mount_path/$APP_BUNDLE_NAME"
  ln -s /Applications "$mount_path/Applications"

  bg_dir="$mount_path/.background"
  bg_png="$bg_dir/installer-background.png"
  generate_dmg_background "$bg_png"

  if [[ "${COURSEFORGE_MAC_APPLY_FINDER_LAYOUT:-1}" == "1" ]]; then
    python3 - "$mount_path" <<'PY' || true
import subprocess
import sys

mount_path = sys.argv[1]
script = f'''
tell application "Finder"
  tell disk "CourseForge"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {{120, 120, 880, 540}}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to 128
    set text size of opts to 14
    try
      set background picture of opts to file ".background:installer-background.png"
    end try
    set position of item "CourseForge.app" of container window to {{190, 220}}
    set position of item "Applications" of container window to {{570, 220}}
    close
    open
    update without registering applications
    delay 1
  end tell
end tell
'''

try:
    subprocess.run(["osascript", "-"], input=script, text=True, check=True, timeout=20)
except subprocess.TimeoutExpired:
    print("[macos-dmg] Finder layout timed out; proceeding without explicit icon arrangement.", flush=True)
except subprocess.CalledProcessError as exc:
    print(f"[macos-dmg] Finder layout skipped: {{exc}}", flush=True)
PY
  fi

  chmod -Rf go-w "$mount_path" || true
  sync
  hdiutil detach "$dmg_device" >/dev/null

  hdiutil convert "$RW_DMG_PATH" -format UDZO -o "$DMG_ARTIFACT" >/dev/null
  rm -f "$RW_DMG_PATH"
  rm -rf "$DMG_STAGE_DIR"
  echo "Created $DMG_ARTIFACT"
}

if [[ "$DMG_ONLY" != "true" ]]; then
  build_web_assets
  rm -rf "$STAGE_DIR"
  mkdir -p "$STAGE_DIR"

  copy_runtime_assets "$STAGE_DIR"
  build_app_bundle "$APP_BUNDLE_PATH"
  create_portable_zip
else
  if [[ ! -d "$APP_BUNDLE_PATH" ]]; then
    echo "Missing app bundle at $APP_BUNDLE_PATH. Run package:macos first or omit --dmg-only." >&2
    exit 1
  fi
fi

if [[ "$ZIP_ONLY" != "true" ]]; then
  create_dmg
fi

if [[ -f "$REPO_ROOT/scripts/sign-notarize-macos.sh" ]]; then
  sign_args=(--app-path "$APP_BUNDLE_PATH" --dmg-path "$DMG_ARTIFACT")
  if [[ "${COURSEFORGE_MAC_REQUIRE_SIGNING:-0}" == "1" ]]; then
    sign_args+=(--require)
  fi
  bash "$REPO_ROOT/scripts/sign-notarize-macos.sh" "${sign_args[@]}"
fi

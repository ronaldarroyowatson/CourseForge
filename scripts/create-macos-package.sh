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
  rm -rf "$DMG_STAGE_DIR"
  mkdir -p "$DMG_STAGE_DIR"
  cp -R "$APP_BUNDLE_PATH" "$DMG_STAGE_DIR/$APP_BUNDLE_NAME"
  ln -s /Applications "$DMG_STAGE_DIR/Applications"

  rm -f "$DMG_ARTIFACT"
  hdiutil create \
    -volname "CourseForge" \
    -srcfolder "$DMG_STAGE_DIR" \
    -ov \
    -format UDZO \
    "$DMG_ARTIFACT" >/dev/null

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
  bash "$REPO_ROOT/scripts/sign-notarize-macos.sh" --app-path "$APP_BUNDLE_PATH" --dmg-path "$DMG_ARTIFACT"
fi

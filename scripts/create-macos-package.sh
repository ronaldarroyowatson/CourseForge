#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$REPO_ROOT/release"
VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.version);" "$REPO_ROOT/package.json")"
STAGE_DIR="$RELEASE_DIR/CourseForge-${VERSION}-macos"
ARTIFACT="$RELEASE_DIR/CourseForge-${VERSION}-macos-portable.zip"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

if [[ ! -f "$REPO_ROOT/dist/webapp/index.html" ]]; then
  echo "dist/webapp/index.html missing; building webapp bundle for mac package..."
  npm --prefix "$REPO_ROOT" run build
fi

if [[ -d "$REPO_ROOT/dist/webapp" && -f "$REPO_ROOT/dist/webapp/index.html" ]]; then
  cp -R "$REPO_ROOT/dist/webapp" "$STAGE_DIR/webapp"
elif [[ -d "$REPO_ROOT/dist" && -f "$REPO_ROOT/dist/index.html" ]]; then
  cp -R "$REPO_ROOT/dist" "$STAGE_DIR/webapp"
elif [[ -d "$REPO_ROOT/webapp" && -f "$REPO_ROOT/webapp/index.html" ]]; then
  cp -R "$REPO_ROOT/webapp" "$STAGE_DIR/webapp"
else
  echo "Expected runtime-ready webapp assets in dist/ (preferred) or webapp/index.html." >&2
  exit 1
fi

[[ -d "$REPO_ROOT/extension" ]] && cp -R "$REPO_ROOT/extension" "$STAGE_DIR/extension"
[[ -f "$REPO_ROOT/scripts/installer/courseforge-serve.js" ]] && cp -f "$REPO_ROOT/scripts/installer/courseforge-serve.js" "$STAGE_DIR/courseforge-serve.js"
[[ -f "$REPO_ROOT/scripts/installer/courseforge-serve.cjs" ]] && cp -f "$REPO_ROOT/scripts/installer/courseforge-serve.cjs" "$STAGE_DIR/courseforge-serve.cjs"
cp -f "$REPO_ROOT/scripts/installer/Start-CourseForge-macos.sh" "$STAGE_DIR/Start-CourseForge-macos.sh"
cp -f "$REPO_ROOT/scripts/installer/AutoUpdate-CourseForge.sh" "$STAGE_DIR/AutoUpdate-CourseForge.sh"
cp -f "$REPO_ROOT/scripts/installer/Install-CourseForge-macos.sh" "$STAGE_DIR/Install-CourseForge-macos.sh"
cp -f "$REPO_ROOT/scripts/installer/Uninstall-CourseForge-macos.sh" "$STAGE_DIR/Uninstall-CourseForge-macos.sh"
cp -f "$REPO_ROOT/package.json" "$STAGE_DIR/package-manifest.json"

chmod +x "$STAGE_DIR/Start-CourseForge-macos.sh" \
  "$STAGE_DIR/AutoUpdate-CourseForge.sh" \
  "$STAGE_DIR/Install-CourseForge-macos.sh" \
  "$STAGE_DIR/Uninstall-CourseForge-macos.sh"

rm -f "$ARTIFACT"
ditto -c -k --sequesterRsrc --keepParent "$STAGE_DIR" "$ARTIFACT"

echo "Created $ARTIFACT"

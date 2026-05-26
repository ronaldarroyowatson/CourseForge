#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.version);" "$REPO_ROOT/package.json")"
ARTIFACT="$REPO_ROOT/release/CourseForge-${VERSION}-macos-portable.zip"

if [[ ! -f "$ARTIFACT" ]]; then
  echo "Missing package artifact: $ARTIFACT" >&2
  exit 1
fi

LISTING="$(unzip -l "$ARTIFACT")"

for required in \
  "Start-CourseForge-macos.sh" \
  "AutoUpdate-CourseForge.sh" \
  "Install-CourseForge-macos.sh" \
  "Uninstall-CourseForge-macos.sh" \
  "courseforge-serve.js" \
  "package-manifest.json"; do
  if ! grep -q "$required" <<<"$LISTING"; then
    echo "Package missing required entry: $required" >&2
    exit 1
  fi
done

echo "Verified $ARTIFACT"

#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.version);" "$REPO_ROOT/package.json")"
ARTIFACT_PATH="$REPO_ROOT/release/CourseForge-${VERSION}-macos-portable.zip"
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$SKIP_BUILD" == "false" ]]; then
  echo "Building fresh macOS package artifact before smoke validation..."
  bash "$REPO_ROOT/scripts/create-macos-package.sh"
elif [[ ! -f "$ARTIFACT_PATH" ]]; then
  echo "macOS package artifact not found and --skip-build was requested." >&2
  exit 1
fi

bash "$REPO_ROOT/scripts/installer/run-macos-installer-smoke.sh" --artifact "$ARTIFACT_PATH"

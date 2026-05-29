#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "$SCRIPT_DIR/Install-CourseForge-macos.sh" --mode uninstall --package-root "$SCRIPT_DIR" "$@"

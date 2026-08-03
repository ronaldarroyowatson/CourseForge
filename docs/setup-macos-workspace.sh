#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash docs/setup-macos-workspace.sh
#
# This script clones the full Otto + CourseForge ecosystem side-by-side
# and installs dependencies so the workspace file opens cleanly on macOS.

WORK_ROOT="${WORK_ROOT:-$HOME/dev/otto-workspace}"
mkdir -p "$WORK_ROOT"
cd "$WORK_ROOT"

clone_or_update() {
  local url="$1"
  local dir="$2"
  if [ -d "$dir/.git" ]; then
    echo "Updating $dir"
    git -C "$dir" fetch origin
    git -C "$dir" checkout main
    git -C "$dir" pull --ff-only origin main
  else
    echo "Cloning $dir"
    git clone "$url" "$dir"
  fi
}

clone_or_update "https://github.com/ronaldarroyowatson/CourseForge.git" "CourseForge"
clone_or_update "https://github.com/ronaldarroyowatson/Maestro.git" "Maestro"
clone_or_update "https://github.com/otto-systems/otto-kernel.git" "otto-kernel"
clone_or_update "https://github.com/otto-systems/otto-command-service.git" "otto-command-service"
clone_or_update "https://github.com/otto-systems/otto-update.git" "otto-update"
clone_or_update "https://github.com/otto-systems/otto-extensions.git" "otto-extensions"
clone_or_update "https://github.com/otto-systems/otto-protocol.git" "otto-protocol"
clone_or_update "https://github.com/otto-systems/otto-ui.git" "otto-ui"
clone_or_update "https://github.com/otto-systems/otto-server.git" "otto-server"

# Install workspace dependencies.
for repo in CourseForge Maestro otto-kernel otto-command-service otto-update otto-extensions otto-protocol otto-ui otto-server; do
  echo "Installing dependencies in $repo"
  (cd "$repo" && npm install)
done

echo "Workspace ready."
echo "Open this in VS Code:"
echo "  $WORK_ROOT/CourseForge/OTTO-COURSEFORGE.code-workspace"

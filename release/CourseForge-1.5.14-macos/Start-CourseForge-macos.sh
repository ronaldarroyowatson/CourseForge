#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT=""
PORT="${COURSEFORGE_PORT:-3000}"
HOST="${COURSEFORGE_HOST:-localhost}"
DISABLE_BROWSER="${COURSEFORGE_DISABLE_AUTO_BROWSER:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_BUNDLE_PATH="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd || true)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-root)
      PACKAGE_ROOT="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --disable-browser)
      DISABLE_BROWSER="1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PACKAGE_ROOT" ]]; then
  if [[ -d "$SCRIPT_DIR/../Resources/CourseForge" ]]; then
    PACKAGE_ROOT="$(cd "$SCRIPT_DIR/../Resources/CourseForge" && pwd)"
  else
    PACKAGE_ROOT="$SCRIPT_DIR"
  fi
fi

LOG_DIR="$HOME/Library/Logs/CourseForge"
SUPPORT_DIR="$HOME/Library/Application Support/CourseForge"
mkdir -p "$LOG_DIR" "$SUPPORT_DIR"

LAUNCHER_LOG="$LOG_DIR/launcher.log"
PENDING_DIR="$PACKAGE_ROOT/_pending_update"
PENDING_MARKER="$PACKAGE_ROOT/pending-update.json"

write_log() {
  local message="$1"
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$message" >>"$LAUNCHER_LOG"
}

is_running_from_dmg() {
  case "$PACKAGE_ROOT" in
    /Volumes/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

is_installed_app_bundle() {
  case "$APP_BUNDLE_PATH" in
    /Applications/*.app|"$HOME"/Applications/*.app)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

prompt_move_to_applications() {
  if ! is_running_from_dmg; then
    return
  fi

  if is_installed_app_bundle; then
    return
  fi

  if ! command -v osascript >/dev/null 2>&1; then
    return
  fi

  local selection
  selection="$(osascript <<APPLESCRIPT
set resultButton to button returned of (display dialog "CourseForge is running from a downloaded disk image. Move it to Applications now for a smooth install experience?" buttons {"Continue", "Move to Applications"} default button "Move to Applications" with title "Install CourseForge")
return resultButton
APPLESCRIPT
)"

  if [[ "$selection" != "Move to Applications" ]]; then
    return
  fi

  local target_app="/Applications/CourseForge.app"
  local source_app="$APP_BUNDLE_PATH"

  if [[ "$source_app" != *.app ]]; then
    write_log "Move-to-Applications skipped: source app bundle path could not be resolved."
    return
  fi

  if [[ -e "$target_app" ]]; then
    local replace_choice
    replace_choice="$(osascript <<APPLESCRIPT
set resultButton to button returned of (display dialog "CourseForge already exists in Applications. Replace it with this version?" buttons {"Cancel", "Replace"} default button "Replace" with title "Install CourseForge")
return resultButton
APPLESCRIPT
)"
    if [[ "$replace_choice" != "Replace" ]]; then
      return
    fi
    rm -rf "$target_app"
  fi

  if ! ditto "$source_app" "$target_app"; then
    write_log "Move-to-Applications failed while copying app bundle."
    osascript -e 'display dialog "Could not copy CourseForge to Applications. Please drag the app manually." buttons {"OK"} default button "OK" with title "Install CourseForge"' >/dev/null 2>&1 || true
    return
  fi

  write_log "CourseForge copied to Applications. Relaunching from installed location."
  open -a "$target_app" >/dev/null 2>&1 || true
  exit 0
}

apply_staged_update() {
  if [[ ! -f "$PENDING_MARKER" || ! -d "$PENDING_DIR" ]]; then
    return
  fi

  write_log "Applying staged update from ${PENDING_DIR}."
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$PENDING_DIR/" "$PACKAGE_ROOT/"
  else
    cp -R "$PENDING_DIR/." "$PACKAGE_ROOT/"
  fi

  rm -rf "$PENDING_DIR"
  rm -f "$PENDING_MARKER"
  write_log "Staged update applied."
}

resolve_node() {
  local bundled="$PACKAGE_ROOT/node-runtime/bin/node"
  if [[ -x "$bundled" ]]; then
    printf '%s' "$bundled"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  echo ""
}

spawn_background_update_check() {
  local updater="$PACKAGE_ROOT/AutoUpdate-CourseForge.sh"
  if [[ ! -x "$updater" ]]; then
    return
  fi

  "$updater" --package-root "$PACKAGE_ROOT" --check-only >/dev/null 2>&1 || true
}

apply_staged_update
prompt_move_to_applications
NODE_BIN="$(resolve_node)"
if [[ -z "$NODE_BIN" ]]; then
  write_log "Node runtime was not found."
  echo "CourseForge could not find a Node runtime."
  exit 1
fi

SERVER_SCRIPT="$PACKAGE_ROOT/courseforge-serve.cjs"
if [[ ! -f "$SERVER_SCRIPT" ]]; then
  SERVER_SCRIPT="$PACKAGE_ROOT/courseforge-serve.js"
fi

if [[ ! -f "$SERVER_SCRIPT" ]]; then
  write_log "Server script was not found in package root."
  echo "CourseForge could not find its local server script."
  exit 1
fi

write_log "Starting server on ${HOST}:${PORT}."
spawn_background_update_check &
"$NODE_BIN" "$SERVER_SCRIPT" "$PACKAGE_ROOT/webapp" "$PORT" "$HOST" &
SERVER_PID=$!

if [[ "$DISABLE_BROWSER" != "1" ]]; then
  open "http://${HOST}:${PORT}" >/dev/null 2>&1 || true
fi

wait "$SERVER_PID"

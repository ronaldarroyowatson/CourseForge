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
UPDATER_STATUS_PATH="$PACKAGE_ROOT/updater-status.json"

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

  clear_quarantine "$target_app"

  write_log "CourseForge copied to Applications. Relaunching from installed location."
  open -a "$target_app" >/dev/null 2>&1 || true
  exit 0
}

apply_staged_update() {
  if [[ ! -f "$PENDING_MARKER" || ! -d "$PENDING_DIR" ]]; then
    return
  fi

  local staged_source="$PENDING_DIR"
  local top_entries=("$PENDING_DIR"/*)
  if [[ ${#top_entries[@]} -eq 1 && -d "${top_entries[0]}" ]]; then
    local candidate="${top_entries[0]}"
    if [[ -f "$candidate/package-manifest.json" || -d "$candidate/webapp" || -f "$candidate/Start-CourseForge-macos.sh" ]]; then
      staged_source="$candidate"
    fi
  fi

  local missing=0
  for required in \
    "package-manifest.json" \
    "webapp/index.html" \
    "courseforge-serve.js" \
    "courseforge-serve.cjs" \
    "AutoUpdate-CourseForge.sh" \
    "Start-CourseForge-macos.sh"; do
    if [[ ! -e "$staged_source/$required" ]]; then
      write_log "Staged update validation failed: missing ${required}. Keeping staged payload for retry."
      missing=1
    fi
  done

  if [[ "$missing" -eq 1 ]]; then
    cat >"$UPDATER_STATUS_PATH" <<JSON
{
  "state": "failed",
  "mode": "macos-portable",
  "message": "Staged update payload is missing required files.",
  "lastError": "invalid-staged-payload",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
    return
  fi

  local apply_tmp_dir="$SUPPORT_DIR/_apply_update"
  rm -rf "$apply_tmp_dir"
  mkdir -p "$apply_tmp_dir"

  if command -v rsync >/dev/null 2>&1; then
    if ! rsync -a "$staged_source/" "$apply_tmp_dir/"; then
      write_log "Failed to copy staged update into temporary apply directory."
      cat >"$UPDATER_STATUS_PATH" <<JSON
{
  "state": "failed",
  "mode": "macos-portable",
  "message": "Failed to prepare staged update for apply.",
  "lastError": "staged-copy-failed",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
      rm -rf "$apply_tmp_dir"
      return
    fi
  else
    if ! cp -R "$staged_source/." "$apply_tmp_dir/"; then
      write_log "Failed to copy staged update into temporary apply directory."
      cat >"$UPDATER_STATUS_PATH" <<JSON
{
  "state": "failed",
  "mode": "macos-portable",
  "message": "Failed to prepare staged update for apply.",
  "lastError": "staged-copy-failed",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
      rm -rf "$apply_tmp_dir"
      return
    fi
  fi

  write_log "Applying staged update from ${staged_source}."
  if command -v rsync >/dev/null 2>&1; then
    if ! rsync -a --delete "$apply_tmp_dir/" "$PACKAGE_ROOT/"; then
      write_log "Failed to apply staged update to package root."
      cat >"$UPDATER_STATUS_PATH" <<JSON
{
  "state": "failed",
  "mode": "macos-portable",
  "message": "Failed to apply staged update.",
  "lastError": "apply-rsync-failed",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
      rm -rf "$apply_tmp_dir"
      return
    fi
  else
    if ! cp -R "$apply_tmp_dir/." "$PACKAGE_ROOT/"; then
      write_log "Failed to apply staged update to package root."
      cat >"$UPDATER_STATUS_PATH" <<JSON
{
  "state": "failed",
  "mode": "macos-portable",
  "message": "Failed to apply staged update.",
  "lastError": "apply-copy-failed",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
      rm -rf "$apply_tmp_dir"
      return
    fi
  fi

  rm -rf "$apply_tmp_dir"

  rm -rf "$PENDING_DIR"
  rm -f "$PENDING_MARKER"
  cat >"$UPDATER_STATUS_PATH" <<JSON
{
  "state": "updated",
  "mode": "macos-portable",
  "message": "Update applied on startup.",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
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

  # Dock launches often have a minimal PATH, so probe common absolute locations.
  for candidate in \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/usr/bin/node"; do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done

  # Fallback for nvm-managed Node installations when PATH is not initialized.
  local nvm_node=""
  nvm_node="$(ls -1dt "$HOME/.nvm/versions/node"/v*/bin/node 2>/dev/null | head -n 1 || true)"
  if [[ -n "$nvm_node" && -x "$nvm_node" ]]; then
    printf '%s' "$nvm_node"
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

server_is_reachable() {
  curl -fsS --max-time 2 "http://${HOST}:${PORT}/api/updater-diagnostics" >/dev/null 2>&1
}

open_app_url() {
  if [[ "$DISABLE_BROWSER" != "1" ]]; then
    open "http://${HOST}:${PORT}" >/dev/null 2>&1 || true
  fi
}

clear_quarantine() {
  local target_path="$1"

  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$target_path" >/dev/null 2>&1 || true
  fi
}

ensure_bundle_icon_metadata() {
  local plist_path="$SCRIPT_DIR/../Info.plist"
  local icon_path="$SCRIPT_DIR/../Resources/CourseForge.icns"

  if [[ ! -f "$plist_path" || ! -f "$icon_path" ]]; then
    return
  fi

  if ! command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
    return
  fi

  if ! /usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "$plist_path" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string CourseForge.icns" "$plist_path" >/dev/null 2>&1 || true
  fi

  if ! /usr/libexec/PlistBuddy -c "Print :CFBundleIconName" "$plist_path" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Add :CFBundleIconName string CourseForge" "$plist_path" >/dev/null 2>&1 || true
  fi
}

apply_staged_update
ensure_bundle_icon_metadata
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
if server_is_reachable; then
  write_log "Detected existing server on ${HOST}:${PORT}; opening app URL."
  open_app_url
  exit 0
fi

nohup "$NODE_BIN" "$SERVER_SCRIPT" "$PACKAGE_ROOT/webapp" "$PORT" "$HOST" >>"$LOG_DIR/server.log" 2>&1 &

for _ in {1..20}; do
  if server_is_reachable; then
    break
  fi
  sleep 0.2
done

open_app_url
exit 0

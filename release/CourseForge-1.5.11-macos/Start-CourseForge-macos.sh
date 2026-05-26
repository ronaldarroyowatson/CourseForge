#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT=""
PORT="${COURSEFORGE_PORT:-3000}"
HOST="${COURSEFORGE_HOST:-localhost}"
DISABLE_BROWSER="${COURSEFORGE_DISABLE_AUTO_BROWSER:-0}"

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
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
NODE_BIN="$(resolve_node)"
if [[ -z "$NODE_BIN" ]]; then
  write_log "Node runtime was not found."
  echo "CourseForge could not find a Node runtime."
  exit 1
fi

write_log "Starting server on ${HOST}:${PORT}."
spawn_background_update_check &
"$NODE_BIN" "$PACKAGE_ROOT/courseforge-serve.js" "$PACKAGE_ROOT/webapp" "$PORT" "$HOST" &
SERVER_PID=$!

if [[ "$DISABLE_BROWSER" != "1" ]]; then
  open "http://${HOST}:${PORT}" >/dev/null 2>&1 || true
fi

wait "$SERVER_PID"

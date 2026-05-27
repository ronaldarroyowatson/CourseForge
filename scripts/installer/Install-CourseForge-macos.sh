#!/usr/bin/env bash
set -euo pipefail

MODE="detect"
PACKAGE_ROOT=""
INSTALL_ROOT="${HOME}/Applications/CourseForge.app"
REMOVE_USER_DATA="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --package-root)
      PACKAGE_ROOT="$2"
      shift 2
      ;;
    --install-root)
      INSTALL_ROOT="$2"
      shift 2
      ;;
    --remove-user-data)
      REMOVE_USER_DATA="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PACKAGE_ROOT" ]]; then
  PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

SUPPORT_ROOT="$HOME/Library/Application Support/CourseForge"
LOG_DIR="$HOME/Library/Logs/CourseForge"
mkdir -p "$SUPPORT_ROOT" "$LOG_DIR"
INSTALL_LOG="$LOG_DIR/installer.log"
METADATA_PATH="$SUPPORT_ROOT/installer-metadata.json"

write_log() {
  local message="$1"
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$message" >>"$INSTALL_LOG"
}

copy_tree() {
  local source_dir="$1"
  local target_dir="$2"

  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  cp -R -X "$source_dir/." "$target_dir/"
}

copy_file() {
  local source_path="$1"
  local target_path="$2"
  local executable="${3:-false}"

  mkdir -p "$(dirname "$target_path")"
  rm -f "$target_path"
  cat "$source_path" >"$target_path"
  if [[ "$executable" == "true" ]]; then
    chmod +x "$target_path"
  fi
}

clear_quarantine() {
  local target_path="$1"

  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$target_path" >/dev/null 2>&1 || true
  fi
}

copy_package_payload() {
  local resources_root="$INSTALL_ROOT/Contents/Resources/CourseForge"
  local macos_root="$INSTALL_ROOT/Contents/MacOS"

  mkdir -p "$resources_root" "$macos_root"

  copy_file "$PACKAGE_ROOT/Start-CourseForge-macos.sh" "$macos_root/Start-CourseForge" true

  copy_file "$PACKAGE_ROOT/AutoUpdate-CourseForge.sh" "$resources_root/AutoUpdate-CourseForge.sh" true

  copy_file "$PACKAGE_ROOT/courseforge-serve.js" "$resources_root/courseforge-serve.js"
  [[ -f "$PACKAGE_ROOT/courseforge-serve.cjs" ]] && copy_file "$PACKAGE_ROOT/courseforge-serve.cjs" "$resources_root/courseforge-serve.cjs"
  [[ -f "$PACKAGE_ROOT/package-manifest.json" ]] && copy_file "$PACKAGE_ROOT/package-manifest.json" "$resources_root/package-manifest.json"

  if [[ -d "$PACKAGE_ROOT/webapp" ]]; then
    copy_tree "$PACKAGE_ROOT/webapp" "$resources_root/webapp"
  fi

  if [[ -d "$PACKAGE_ROOT/extension" ]]; then
    copy_tree "$PACKAGE_ROOT/extension" "$resources_root/extension"
  fi

  if [[ -d "$PACKAGE_ROOT/node-runtime" ]]; then
    copy_tree "$PACKAGE_ROOT/node-runtime" "$resources_root/node-runtime"
    [[ -f "$resources_root/node-runtime/bin/node" ]] && chmod +x "$resources_root/node-runtime/bin/node"
  fi

  cat >"$INSTALL_ROOT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>CourseForge</string>
  <key>CFBundleIdentifier</key>
  <string>com.ronaldarroyowatson.CourseForge</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleExecutable</key>
  <string>Start-CourseForge</string>
</dict>
</plist>
PLIST
}

write_metadata() {
  cat >"$METADATA_PATH" <<JSON
{
  "productName": "CourseForge",
  "platform": "macos",
  "installPath": "${INSTALL_ROOT}",
  "installedAtUtc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "updatedAtUtc": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "components": {
    "webapp": true,
    "extension": true
  },
  "icons": {
    "desktop": false,
    "startMenu": false
  },
  "localDataPath": "${SUPPORT_ROOT}/data",
  "preferencesPath": "${HOME}/Library/Preferences/com.ronaldarroyowatson.CourseForge.json",
  "updaterStatePath": "${SUPPORT_ROOT}/updater/updater-status.json"
}
JSON
}

restore_critical_file() {
  local source_path="$1"
  local target_path="$2"

  if [[ ! -f "$source_path" ]]; then
    return
  fi

  if [[ ! -f "$target_path" || ! -s "$target_path" ]]; then
    copy_file "$source_path" "$target_path"
    return
  fi

  if ! cmp -s "$source_path" "$target_path"; then
    copy_file "$source_path" "$target_path"
  fi
}

is_install_healthy() {
  local resources_root="$INSTALL_ROOT/Contents/Resources/CourseForge"
  [[ -x "$INSTALL_ROOT/Contents/MacOS/Start-CourseForge" ]] || return 1
  [[ -s "$resources_root/courseforge-serve.js" ]] || return 1
  [[ -s "$resources_root/AutoUpdate-CourseForge.sh" ]] || return 1
  [[ -s "$resources_root/webapp/index.html" ]] || return 1
  return 0
}

detect_mode() {
  if [[ -d "$INSTALL_ROOT" ]]; then
    echo "detect:installed"
  else
    echo "detect:fresh"
  fi
}

install_mode() {
  write_log "Installing CourseForge to ${INSTALL_ROOT}."
  rm -rf "$INSTALL_ROOT"
  copy_package_payload
  clear_quarantine "$INSTALL_ROOT"
  mkdir -p "$SUPPORT_ROOT/data" "$SUPPORT_ROOT/updater"
  write_metadata
  write_log "Install completed."
}

repair_mode() {
  write_log "Repair started."
  local resources_root="$INSTALL_ROOT/Contents/Resources/CourseForge"

  if [[ ! -f "$INSTALL_ROOT/Contents/MacOS/Start-CourseForge" || ! -f "$resources_root/courseforge-serve.js" ]]; then
    write_log "Repair detected missing critical files, reinstalling payload."
    install_mode
    return
  fi

  restore_critical_file "$PACKAGE_ROOT/Start-CourseForge-macos.sh" "$INSTALL_ROOT/Contents/MacOS/Start-CourseForge"
  chmod +x "$INSTALL_ROOT/Contents/MacOS/Start-CourseForge" || true
  restore_critical_file "$PACKAGE_ROOT/AutoUpdate-CourseForge.sh" "$resources_root/AutoUpdate-CourseForge.sh"
  chmod +x "$resources_root/AutoUpdate-CourseForge.sh" || true
  restore_critical_file "$PACKAGE_ROOT/courseforge-serve.js" "$resources_root/courseforge-serve.js"
  clear_quarantine "$INSTALL_ROOT"

  if [[ -d "$PACKAGE_ROOT/webapp" && ! -d "$resources_root/webapp" ]]; then
    write_log "Repair restoring webapp payload."
    copy_tree "$PACKAGE_ROOT/webapp" "$resources_root/webapp"
  fi

  if [[ -d "$PACKAGE_ROOT/webapp" && -d "$resources_root/webapp" && ! -s "$resources_root/webapp/index.html" ]]; then
    write_log "Repair detected corrupted webapp index, restoring payload."
    copy_tree "$PACKAGE_ROOT/webapp" "$resources_root/webapp"
  fi

  if ! is_install_healthy; then
    write_log "Repair validation failed; running reinstall fallback."
    rm -rf "$INSTALL_ROOT"
    install_mode
    return
  fi

  write_metadata
  write_log "Repair completed."
}

uninstall_mode() {
  write_log "Uninstall started."
  rm -rf "$INSTALL_ROOT"
  if [[ "$REMOVE_USER_DATA" == "true" ]]; then
    rm -rf "$SUPPORT_ROOT"
    write_log "User data removed."
  else
    write_log "User data preserved at ${SUPPORT_ROOT}."
  fi
  rm -f "$METADATA_PATH"
  write_log "Uninstall completed."
}

case "$MODE" in
  detect)
    detect_mode
    ;;
  install)
    install_mode
    ;;
  repair)
    repair_mode
    ;;
  uninstall)
    uninstall_mode
    ;;
  reinstall)
    uninstall_mode
    install_mode
    ;;
  *)
    echo "Unsupported mode: ${MODE}" >&2
    exit 1
    ;;
esac

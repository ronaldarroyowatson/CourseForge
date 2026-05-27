#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT=""
CURRENT_VERSION=""
OWNER="ronaldarroyowatson"
REPO="CourseForge"
ASSET_NAME_TEMPLATE="CourseForge-{version}-portable.zip"
STAGE_ONLY=false
CHECK_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-root)
      PACKAGE_ROOT="$2"
      shift 2
      ;;
    --current-version)
      CURRENT_VERSION="$2"
      shift 2
      ;;
    --owner)
      OWNER="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    --asset-name-template)
      ASSET_NAME_TEMPLATE="$2"
      shift 2
      ;;
    --stage-only)
      STAGE_ONLY=true
      shift
      ;;
    --check-only)
      CHECK_ONLY=true
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

mkdir -p "$PACKAGE_ROOT"
UPDATER_LOG_PATH="$PACKAGE_ROOT/updater.log"
UPDATER_STATUS_PATH="$PACKAGE_ROOT/updater-status.json"
PENDING_UPDATE_PATH="$PACKAGE_ROOT/pending-update.json"
PENDING_DIR="$PACKAGE_ROOT/_pending_update"

write_log() {
  local message="$1"
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$message" >>"$UPDATER_LOG_PATH"
}

write_status() {
  local state="$1"
  local message="$2"
  local latest_version="${3:-}"
  cat >"$UPDATER_STATUS_PATH" <<JSON
{
  "state": "$state",
  "mode": "macos-portable",
  "currentVersion": "${CURRENT_VERSION}",
  "latestVersion": "${latest_version}",
  "message": "$message",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
}

if [[ -z "$CURRENT_VERSION" && -f "$PACKAGE_ROOT/package-manifest.json" ]]; then
  CURRENT_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p.version||''));" "$PACKAGE_ROOT/package-manifest.json")"
fi

if [[ -z "$CURRENT_VERSION" ]]; then
  CURRENT_VERSION="0.0.0"
fi

LATEST_ENDPOINT="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"
write_status "checking" "Checking for updates..."
write_log "Checking latest release from ${LATEST_ENDPOINT}."

LATEST_JSON="$(curl -fsSL "$LATEST_ENDPOINT")" || {
  write_status "failed" "Failed to fetch latest release metadata."
  write_log "Failed to fetch latest release metadata."
  exit 1
}

LATEST_VERSION="$(node -e "const data=JSON.parse(process.argv[1]);const tag=String(data.tag_name||'');process.stdout.write(tag.replace(/^v/,''));" "$LATEST_JSON")"

IS_NEWER="$(node -e "const a=process.argv[1].split('.').map(Number);const b=process.argv[2].split('.').map(Number);let newer=false;for(let i=0;i<3;i+=1){const av=Number.isFinite(a[i])?a[i]:0;const bv=Number.isFinite(b[i])?b[i]:0;if(av>bv){newer=true;break;}if(av<bv){break;}}process.stdout.write(newer?'1':'0');" "$LATEST_VERSION" "$CURRENT_VERSION")"

if [[ "$IS_NEWER" != "1" ]]; then
  write_status "idle" "No update available." "$LATEST_VERSION"
  write_log "No update available. current=${CURRENT_VERSION} latest=${LATEST_VERSION}."
  exit 0
fi

if [[ "$CHECK_ONLY" == "true" && "$STAGE_ONLY" != "true" ]]; then
  write_status "update-available" "Update available." "$LATEST_VERSION"
  write_log "Update available in check-only mode."
  exit 2
fi

ASSET_NAME="${ASSET_NAME_TEMPLATE//\{version\}/$LATEST_VERSION}"
ASSET_URL="$(node -e "const data=JSON.parse(process.argv[1]);const name=process.argv[2];const asset=(Array.isArray(data.assets)?data.assets:[]).find((item)=>String(item.name||'')===name);process.stdout.write(asset?String(asset.browser_download_url||''):'');" "$LATEST_JSON" "$ASSET_NAME")"

if [[ -z "$ASSET_URL" ]]; then
  write_status "failed" "Update asset not found in latest release." "$LATEST_VERSION"
  write_log "Asset not found: ${ASSET_NAME}."
  exit 1
fi

TMP_ZIP="$PACKAGE_ROOT/_pending_update.zip"
rm -f "$TMP_ZIP"
rm -rf "$PENDING_DIR"
mkdir -p "$PENDING_DIR"

write_status "downloading" "Downloading update..." "$LATEST_VERSION"
write_log "Downloading asset ${ASSET_NAME} from ${ASSET_URL}."

curl -fL "$ASSET_URL" -o "$TMP_ZIP" || {
  write_status "failed" "Failed to download update asset." "$LATEST_VERSION"
  write_log "Failed to download update asset."
  exit 1
}

write_status "extracting" "Extracting update payload..." "$LATEST_VERSION"
if ! ditto -x -k "$TMP_ZIP" "$PENDING_DIR"; then
  write_status "failed" "Failed to extract update payload." "$LATEST_VERSION"
  write_log "Extraction failed for ${TMP_ZIP}."
  exit 1
fi

cat >"$PENDING_UPDATE_PATH" <<JSON
{
  "version": "$LATEST_VERSION",
  "assetName": "$ASSET_NAME",
  "stagedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON

write_status "staging" "Update staged for next launch." "$LATEST_VERSION"
write_log "Update staged successfully for next launch."
exit 0

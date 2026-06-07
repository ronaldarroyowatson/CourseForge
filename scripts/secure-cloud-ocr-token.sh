#!/usr/bin/env bash
set -euo pipefail

OPENAI_SERVICE="courseforge.OPENAI_API_KEY"
GITHUB_SERVICE="courseforge.COURSEFORGE_GITHUB_TOKEN"

require_macos_security() {
  if [[ "${OSTYPE:-}" != darwin* ]]; then
    echo "This helper currently supports macOS Keychain only." >&2
    exit 1
  fi

  if ! command -v security >/dev/null 2>&1; then
    echo "macOS 'security' CLI is unavailable." >&2
    exit 1
  fi
}

read_keychain_secret() {
  local service="$1"
  security find-generic-password -a "$USER" -s "$service" -w 2>/dev/null || true
}

write_keychain_secret() {
  local service="$1"
  local label="$2"
  local token=""

  printf "Paste %s and press Enter: " "$label"
  stty -echo
  read -r token
  stty echo
  printf "\n"

  token="${token## }"
  token="${token%% }"

  if [[ -z "$token" ]]; then
    echo "No token entered; nothing saved." >&2
    exit 1
  fi

  security add-generic-password -a "$USER" -s "$service" -w "$token" -U >/dev/null
  unset token
  echo "Saved $label in macOS Keychain service '$service'."
}

run_cloud_smoke_gate() {
  local openai_token=""
  local github_token=""

  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    openai_token="$(read_keychain_secret "$OPENAI_SERVICE")"
    if [[ -n "$openai_token" ]]; then
      export OPENAI_API_KEY="$openai_token"
      echo "Loaded OPENAI_API_KEY from Keychain."
    fi
  fi

  if [[ -z "${COURSEFORGE_GITHUB_TOKEN:-}" && -z "${GITHUB_TOKEN:-}" ]]; then
    github_token="$(read_keychain_secret "$GITHUB_SERVICE")"
    if [[ -n "$github_token" ]]; then
      export COURSEFORGE_GITHUB_TOKEN="$github_token"
      echo "Loaded COURSEFORGE_GITHUB_TOKEN from Keychain."
    fi
  fi

  npm run test:smoke:ocr:cloud:gate:optin
}

print_usage() {
  cat <<'USAGE'
Usage:
  bash scripts/secure-cloud-ocr-token.sh set openai
  bash scripts/secure-cloud-ocr-token.sh set github
  bash scripts/secure-cloud-ocr-token.sh run

Commands:
  set openai   Save OPENAI_API_KEY in macOS Keychain
  set github   Save COURSEFORGE_GITHUB_TOKEN in macOS Keychain
  run          Load secure tokens (if present) and run cloud OCR smoke gate
USAGE
}

main() {
  require_macos_security

  local command="${1:-help}"
  case "$command" in
    set)
      local provider="${2:-}"
      case "$provider" in
        openai)
          write_keychain_secret "$OPENAI_SERVICE" "OPENAI_API_KEY"
          ;;
        github)
          write_keychain_secret "$GITHUB_SERVICE" "COURSEFORGE_GITHUB_TOKEN"
          ;;
        *)
          print_usage
          exit 1
          ;;
      esac
      ;;
    run)
      run_cloud_smoke_gate
      ;;
    *)
      print_usage
      ;;
  esac
}

main "$@"

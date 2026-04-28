#!/usr/bin/env bash
set -uo pipefail

VERIFY_ONLY=false
if [[ "${1:-}" == "--verify-only" ]]; then
  VERIFY_ONLY=true
fi

FAILURES=()

log_header() {
  echo
  echo "== $1 =="
}

log_step() {
  echo "[STEP] $1"
}

log_ok() {
  echo "[OK]   $1"
}

log_fail() {
  echo "[FAIL] $1"
  FAILURES+=("$1")
}

run_step() {
  local name="$1"
  shift
  log_step "$name"
  if "$@"; then
    log_ok "$name"
  else
    log_fail "$name"
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_brew() {
  if ! command_exists brew; then
    echo "Homebrew is required for automated installs on macOS. Install from https://brew.sh and re-run."
    return 1
  fi
  return 0
}

ensure_brew_formula() {
  local display="$1"
  local cmd_name="$2"
  local formula="$3"
  local version_cmd="$4"

  run_step "Verify ${display}" bash -c "
    if command -v ${cmd_name} >/dev/null 2>&1; then
      ${version_cmd}
      exit 0
    fi

    if [[ '${VERIFY_ONLY}' == 'true' ]]; then
      echo '${display} missing (verify-only mode).'
      exit 1
    fi

    command -v brew >/dev/null 2>&1 || { echo 'Homebrew is required.'; exit 1; }
    brew install ${formula} || exit 1
    command -v ${cmd_name} >/dev/null 2>&1 || { echo '${display} still unavailable after install.'; exit 1; }
    ${version_cmd}
  "
}

ensure_brew_cask() {
  local display="$1"
  local cmd_name="$2"
  local cask="$3"
  local version_cmd="$4"

  run_step "Verify ${display}" bash -c "
    if command -v ${cmd_name} >/dev/null 2>&1; then
      ${version_cmd}
      exit 0
    fi

    if [[ '${VERIFY_ONLY}' == 'true' ]]; then
      echo '${display} missing (verify-only mode).'
      exit 1
    fi

    command -v brew >/dev/null 2>&1 || { echo 'Homebrew is required.'; exit 1; }
    brew install --cask ${cask} || exit 1
    command -v ${cmd_name} >/dev/null 2>&1 || { echo '${display} still unavailable after install.'; exit 1; }
    ${version_cmd}
  "
}

ensure_browser() {
  run_step "Verify Browser (Chrome/Chromium)" bash -c "
    if command -v google-chrome >/dev/null 2>&1; then
      google-chrome --version
      exit 0
    fi
    if command -v chromium >/dev/null 2>&1; then
      chromium --version
      exit 0
    fi

    if [[ '${VERIFY_ONLY}' == 'true' ]]; then
      echo 'Browser missing (verify-only mode).'
      exit 1
    fi

    command -v brew >/dev/null 2>&1 || { echo 'Homebrew is required.'; exit 1; }
    brew install --cask google-chrome || exit 1

    if command -v google-chrome >/dev/null 2>&1; then
      google-chrome --version
      exit 0
    fi

    echo 'Browser still unavailable after install.'
    exit 1
  "
}

ensure_firebase_cli() {
  run_step "Verify firebase-tools CLI" bash -c "
    if command -v firebase >/dev/null 2>&1; then
      firebase --version
      exit 0
    fi

    if [[ '${VERIFY_ONLY}' == 'true' ]]; then
      echo 'firebase-tools missing (verify-only mode).'
      exit 1
    fi

    npm install -g firebase-tools || exit 1
    command -v firebase >/dev/null 2>&1 || { echo 'firebase still unavailable after install.'; exit 1; }
    firebase --version
  "
}

run_npm_script() {
  local script_name="$1"
  run_step "Run npm script: ${script_name}" bash -c "npm run ${script_name}"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

log_header "CourseForge Setup (macOS)"
echo "Repository root: $REPO_ROOT"
echo "Mode: $( [[ "$VERIFY_ONLY" == "true" ]] && echo VerifyOnly || echo InstallOrVerify )"

if [[ "$VERIFY_ONLY" != "true" ]]; then
  require_brew || FAILURES+=("Homebrew missing")
fi

log_header "Phase 1 - Core OS Toolchain"
ensure_brew_formula "Node.js" "node" "node@20" "node --version"
ensure_brew_formula "Git" "git" "git" "git --version"
ensure_brew_formula "GitHub CLI" "gh" "gh" "gh --version"
ensure_brew_formula "jq" "jq" "jq" "jq --version"
ensure_brew_formula "Java Runtime" "java" "temurin@17" "java -version"
ensure_brew_cask "PowerShell 7" "pwsh" "powershell" "pwsh --version"
ensure_browser

log_header "Phase 2 - Global CLIs"
ensure_firebase_cli

log_header "Phase 3 - Repo Bootstrap"
if [[ "$VERIFY_ONLY" == "true" ]]; then
  echo "Skipping npm install steps in verify-only mode."
else
  run_step "npm install (root)" npm install
  run_step "npm install (functions)" bash -c "cd functions && npm install"
fi

log_header "Phase 4 - Verification Commands"
run_npm_script "check:node"
run_npm_script "check:node:functions"
run_npm_script "typecheck:all"
run_npm_script "test:index"
run_npm_script "test:samples:validate"
run_npm_script "bugfix:test"

log_header "Setup Summary"
if [[ ${#FAILURES[@]} -eq 0 ]]; then
  echo "CourseForge setup completed successfully."
  exit 0
fi

echo "CourseForge setup completed with failures:"
for failure in "${FAILURES[@]}"; do
  echo " - ${failure}"
done
exit 1

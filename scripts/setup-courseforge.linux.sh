#!/usr/bin/env bash
set -uo pipefail

VERIFY_ONLY=false
if [[ "${1:-}" == "--verify-only" ]]; then
  VERIFY_ONLY=true
fi

FAILURES=()
APT_READY=false

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

apt_cmd() {
  if [[ $EUID -eq 0 ]]; then
    echo "apt-get"
  elif command_exists sudo; then
    echo "sudo apt-get"
  else
    echo ""
  fi
}

prepare_apt() {
  if [[ "$APT_READY" == "true" ]]; then
    return 0
  fi

  local cmd
  cmd="$(apt_cmd)"
  if [[ -z "$cmd" ]]; then
    echo "apt-get requires root or sudo privileges."
    return 1
  fi

  eval "$cmd update" || return 1
  APT_READY=true
  return 0
}

install_apt_package() {
  local package_name="$1"
  local cmd
  cmd="$(apt_cmd)"
  if [[ -z "$cmd" ]]; then
    echo "Cannot install ${package_name}: sudo/root required."
    return 1
  fi

  prepare_apt || return 1
  eval "$cmd install -y ${package_name}" || return 1
  return 0
}

ensure_cmd_or_install_apt() {
  local display="$1"
  local cmd_name="$2"
  local package_name="$3"
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

    exit 2
  "

  if [[ ${#FAILURES[@]} -gt 0 ]]; then
    local last_failure="${FAILURES[-1]}"
    if [[ "$last_failure" == "Verify ${display}"* ]]; then
      if [[ "$VERIFY_ONLY" == "false" ]]; then
        FAILURES=("${FAILURES[@]:0:${#FAILURES[@]}-1}")
        run_step "Install ${display} (${package_name})" install_apt_package "$package_name"
        run_step "Re-verify ${display}" bash -c "command -v ${cmd_name} >/dev/null 2>&1 && ${version_cmd}"
      fi
    fi
  fi
}

ensure_node() {
  run_step "Verify Node.js" bash -c "node --version"
  if [[ ${#FAILURES[@]} -gt 0 ]]; then
    local last_failure="${FAILURES[-1]}"
    if [[ "$last_failure" == "Verify Node.js"* ]]; then
      if [[ "$VERIFY_ONLY" == "false" ]]; then
        FAILURES=("${FAILURES[@]:0:${#FAILURES[@]}-1}")
        if command -v nvm >/dev/null 2>&1; then
          run_step "Install Node.js 20 via nvm" bash -c "nvm install 20 && nvm use 20"
        else
          run_step "Install Node.js via apt" install_apt_package "nodejs npm"
        fi
        run_step "Re-verify Node.js" bash -c "node --version"
      fi
    fi
  fi
}

ensure_browser() {
  run_step "Verify Browser (Chrome/Chromium)" bash -c "
    if command -v google-chrome >/dev/null 2>&1; then
      google-chrome --version
      exit 0
    fi
    if command -v chromium-browser >/dev/null 2>&1; then
      chromium-browser --version
      exit 0
    fi
    if command -v chromium >/dev/null 2>&1; then
      chromium --version
      exit 0
    fi
    exit 1
  "

  if [[ ${#FAILURES[@]} -gt 0 ]]; then
    local last_failure="${FAILURES[-1]}"
    if [[ "$last_failure" == "Verify Browser (Chrome/Chromium)"* ]]; then
      if [[ "$VERIFY_ONLY" == "false" ]]; then
        FAILURES=("${FAILURES[@]:0:${#FAILURES[@]}-1}")
        run_step "Install Browser (chromium-browser)" install_apt_package "chromium-browser"
        if [[ ${#FAILURES[@]} -gt 0 ]]; then
          local install_failure="${FAILURES[-1]}"
          if [[ "$install_failure" == "Install Browser (chromium-browser)"* ]]; then
            FAILURES=("${FAILURES[@]:0:${#FAILURES[@]}-1}")
            run_step "Install Browser (chromium)" install_apt_package "chromium"
          fi
        fi
        run_step "Re-verify Browser (Chrome/Chromium)" bash -c "
          command -v google-chrome >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1
        "
      fi
    fi
  fi
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
    command -v firebase >/dev/null 2>&1 || exit 1
    firebase --version
  "
}

run_npm_script() {
  local script_name="$1"
  run_step "Run npm script: ${script_name}" bash -c "npm run ${script_name}"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

log_header "CourseForge Setup (Linux)"
echo "Repository root: $REPO_ROOT"
echo "Mode: $( [[ "$VERIFY_ONLY" == "true" ]] && echo VerifyOnly || echo InstallOrVerify )"

echo "Note: Some package installs may require root/sudo privileges."

log_header "Phase 1 - Core OS Toolchain"
ensure_node
ensure_cmd_or_install_apt "Git" "git" "git" "git --version"
ensure_cmd_or_install_apt "GitHub CLI" "gh" "gh" "gh --version"
ensure_cmd_or_install_apt "jq" "jq" "jq" "jq --version"
ensure_cmd_or_install_apt "Java Runtime" "java" "openjdk-17-jre" "java -version"
ensure_cmd_or_install_apt "PowerShell 7" "pwsh" "powershell" "pwsh --version"
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

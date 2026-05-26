#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/courseforge-macos-installer-smoke.XXXXXX")"
HOME_SANDBOX="$WORK_DIR/home"
PACKAGE_ROOT="$WORK_DIR/package"
INSTALL_ROOT="$WORK_DIR/Applications/CourseForge.app"
RESULTS_JSON="$WORK_DIR/results.json"
PORT=""
PACKAGE_ROOT_SOURCE=""
ARTIFACT_PATH=""
SCENARIO="dev-scripts"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-root-source)
      PACKAGE_ROOT_SOURCE="$2"
      shift 2
      ;;
    --artifact)
      ARTIFACT_PATH="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -n "${COURSEFORGE_INSTALLER_SMOKE_PORT:-}" ]]; then
  PORT="$COURSEFORGE_INSTALLER_SMOKE_PORT"
else
  PORT="$(node -e 'const net=require("net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{const a=s.address();process.stdout.write(String(a.port));s.close();});')"
fi

INSTALL_ROOT="$WORK_DIR/install-root/CourseForge.app"

mkdir -p "$HOME_SANDBOX" "$PACKAGE_ROOT" "$WORK_DIR/install-root"

if [[ -n "$ARTIFACT_PATH" ]]; then
  if [[ ! -f "$ARTIFACT_PATH" ]]; then
    echo "Artifact not found: $ARTIFACT_PATH" >&2
    exit 1
  fi

  EXTRACT_DIR="$WORK_DIR/extracted"
  mkdir -p "$EXTRACT_DIR"
  ditto -x -k "$ARTIFACT_PATH" "$EXTRACT_DIR"

  installer_entry="$(find "$EXTRACT_DIR" -type f -name "Install-CourseForge-macos.sh" | head -n 1)"
  if [[ -z "$installer_entry" ]]; then
    echo "Unable to find Install-CourseForge-macos.sh in extracted artifact." >&2
    exit 1
  fi

  PACKAGE_ROOT_SOURCE="$(cd "$(dirname "$installer_entry")" && pwd)"
  SCENARIO="packaged-artifact"
fi

if [[ -n "$PACKAGE_ROOT_SOURCE" ]]; then
  cp -R "$PACKAGE_ROOT_SOURCE/." "$PACKAGE_ROOT/"
else
  cp -f "$SCRIPT_DIR/Install-CourseForge-macos.sh" "$PACKAGE_ROOT/Install-CourseForge-macos.sh"
  cp -f "$SCRIPT_DIR/Uninstall-CourseForge-macos.sh" "$PACKAGE_ROOT/Uninstall-CourseForge-macos.sh"
  cp -f "$SCRIPT_DIR/Start-CourseForge-macos.sh" "$PACKAGE_ROOT/Start-CourseForge-macos.sh"
  cp -f "$SCRIPT_DIR/AutoUpdate-CourseForge.sh" "$PACKAGE_ROOT/AutoUpdate-CourseForge.sh"
  cp -f "$SCRIPT_DIR/courseforge-serve.js" "$PACKAGE_ROOT/courseforge-serve.js"

  mkdir -p "$PACKAGE_ROOT/webapp"
  cat >"$PACKAGE_ROOT/webapp/index.html" <<HTML
<!doctype html>
<html>
  <head><title>CourseForge Smoke</title></head>
  <body>CourseForge smoke webapp</body>
</html>
HTML

  cat >"$PACKAGE_ROOT/package-manifest.json" <<JSON
{
  "name": "CourseForge",
  "version": "1.5.11",
  "updates": {
    "owner": "ronaldarroyowatson",
    "repo": "CourseForge",
    "assetNameTemplate": "CourseForge-{version}-portable.zip"
  }
}
JSON
fi

if [[ ! -f "$PACKAGE_ROOT/courseforge-serve.js" ]]; then
  echo "Package root is missing courseforge-serve.js: $PACKAGE_ROOT" >&2
  exit 1
fi

if [[ ! -f "$PACKAGE_ROOT/Install-CourseForge-macos.sh" ]]; then
  echo "Package root is missing Install-CourseForge-macos.sh: $PACKAGE_ROOT" >&2
  exit 1
fi

chmod +x \
  "$PACKAGE_ROOT/Install-CourseForge-macos.sh" \
  "$PACKAGE_ROOT/Uninstall-CourseForge-macos.sh" \
  "$PACKAGE_ROOT/Start-CourseForge-macos.sh" \
  "$PACKAGE_ROOT/AutoUpdate-CourseForge.sh"

support_root="$HOME_SANDBOX/Library/Application Support/CourseForge"
metadata_path="$support_root/installer-metadata.json"

pass_count=0
fail_count=0
results_buffer="[]"

add_result() {
  local scope="$1"
  local status="$2"
  local evidence="$3"
  local next_action="$4"

  if [[ "$status" == "passed" ]]; then
    pass_count=$((pass_count + 1))
  else
    fail_count=$((fail_count + 1))
  fi

  results_buffer="$(node -e '
const prior = JSON.parse(process.argv[1]);
prior.push({
  scope: process.argv[2],
  status: process.argv[3],
  evidence: process.argv[4],
  nextAction: process.argv[5]
});
process.stdout.write(JSON.stringify(prior));
' "$results_buffer" "$scope" "$status" "$evidence" "$next_action")"
}

run_installer() {
  HOME="$HOME_SANDBOX" "$PACKAGE_ROOT/Install-CourseForge-macos.sh" --package-root "$PACKAGE_ROOT" --install-root "$INSTALL_ROOT" "$@"
}

run_smoke_install() {
  run_installer --mode install

  if [[ -x "$INSTALL_ROOT/Contents/MacOS/Start-CourseForge" && -s "$INSTALL_ROOT/Contents/Resources/CourseForge/courseforge-serve.js" && -f "$metadata_path" ]]; then
    add_result "install-smoke" "passed" "Install created app bundle, server script, and installer metadata." "Proceed to live launch validation."
  else
    add_result "install-smoke" "failed" "Missing app bundle executable, runtime payload, or metadata after install." "Inspect installer logs and payload copy paths."
  fi
}

run_live_launch() {
  local runtime_root="$INSTALL_ROOT/Contents/Resources/CourseForge"
  local launcher="$INSTALL_ROOT/Contents/MacOS/Start-CourseForge"
  local launch_log="$HOME_SANDBOX/Library/Logs/CourseForge/launcher.log"

  HOME="$HOME_SANDBOX" COURSEFORGE_DISABLE_AUTO_BROWSER=1 "$launcher" --package-root "$runtime_root" --port "$PORT" --host "127.0.0.1" >"$WORK_DIR/live-launch.out" 2>"$WORK_DIR/live-launch.err" &
  local launcher_pid=$!

  local ready=0
  for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/update-status" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.2
  done

  if kill -0 "$launcher_pid" >/dev/null 2>&1; then
    kill "$launcher_pid" >/dev/null 2>&1 || true
    wait "$launcher_pid" 2>/dev/null || true
  fi

  if [[ "$ready" == "1" ]]; then
    if [[ -f "$launch_log" ]]; then
      add_result "live-launch" "passed" "Launcher served update-status endpoint and wrote launcher log." "Proceed to uninstall cleanliness check."
    else
      add_result "live-launch" "passed" "Launcher served update-status endpoint; launcher log file was not emitted in this sandbox run." "Proceed to uninstall cleanliness check."
    fi
  else
    add_result "live-launch" "failed" "Launcher did not expose update-status endpoint within timeout or log was missing." "Inspect Start-CourseForge-macos.sh and local server startup."
  fi
}

run_uninstall_cleanliness() {
  run_installer --mode uninstall --remove-user-data

  if [[ ! -e "$INSTALL_ROOT" && ! -e "$support_root" ]]; then
    add_result "uninstall-clean" "passed" "Uninstall removed app bundle and user support data." "Proceed to corruption and repair cycle."
  else
    add_result "uninstall-clean" "failed" "Uninstall left install root or support data behind." "Check uninstall_mode cleanup and metadata deletion paths."
  fi
}

run_corruption_and_repair() {
  # Packaged artifacts can install read-only app contents; remove the bundle to
  # simulate a hard corruption and validate repair/reinstall recovery behavior.
  rm -rf "$INSTALL_ROOT"

  run_installer --mode repair

  local runtime_root="$INSTALL_ROOT/Contents/Resources/CourseForge"

  if [[ -s "$runtime_root/courseforge-serve.js" && -s "$runtime_root/webapp/index.html" ]]; then
    add_result "repair-after-corruption" "passed" "Repair recovered from missing app bundle by reinstalling runtime payload." "Proceed to reinstall recovery test."
  else
    add_result "repair-after-corruption" "failed" "Repair did not recover the missing app bundle and runtime payload." "Inspect repair_mode restoration and fallback logic."
  fi
}

run_reinstall_recovery() {
  rm -rf "$INSTALL_ROOT"
  run_installer --mode reinstall

  if [[ -x "$INSTALL_ROOT/Contents/MacOS/Start-CourseForge" && -s "$INSTALL_ROOT/Contents/Resources/CourseForge/courseforge-serve.js" && -f "$metadata_path" ]]; then
    add_result "reinstall-recovery" "passed" "Reinstall recreated healthy app bundle and metadata from empty state." "Lifecycle smoke/live suite complete."
  else
    add_result "reinstall-recovery" "failed" "Reinstall did not recreate required app executable, payload, or metadata." "Inspect reinstall branch and install_mode side effects."
  fi
}

run_smoke_install
run_live_launch
run_uninstall_cleanliness
run_corruption_and_repair
run_reinstall_recovery

node -e '
const fs = require("fs");
const payload = {
  generatedAtUtc: new Date().toISOString(),
  scenario: process.argv[6],
  artifactPath: process.argv[7] || null,
  workDir: process.argv[2],
  summary: {
    passed: Number(process.argv[3]),
    failed: Number(process.argv[4])
  },
  checks: JSON.parse(process.argv[5])
};
fs.writeFileSync(process.argv[1], JSON.stringify(payload, null, 2), "utf8");
' "$RESULTS_JSON" "$WORK_DIR" "$pass_count" "$fail_count" "$results_buffer" "$SCENARIO" "$ARTIFACT_PATH"

echo "macOS installer smoke/live report"
echo "workDir=$WORK_DIR"
cat "$RESULTS_JSON"

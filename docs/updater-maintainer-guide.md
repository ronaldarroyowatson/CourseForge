# CourseForge Updater Maintainer Guide

This guide is the single handoff document for future updater work. It describes architecture, the execution pipeline, coding conventions, and safe extension points.

## 1. Scope

CourseForge has two updater surfaces:

1. Runtime staged updater for packaged installs (portable and Windows launcher payloads)
2. Local status API that powers the App Updates card and startup splash diagnostics

The updater design goal is fail-safe behavior: update failures must never block app startup and must never corrupt the current install.

## 2. Files and responsibilities

| File | Responsibility |
| --- | --- |
| `scripts/auto-update-portable.ps1` | Downloads, validates, stages, and applies release payloads |
| `scripts/installer/Test-CourseForge-Integrity.ps1` | Verifies package file contract against `manifest.json` |
| `scripts/installer/Start-CourseForge.ps1` | Launch orchestration, staged update apply, local server startup |
| `scripts/installer/courseforge-serve.cjs` | `/api/update-status`, `/api/check-for-updates`, `/api/updater-progress`, diagnostics |
| `src/webapp/components/settings/SettingsPage.tsx` | App Updates card UI and manual check UX |
| `tests/integration/auto-update-*.integration.test.ts` | End-to-end updater behavior tests |
| `tests/integration/settings.updater.integration.test.tsx` | UI-level updater communication tests |
| `tests/integration/package-integrity.integration.test.ts` | Integrity script contract tests |

## 3. Runtime update pipeline

1. Launcher starts and runs updater script.
2. Updater requests latest release metadata.
3. If no newer semantic version exists, updater exits cleanly.
4. If newer version exists, updater downloads `CourseForge-{version}-portable.zip`.
5. Updater extracts to temp staging directory.
6. Contract validation runs before staging:
   - `package-manifest.json` exists and version matches expected release
   - `manifest.json` exists and version matches expected release
   - `Test-CourseForge-Integrity.ps1` passes SHA-256 and size checks
7. Updater computes update plan and writes progress state.
8. Updater stages payload and writes `pending-update.json`.
9. On next launch, launcher applies staged update atomically and starts app.

## 4. State and diagnostics artifacts

| File | Purpose |
| --- | --- |
| `updater-status.json` | Current updater state, progress, and last error code |
| `pending-update.json` | Staged update metadata consumed on next launch |
| `updater-check.json` | Last manual check result and diagnostics summary |
| `integrity-status.json` | Latest package integrity report |
| `updater.log` | Human-readable execution log for support and debugging |

## 5. Coding conventions for updater work

1. Fail closed for package validation, fail open for app startup.
2. Use stable machine-readable error codes in `lastError`.
3. Keep status JSON backward-compatible when adding fields.
4. Write deterministic log lines for test assertions.
5. Prefer additive changes over schema-breaking changes.
6. Never stage/apply payloads before contract validation passes.
7. Preserve cache and runtime directories during integrity checks (`logs/`, `user-data/`, `ocr-cache/`, `_pending_update/`, `_rollback/`).
8. Manual check UX must reconcile with diagnostics: before showing fetch-failure messaging, resolve latest/current versions from `updater-status.json` and `updater-check.json` hints so already-current installs are reported as up to date.

## 6. Test matrix expectations

When changing updater behavior, run at minimum:

1. `npm run test:e2e:autoupdate`
2. `npm run test:e2e:packaged`
3. `npm run check:installer`

Critical scenarios to keep covered:

1. Up-to-date check path
2. Update available path
3. Missing manifest rejection
4. Package version mismatch rejection
5. Integrity hash mismatch rejection
6. Staged apply success path
7. Staged apply retry/failure diagnostics path
8. Status and diagnostics API contract
9. Preferred-port collision fallback path (`auto-update-launcher.integration.test.ts`) using a generous marker wait budget on slower Windows runners

## 7. Safe extension points

1. Add new validation rules inside `Test-ExtractedPackageContract` in `auto-update-portable.ps1`.
2. Add new diagnostics fields to API payloads without removing existing keys.
3. Add UI affordances in App Updates card only after corresponding integration tests are added.
4. Keep `courseforge-serve.js` and `courseforge-serve.cjs` behavior aligned if editing either runtime copy.

## 8. Future work backlog

1. Differential patch updater (block-level or file-level delta downloads)
2. Signed manifest verification (public key signature validation)
3. Roll-forward repair mode from diagnostics endpoint
4. Automatic stale-temp cleanup with retention policy
5. Updater telemetry aggregation for failure-code trend analysis

## 9. Quick troubleshooting playbook

1. Open `updater.log` and `updater-status.json` first.
2. Check `lastError` and match it to the step in section 3.
3. If integrity issues appear, inspect `integrity-status.json` counts and paths.
4. Re-run manual check from App Updates and inspect `/api/updater-diagnostics` payload.
5. If packaging appears incomplete, run `npm run check:installer` and compare release artifacts.
6. If App Updates shows "No updater detection yet" unexpectedly, compare `updaterProgress.latestVersion` with `updaterDiagnostics.lastCheck.latestVersion` and prefer the confirmed diagnostics version for operator triage.

## 10. Antivirus false-positive hardening

CourseForge updater/launcher flows can resemble malware heuristics because they combine local servers, update checks, and process lifecycle controls. Keep these guardrails in place for safer behavior:

1. Prefer loopback-only binding and local-only request handling.
   - `courseforge-serve.cjs` and `courseforge-serve.js` enforce loopback host binding by default.
   - `Start-CourseForge.ps1` launches with loopback enforcement environment flags.
2. Keep browser-access APIs local and deterministic.
   - Return restrictive security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy`).
   - Avoid permissive wildcard CORS by default.
3. Use conservative cleanup defaults in packaged runtime.
   - Launcher sets `COURSEFORGE_ALLOW_AGGRESSIVE_PORT_CLEANUP=0` for end-user startup to reduce process-kill style behavior.
   - Keep aggressive cleanup only as an explicit override for diagnostic scenarios.
4. Preserve strong package integrity validation before staging/apply.
   - Keep SHA-256 and manifest/version contract checks mandatory.
   - Never apply updates without passing integrity validation.
5. Prefer explicit telemetry over aggressive remediation.
   - Emit diagnostics and fail safely rather than force-killing unknown listeners in user environments.

### Operational release guidance

1. Keep binaries signed consistently (same publisher identity and timestamping) to improve AV/SmartScreen reputation.
2. Submit false-positive reports with signer details and SHA-256 when detections occur.
3. Run updater integration suites before release:
   - `tests/integration/auto-update-launcher.integration.test.ts`
   - `tests/integration/update-status-server.integration.test.ts`

## 11. Stale updater-state recovery on boot

To prevent startup UX from getting stuck on an old in-progress status, the launcher API now normalizes stale updater progress from prior sessions.

1. `courseforge-serve.js` and `courseforge-serve.cjs` treat updater states as stale when:
   - state is active (`checking`, `update-available`, `downloading`, `extracting`, `staging`), and
   - `updatedAt` is older than the stale threshold (10 minutes).
2. On stale detection, the API rewrites `updater-status.json` to a safe idle snapshot and logs recovery details.
3. Manual check/stage calls now proceed normally after recovery instead of being blocked by stale active-state detection.
4. Keep this behavior aligned across both runtime files (`.js` and `.cjs`) to avoid environment-specific drift.

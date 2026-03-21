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

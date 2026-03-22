# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

## [1.4.5] - 2026-03-22

### Fixed (1.4.5)

- Hardened manual update checks when GitHub `releases/latest` is stale or inconsistent by adding a verified fallback to the releases list endpoint before reporting "already up to date".
- Added diagnostics source tagging for update checks (`latest`, `releases-list-verified`, `releases-list-fallback`) to improve triage of update lookup behavior.
- Improved OCR cloud reliability handling so cloud authentication failures (for example provider-side 401 responses) immediately mark cloud OCR unavailable in local health cache and avoid repeated failing cloud attempts during the cache window.
- Updated cloud provider status probe logic to validate the same chat-completions model path used by OCR requests, reducing false-positive "available" health states.

### Verified (1.4.5)

- `npx vitest run tests/integration/update-status-server.integration.test.ts`
- `npx vitest run tests/core/autoOcrService.test.ts`
- `npm run test:e2e:ocr`
- `npm run functions:build:compat`

## [1.4.4] - 2026-03-22

### Fixed (1.4.4)

- Fixed startup splash redirect deadlock when updater telemetry stayed in stale checking/staging snapshots. Splash startup now ignores stale updater snapshots and continues once app readiness is confirmed.
- Fixed updater version-label formatting so unknown values no longer render with an invalid `v` prefix (for example `vunknown`).

### Verified (1.4.4)

- `npx vitest run tests/integration/settings.updater.integration.test.tsx`
- `npm run test:e2e:autoupdate`
- `npm run check:installer`

## [1.4.3] - 2026-03-22

### Added (1.4.3)

- Added end-to-end Auto textbook setup trace instrumentation with per-run trace IDs in `AutoTextbookSetupFlow` for capture, upload, OCR, and save lifecycle events.
- Added metadata extraction pipeline trace instrumentation for vision attempt outcomes, OCR fallback activation, and completion-path summaries.
- Added mirrored diagnostics emission to the local OCR debug sink (`/api/ocr-debug-log`) and in-app debug history for easier incident correlation.

### Verified (1.4.3)

- `npm run build`
- `npm run test:e2e`
- `npm run check:installer`

## [1.4.2] - 2026-03-22

### Fixed (1.4.2)

- Enforced user-authoritative OCR provider order: Auto OCR now always executes in the exact local order selected in Settings and only falls back when the primary provider fails.
- Removed automatic provider-order mutation during cloud availability probes, preventing settings from reverting when navigating between Settings and Auto views.
- Stopped implicit cloud shared-policy override in runtime execution order. Shared policy is now only applied when explicitly loaded from Settings.

## [1.4.1] - 2026-03-22

### Fixed (1.4.1)

- Fixed OCR provider order auto-reset overwriting user preferences. The provider order auto-reset (when cloud becomes available) now only happens if the user hasn't explicitly set a preference yet via settings. Once users set their preferred provider order, the auto-reset respects their choice and does not override it.

## [1.4.0] - 2026-03-22

### Fixed (1.4.0)

- Cloud OCR provider now automatically becomes primary when it becomes available for the first time, allowing users to use cloud extraction immediately without manual settings adjustment. Previous localStorage preferences that set local OCR as primary (from when cloud was unavailable) are now auto-reset.

## [1.3.9] - 2026-03-21

### Added (1.3.9)

- File-backed OCR diagnostics endpoint in the packaged local server (`/api/ocr-debug-log`) that writes structured JSONL events to `ocr-debug.log` in the install package root.
- OCR diagnostics tail endpoint (`/api/ocr-debug-log-tail`) for quick local inspection during live manual reproduction runs.
- OCR diagnostics tail inclusion in updater diagnostics payload (`/api/updater-diagnostics`) to centralize troubleshooting context.

### Changed (1.3.9)

- Cloud/local OCR pipeline now emits structured diagnostic events with trace IDs across provider health probes, cloud callable execution, fallback transitions, and all-provider failure summaries.
- Cloud OCR callable failure errors now include traceable context in thrown messages to simplify correlation with local diagnostics logs.
- Expanded OCR unit coverage to assert diagnostics emission and trace-bearing failure behavior.

### Verified (1.3.9)

- `npx vitest run tests/core/autoOcrService.test.ts --reporter=dot --silent`
- `npx vitest run tests/integration/update-status-server.integration.test.ts --reporter=dot --silent`

## [1.3.8] - 2026-03-21

### Changed (1.3.8)

- Manual `Check for Updates` now launches the same background StageOnly updater flow used at startup when a newer release is detected, so the next patch is downloaded and staged before restart.
- The packaged local updater API now returns stage metadata (`stageRequested`, `stageAccepted`, `stageReason`, `stageMessage`, `stagePid`) so the settings UI can explain whether staging started or why it did not.
- Settings update status messaging now reports background staging kickoff while the existing progress telemetry continues to show bytes, speed, and file counts during manual staging.

### Added (1.3.8)

- Integration coverage for manual-stage response metadata in `tests/integration/update-status-server.integration.test.ts`.
- Integration coverage for stage-aware manual update messaging in `tests/integration/settings.updater.integration.test.tsx`.

### Verified (1.3.8)

- `npm run typecheck`
- `npm run test:e2e:autoupdate`
- `npm run check:installer`

### Added (Unreleased)

- Integration coverage for launcher staged-update apply/retry behavior (`auto-update-launcher.integration.test.ts`).
- Integration coverage for local update-status endpoint responses served by the installer runtime (`update-status-server.integration.test.ts`).
- Added OCR-focused e2e lane (`npm run test:e2e:ocr`) to include cloud/local provider fallback behavior, metadata vision fallback behavior, and Auto setup dropped-cover OCR pipeline assertions.
- Added cloud-provider availability callable (`getAiProviderStatus`) and secret-backed OpenAI key access helper in Firebase Functions for reliable OCR readiness reporting.

### Changed (Unreleased)

- Increased timeout for the portable updater missing-payload diagnostic integration test to reduce false negatives on slower Windows runners.
- Auto setup upload preview now uses a scaled display image while keeping full-resolution OCR input, reducing card overflow risk with large drop-zone images.
- Auto OCR service now caches cloud availability checks and hardens image preprocessing against decode stalls to preserve fast fallback behavior.
- Updated docs (`README.md`, `docs/AI_SERVICE_RESILIENCE_PLAN.md`) with OCR e2e coverage and live smoke-test intent.

### Verified (Unreleased)

- `npm run typecheck`
- `npm run functions:build:compat`
- `npm run test:e2e:ocr`
- `npm run test:e2e:webapp`
- `npm run test:e2e:extension`
- `npm run test:e2e:autoupdate`
- `npm run test:e2e`
- `npm run test:e2e:packaged`
- `npm run package:windows`
- `npm run verify:windows`

## [1.3.5] - 2026-03-21

### Fixed (1.3.5)

- Removed auth requirement from `getAiProviderStatus` callable so Cloud OCR health probes no longer fail during auth timing gaps and now return deterministic provider availability.
- Improved client callable error normalization to include details payloads in diagnostic strings, avoiding opaque `internal`-only probe messages.

### Verified (1.3.5)

- `npm run functions:build:compat`
- `npx vitest run tests/core/autoOcrService.test.ts tests/integration/autoTextbookFlow.integration.test.tsx`
- `npm run typecheck`

## [1.3.4] - 2026-03-21

### Fixed (1.3.4)

- Added a gate around cloud provider status probing to dedupe concurrent refreshes and avoid auth-timing race conditions that could produce persistent `unknown` health states.
- Cloud OCR availability now classifies unauthenticated/session-not-ready states as explicit unavailable with actionable messaging instead of inconclusive probe failures.
- Cloud OCR callable execution now retries once after auth token refresh when the first callable attempt fails with unauthenticated.

### Added (1.3.4)

- Regression coverage for concurrent force-refresh health probes to guarantee only one backend status request is in-flight.
- Regression coverage for unauthenticated cloud OCR health behavior and auth-refresh retry flow in `tests/core/autoOcrService.test.ts`.

### Verified (1.3.4)

- `npx vitest run tests/core/autoOcrService.test.ts tests/integration/autoTextbookFlow.integration.test.tsx tests/integration/settings.updater.integration.test.tsx tests/integration/update-status-server.integration.test.ts`
- `npm run typecheck`

## [1.3.3] - 2026-03-21

### Fixed (1.3.3)

- Published the OCR health/manual-check bugfixes as a new patch version so the auto-updater can detect and apply them as a newer release.
- Manual "Check for Updates" now falls back to last-known latest/current metadata and reports an up-to-date message when versions already match, instead of showing a generic failure.
- Local packaged update-status server now retries latest-release metadata requests and uses a longer configurable timeout to reduce transient timeout failures.

### Added (1.3.3)

- Integration regression coverage for timeout-driven manual-check fallback in `tests/integration/settings.updater.integration.test.tsx`.

### Verified (1.3.3)

- `npx vitest run tests/integration/settings.updater.integration.test.tsx tests/integration/update-status-server.integration.test.ts`
- `npm run typecheck`

## [1.3.2] - 2026-03-21

### Fixed (1.3.2)

- Cloud OCR readiness now uses an explicit provider-status callable so the app can distinguish unavailable cloud providers from temporary probe failures and fall back predictably.
- Firebase Functions OCR/AI callables now consume `OPENAI_API_KEY` through v2 secrets configuration, preventing false “cloud unavailable” states caused by missing secret injection.
- Auto OCR image preprocessing is hardened with decode/progress timeouts so stalled decodes do not block provider fallback.
- Auto setup dropped-cover preview now uses scaled display images and tighter overflow constraints to prevent preview card bleed/overflow on large images.

### Added (1.3.2)

- OCR-focused e2e lane via `npm run test:e2e:ocr`.
- Coverage for cloud/local OCR fallback and provider status behavior in `tests/core/autoOcrService.test.ts`.
- Coverage for vision-to-OCR fallback in `tests/core/metadataExtractionPipelineService.test.ts`.
- Integration coverage for dropped-cover OCR pipeline/provider status visibility in `tests/integration/autoTextbookFlow.integration.test.tsx`.

### Verified (1.3.2)

- `npm run typecheck`
- `npm run functions:build:compat`
- `npm run test:e2e`
- `npm run check:installer`

## [1.3.1] - 2026-03-20

### Added (1.3.1)

- Splash screen now surfaces live updater telemetry from `/api/updater-progress`: update state, progress percent, bytes downloaded vs package size, download speed, and changed-file planning counts.
- App Updates card now shows download speed and explicit post-download lifecycle states (`staged` waiting for restart, `updated` applied this session).

### Changed (1.3.1)

- Updater status payload now includes `downloadSpeedBytesPerSecond` during download so splash and in-app status can display transfer-rate feedback for large updates.
- Splash startup polling now consumes updater progress directly and avoids early redirect while active update states are still in flight.

### Verified (1.3.1)

- `npx vitest run tests/integration/update-status-server.integration.test.ts tests/integration/settings.updater.integration.test.tsx tests/integration/auto-update-portable.integration.test.ts`
- `npm run check:installer`

## [1.3.0] - 2026-03-20

### Added (1.3.0)

- New updater maintainer reference at `docs/updater-maintainer-guide.md`, including architecture boundaries, runtime update pipeline, status/diagnostics artifacts, coding conventions, and a prioritized future-work backlog for delta updates, signature validation, repair automation, and telemetry.
- Regression coverage for manual update UX in `tests/integration/settings.updater.integration.test.tsx` to guarantee a friendly non-error message when the updater reports no newer version.

### Changed (1.3.0)

- App Updates card manual-check UX now reports a clear success-style status when no update is available: `Already up to date. You're running v<current>.`
- Local manual-check result handling now prefers service-reported current version metadata (`currentVersion`) when rendering status text.

### Verified (1.3.0)

- `npm run test:e2e`
- `npm run check:installer`

## [1.2.78] - 2026-03-21

### Added (1.2.78)

- **Package integrity verification at update staging time** (`Test-ExtractedPackageContract` in `auto-update-portable.ps1`): the updater now validates every downloaded package before staging it — checks `package-manifest.json` exists and version matches the expected release, validates `manifest.json` exists and its version matches, and runs the full SHA-256 integrity check via `Test-CourseForge-Integrity.ps1`. The update is rejected (state = `error`) if any step fails, preventing corrupt or mismatched packages from ever reaching the live install directory.
- **Portable package integrity script** (`Test-CourseForge-Integrity.ps1`): audits `manifest.json` against every tracked file — detects missing files, size mismatches (`modified`), SHA-256 hash mismatches (`corrupted`), and unexpected extra files (`extras`). Runtime caches (`logs/`, `user-data/`, `ocr-cache/`, `_pending_update/`, `_rollback/`) are excluded from the extras check. Writes a structured JSON report and exits with a machine-readable code (0 = pass, 2 = no manifest, 3 = failures found).
- **Integration tests for integrity validation** (`tests/integration/package-integrity.integration.test.ts`): two Windows-only tests cover the healthy-package pass-through (including schema metadata assertions) and the multi-fault scenario (missing file, corrupted file, extra file, ignored cache directory).
- **Integration tests for updater contract validation** (3 new tests in `tests/integration/auto-update-portable.integration.test.ts`): covers rejection when `manifest.json` is absent, when the package version does not match the release tag, and when the SHA-256 integrity check reports a tampered file.
- **Global test timeout** raised to 30 s in `vitest.config.ts` to prevent false-negative timeouts when the full integration suite runs PowerShell subprocesses under load.

## [1.2.77] - 2026-03-20

### Fixed (1.2.77)

- Restored launcher-consistent portable packaging so auto-updated installs keep the local server, updater APIs, and startup splash instead of falling back to a static `index.html` launch path.
- Restored startup splash support in packaged updates by verifying `boot-splash.html`, launcher scripts, and integrity helpers as required package contents.
- Changed debug logging to default on unless the user explicitly disables it, matching the intended troubleshooting-first settings behavior.

## [1.2.6] - 2026-03-19

### Fixed (1.2.6)

- Simplified uninstall flow by removing component-selection prompts; components are now detected upfront and removed by default, with only a single data-retention confirmation prompt.
- Fixed installed-script uninstall resolution by adding install-root-hint detection via metadata presence, enabling uninstall from installed payload without explicit path parameter.
- Hardened uninstaller wrapper to avoid self-deletion race condition by spawning deferred cleanup via detached PowerShell helper with sleep delay.
- Extended Inno Setup compiler discovery to include user-local installation path (`%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`).

### Added (1.2.6)

- GUI-required release lane (`npm run quality:installer:gui`) for enforcing Inno Setup availability in release builds.
- Regression test coverage for uninstall selection resolution and Windows installer guardrails.

### Changed (1.2.6)

- Hardened the standalone real-sync runner so it can execute under `tsx` without assuming a Vite browser runtime.
- Switched the Windows installer default install scope from admin-only `Program Files`/`HKLM` to per-user `%LOCALAPPDATA%\Programs`/`HKCU` to reduce setup failures on locked-down PCs.
- Added a generated `CourseForge-<version>-installer.exe` self-extracting bootstrap artifact so Windows users can start setup from a single download.

## [1.2.4] - 2026-03-15

### Added (1.2.4)

- Image-level moderation assessment in Auto textbook setup to detect likely explicit cover imagery.
- Educational-context exception routing that marks uncertain but instructional content for admin review instead of immediate rejection.
- Textbook cloud-hold metadata (`requiresAdminReview`, moderation state/reason/confidence) so flagged books remain local-only until approved.
- Admin user-management controls to block/unblock a user's cloud content sync access through a new callable backend action.
- New moderation hold unit coverage for sync gating and expanded Auto extraction/moderation tests.
- Local-first OCR service abstraction with provider ordering, fallback attempts, and circuit-breaker cooldown handling.
- Firebase callable `extractScreenshotText` with auth guard, image validation, payload caps, and per-user request throttling.
- Firebase callables for shared AI provider policy (`getAiProviderPolicy`, `setAiProviderPolicy`) to support org defaults.
- Debug log service for local troubleshooting capture with explicit upload/clear flow to Firestore `debugReports`.
- Settings controls for OCR resilience policy load/save and local debug log management.

### Changed (1.2.4)

- Sync service now blocks cloud upload for textbooks in `pending-admin-review` or `blocked-explicit-content` moderation states.
- Sync service now blocks all cloud writes for users marked as content-blocked while preserving local-first behavior.
- Auto setup save flow now stores moderation metadata and surfaces admin-review messaging for educational exceptions.
- Auto setup capture now runs OCR immediately after each capture and auto-applies metadata/TOC parsing results.
- Auto/Manual source provenance (`sourceType`) is now persisted for textbooks, chapters, and sections.
- Node runtime guardrails now enforce engines at install time with repository-level `.npmrc` (`engine-strict=true`).

### Verified (1.2.4)

- `npm run typecheck`
- `npm run test:unit -- tests/core/textbookAutoExtractionService.test.ts tests/core/syncService.moderationHold.test.ts`
- `npx vitest run tests/integration/autoTextbookFlow.integration.test.tsx`
- `npm test`
- `npm run check:node`
- `npm run check:node:functions`
- `npm run build`
- `npm run build:extension`
- `npm run functions:build:compat`

## [1.2.3] - 2026-03-14

### Added (1.2.3)

- Auto vs Manual textbook onboarding entry mode with a guided screenshot-based Auto setup path.
- Auto capture workflow for cover, title page, and multi-page table of contents with capture-limit enforcement and anti-abuse messaging.
- New textbook metadata fields for richer extracted details: subtitle, gradeBand, copyrightYear, seriesName,
  publisher, publisherLocation, authors, additionalIsbns, and tocExtractionConfidence.
- Auto TOC editor with inline chapter/section correction plus merge/split tools before save.
- New parser/crop unit tests and Auto flow integration coverage for persistence and Manual switching.

### Changed (1.2.3)

- Textbook save input and repository builders now persist optional Auto-extracted metadata alongside existing fields.
- Textbook list cards now surface optional subtitle/series/publisher/grade-band metadata when available.
- Auto save path persists only structured metadata plus cover image while avoiding non-cover page image storage.

### Verified (1.2.3)

- `npm run typecheck`
- `npm run test:unit -- tests/core/textbookAutoExtractionService.test.ts`
- `npm run test:integration -- tests/integration/autoTextbookFlow.integration.test.tsx`

## [1.2.2] - 2026-03-15

### Added (1.2.2)

- Detection of existing section content that has Level 1-only coverage, with an ingest-time option to generate missing harder AI tiers (Level 2/3).
- Persistent "always skip AI materials" preference to bypass optional augmentation for future imports.
- Equation format normalization service with support for LaTeX, Word-linear style input, OMML/XML, and MathML, including context-aware repair suggestions.
- Equation panel import support for equation snippets from local files (`.tex`, `.xml`, `.mml`, `.txt`) with normalized preview output.

### Changed (1.2.2)

- Refactored tiered question generation into a reusable seed-driven helper to augment previously uploaded Level 1 content safely.
- PowerPoint extraction now scans slide XML for formula fragments and normalizes extracted equations before persistence.
- Equation save flows now persist normalized LaTeX output (for example multiplication normalized to `\\cdot`) to keep imports consistent.

### Verified (1.2.2)

- `npm run typecheck`
- `npm test`
- `npm run check:installer`

## [1.2.1] - 2026-03-15

### Added (1.2.1)

- PowerPoint drag/drop, multi-file browse, and folder-based upload support in the webapp ingestion workflow.
- Filename-aware chapter/section auto-matching with chapter/section token scoring.
- Per-file import reporting with explicit duplicate skip and add/merge outcomes.

### Changed (1.2.1)

- Re-imported decks now perform incremental add-only merges based on source key and slide signatures.
- Duplicate deck detection now uses content hashes and reports skipped files during batch import.

### Verified (1.2.1)

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:rules`
- `npm run check:installer`

## [1.2.0] - 2026-03-13

### Added (1.2.0)

- Premium usage governance module in shared core services with deterministic gating and workflow summary reporting.
- Local premium usage tracker and JSONL audit logging under `.copilot/usage`.
- Admin Premium Management panel for freeze/unfreeze operations and manual reset controls.
- Firestore rules test suite (`tests/rules`) using emulator-backed `@firebase/rules-unit-testing`.

### Changed (1.2.0)

- Replaced static premium caps with baseline-derived defaults (`monthly baseline 8.6`, derived daily/weekly, monthly hard limit `100`).
- Updated monthly reset behavior from month-start to local `31st @ 07:00` with last-day fallback for shorter months.
- Extended canonical sync coverage and moderation/admin handling for section-scoped entities: `equations`, `concepts`, and `keyIdeas`.
- Hardened content read policies to owner-or-admin and preserved explicit legacy path deny rules.
- Expanded test scripts to include unit and Firestore rules execution in main test flow.

### Fixed (1.2.0)

- Prevented stale/unsafe premium escalation decisions when daily/weekly/monthly budgets are exceeded.
- Corrected hierarchy propagation for section-scoped content created from webapp/extension quick-add flows.
- Resolved auth listener fallback edge cases and stabilized premium/sync regression tests.

### Verified (1.2.0)

- `npm run test:unit -- tests/core/premiumUsage.limits.test.ts tests/core/copilot.premiumUsageTracker.test.ts`
- `npm run typecheck`
- `npm --prefix functions run build`

## [1.1.1] - 2026-03-11

### Fixed (1.1.1)

- Hardened sync behavior with throttling, write-loop protection, and clearer permission/network handling.
- Added manual and autosync guardrails so failed or blocked sync states do not cascade into repeated writes.
- Improved sync diagnostics across auth, sync service, and admin callable operations for faster issue triage.
- Resolved admin panel module-resolution and accessibility issues in admin content editing flows.
- Stabilized integration tests for the updated sync API surface (`syncNow`, pending diagnostics).
- Migrated cloud sync writes and reads to the canonical Firestore hierarchy (`textbooks -> chapters -> sections -> vocab`) and removed legacy user-scoped content writes.
- Added production Firestore security rules to enforce signed-in reads, owner/admin writes, explicit legacy-path blocking, and catch-all deny guardrails.

### Changed (1.1.1)

- Added admin route lazy-loading and improved bundle chunking for faster non-admin initial load.
- Refined dark/light theme token usage and readability in sync and admin UI surfaces.

### Verified (1.1.1)

- `npm run typecheck`
- `npm run test:core`
- `npm run test:integration`
- `npm run build`
- `npm --prefix functions run build`

## [1.1.0] - 2026-03-11

### Added (1.1.0)

- Persistent Firebase Auth bootstrap with browser-local session restore.
- Route guards and direct path support for `/login`, `/textbooks`, `/textbooks/:id`, and `/admin`.
- Global auth state for authenticated user identity, admin claim status, and auth loading state.
- Firebase Functions workspace with callable admin endpoints for user promotion, moderation, content archive/delete, content search, and inline admin editing.
- Admin tools UI for user management, moderation queue review, and cross-user content browsing.
- Integration tests covering login restore, admin route gating, claim refresh behavior, and automatic sync on login.
- Functions client wiring and Firebase Hosting SPA rewrites.

### Changed (1.1.0)

- Replaced hash-style app flow with BrowserRouter-based navigation.
- Moved admin mutations out of browser-side Firestore access into server-authoritative callable functions.
- Made Firebase app initialization idempotent to avoid duplicate initialization paths.
- Updated textbook actions to use dedicated edit, favorite, and archive icons with matching tooltips and state-aware sorting.
- Expanded README documentation for the current platform shape and release workflow.

### Fixed (1.1.0)

- Ensured admin claim refresh is observed by the client after token changes.
- Fixed Functions callable typing to use the v2 request shape.
- Stabilized the Vitest integration suite by using hoist-safe mocks and route-reset handling between cases.

### Verified (1.1.0)

- `npm run test:core`
- `npm run test:integration`
- `npm run build`
- `cd functions && npm run build`

# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added (Unreleased)

- Integration coverage for launcher staged-update apply/retry behavior (`auto-update-launcher.integration.test.ts`).
- Integration coverage for local update-status endpoint responses served by the installer runtime (`update-status-server.integration.test.ts`).

### Changed (Unreleased)

- Increased timeout for the portable updater missing-payload diagnostic integration test to reduce false negatives on slower Windows runners.

### Verified (Unreleased)

- `npm run test:e2e:webapp`
- `npm run test:e2e:extension`
- `npm run test:e2e:packaged`
- `npm run package:windows`
- `npm run verify:windows`

## [1.2.78] - 2026-03-21

### Added

- **Package integrity verification at update staging time** (`Test-ExtractedPackageContract` in `auto-update-portable.ps1`): the updater now validates every downloaded package before staging it — checks `package-manifest.json` exists and version matches the expected release, validates `manifest.json` exists and its version matches, and runs the full SHA-256 integrity check via `Test-CourseForge-Integrity.ps1`. The update is rejected (state = `error`) if any step fails, preventing corrupt or mismatched packages from ever reaching the live install directory.
- **Portable package integrity script** (`Test-CourseForge-Integrity.ps1`): audits `manifest.json` against every tracked file — detects missing files, size mismatches (`modified`), SHA-256 hash mismatches (`corrupted`), and unexpected extra files (`extras`). Runtime caches (`logs/`, `user-data/`, `ocr-cache/`, `_pending_update/`, `_rollback/`) are excluded from the extras check. Writes a structured JSON report and exits with a machine-readable code (0 = pass, 2 = no manifest, 3 = failures found).
- **Integration tests for integrity validation** (`tests/integration/package-integrity.integration.test.ts`): two Windows-only tests cover the healthy-package pass-through (including schema metadata assertions) and the multi-fault scenario (missing file, corrupted file, extra file, ignored cache directory).
- **Integration tests for updater contract validation** (3 new tests in `tests/integration/auto-update-portable.integration.test.ts`): covers rejection when `manifest.json` is absent, when the package version does not match the release tag, and when the SHA-256 integrity check reports a tampered file.
- **Global test timeout** raised to 30 s in `vitest.config.ts` to prevent false-negative timeouts when the full integration suite runs PowerShell subprocesses under load.

## [1.2.77] - 2026-03-20

### Fixed

- Restored launcher-consistent portable packaging so auto-updated installs keep the local server, updater APIs, and startup splash instead of falling back to a static `index.html` launch path.
- Restored startup splash support in packaged updates by verifying `boot-splash.html`, launcher scripts, and integrity helpers as required package contents.
- Changed debug logging to default on unless the user explicitly disables it, matching the intended troubleshooting-first settings behavior.

## [1.2.6] - 2026-03-19

### Fixed

- Simplified uninstall flow by removing component-selection prompts; components are now detected upfront and removed by default, with only a single data-retention confirmation prompt.
- Fixed installed-script uninstall resolution by adding install-root-hint detection via metadata presence, enabling uninstall from installed payload without explicit path parameter.
- Hardened uninstaller wrapper to avoid self-deletion race condition by spawning deferred cleanup via detached PowerShell helper with sleep delay.
- Extended Inno Setup compiler discovery to include user-local installation path (`%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`).

### Added

- GUI-required release lane (`npm run quality:installer:gui`) for enforcing Inno Setup availability in release builds.
- Regression test coverage for uninstall selection resolution and Windows installer guardrails.

### Changed

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

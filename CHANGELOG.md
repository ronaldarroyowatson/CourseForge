# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [1.2.4] - 2026-03-15

### Added (1.2.4)

- Image-level moderation assessment in Auto textbook setup to detect likely explicit cover imagery.
- Educational-context exception routing that marks uncertain but instructional content for admin review instead of immediate rejection.
- Textbook cloud-hold metadata (`requiresAdminReview`, moderation state/reason/confidence) so flagged books remain local-only until approved.
- Admin user-management controls to block/unblock a user's cloud content sync access through a new callable backend action.
- New moderation hold unit coverage for sync gating and expanded Auto extraction/moderation tests.

### Changed (1.2.4)

- Sync service now blocks cloud upload for textbooks in `pending-admin-review` or `blocked-explicit-content` moderation states.
- Sync service now blocks all cloud writes for users marked as content-blocked while preserving local-first behavior.
- Auto setup save flow now stores moderation metadata and surfaces admin-review messaging for educational exceptions.

### Verified (1.2.4)

- `npm run typecheck`
- `npm run test:unit -- tests/core/textbookAutoExtractionService.test.ts tests/core/syncService.moderationHold.test.ts`
- `npx vitest run tests/integration/autoTextbookFlow.integration.test.tsx`
- `npm test`

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

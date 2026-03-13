# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [1.1.2] - 2026-03-13

### Added (1.1.2)

- Premium usage governance module in shared core services with deterministic gating and workflow summary reporting.
- Local premium usage tracker and JSONL audit logging under `.copilot/usage`.
- Admin Premium Management panel for freeze/unfreeze operations and manual reset controls.
- Firestore rules test suite (`tests/rules`) using emulator-backed `@firebase/rules-unit-testing`.

### Changed (1.1.2)

- Replaced static premium caps with baseline-derived defaults (`monthly baseline 8.6`, derived daily/weekly, monthly hard limit `100`).
- Updated monthly reset behavior from month-start to local `31st @ 07:00` with last-day fallback for shorter months.
- Extended canonical sync coverage and moderation/admin handling for section-scoped entities: `equations`, `concepts`, and `keyIdeas`.
- Hardened content read policies to owner-or-admin and preserved explicit legacy path deny rules.
- Expanded test scripts to include unit and Firestore rules execution in main test flow.

### Fixed (1.1.2)

- Prevented stale/unsafe premium escalation decisions when daily/weekly/monthly budgets are exceeded.
- Corrected hierarchy propagation for section-scoped content created from webapp/extension quick-add flows.
- Resolved auth listener fallback edge cases and stabilized premium/sync regression tests.

### Verified (1.1.2)

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

### Changed (1.1.0)

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

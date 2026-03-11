# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [1.1.1] - 2026-03-11

### Fixed

- Hardened sync behavior with throttling, write-loop protection, and clearer permission/network handling.
- Added manual and autosync guardrails so failed or blocked sync states do not cascade into repeated writes.
- Improved sync diagnostics across auth, sync service, and admin callable operations for faster issue triage.
- Resolved admin panel module-resolution and accessibility issues in admin content editing flows.
- Stabilized integration tests for the updated sync API surface (`syncNow`, pending diagnostics).

### Changed (1.1.0)

- Added admin route lazy-loading and improved bundle chunking for faster non-admin initial load.
- Refined dark/light theme token usage and readability in sync and admin UI surfaces.

### Verified

- `npm run typecheck`
- `npm run test:core`
- `npm run test:integration`
- `npm run build`

## [1.1.0] - 2026-03-11

### Added

- Persistent Firebase Auth bootstrap with browser-local session restore.
- Route guards and direct path support for `/login`, `/textbooks`, `/textbooks/:id`, and `/admin`.
- Global auth state for authenticated user identity, admin claim status, and auth loading state.
- Firebase Functions workspace with callable admin endpoints for user promotion, moderation, content archive/delete, content search, and inline admin editing.
- Admin tools UI for user management, moderation queue review, and cross-user content browsing.
- Integration tests covering login restore, admin route gating, claim refresh behavior, and automatic sync on login.
- Functions client wiring and Firebase Hosting SPA rewrites.

### Changed

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

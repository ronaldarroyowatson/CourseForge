# CourseForge

CourseForge is a local-first curriculum authoring platform for teachers. It combines a browser extension for quick capture with a full web app for textbook management, sync, moderation, and XML export.

Version `1.2.0` focuses on premium-usage governance, section-content sync parity, and Firestore security hardening, including baseline-derived premium caps, deterministic reset windows, and expanded admin/test coverage.

Quick release note: v1.2.0 is primarily about policy enforcement and reliability hardening across sync, rules, admin tooling, and validation.

## What it does

- Build textbook hierarchies with textbooks, chapters, sections, vocab, equations, concepts, and key ideas.
- Save data locally first, then sync per-user content to Firebase.
- Restore sessions automatically with browser-local Firebase Auth persistence.
- Support direct routes such as `/textbooks`, `/textbooks/:id`, and `/admin`.
- Promote admins and moderate shared content through secured callable Cloud Functions.
- Export curriculum data to XML for downstream game and tutor pipelines.

## v1.1 highlights

- Persistent login with automatic session restore and startup sync.
- Route guards for authenticated pages and admin-only pages.
- Admin tools for user management, moderation queue review, and cross-user content browsing.
- Server-authoritative custom claim promotion through `setUserAdminStatus`.
- Updated textbook action icons and favorite/archive sorting behavior.
- Vitest integration tests covering login restore, admin route access, claim refresh, and sync bootstrap.

## v1.2.0 highlights

- Baseline-driven premium usage limits across backend, shared services, and local tracker (`monthlyBaselinePercent = 8.6`, derived daily/weekly defaults).
- Monthly premium reset policy standardized to local `31st @ 07:00` with end-of-month fallback.
- New admin Premium Management panel for usage visibility, freeze/unfreeze actions, and manual daily/weekly/monthly resets.
- Added sync coverage for section-scoped content entities (`equations`, `concepts`, `keyIdeas`) and canonical Firestore ownership fields.
- Expanded Firestore rules and test harness for canonical hierarchy enforcement and legacy-path blocking.

## Project structure

- `src/core` shared entities, repositories, sync logic, and XML export.
- `src/webapp` standalone React app for textbook management and admin operations.
- `src/extension` browser extension sidebar for quick capture workflows.
- `src/firebase` Firebase app, auth, Firestore, and Functions client wiring.
- `functions` Firebase Cloud Functions used for admin-only server actions.
- `tests/core` XML and core-service regression tests.
- `tests/integration` auth and admin integration tests.
- `docs` product, architecture, and schema references.

## Local development

### Prerequisites

- Node.js `20` is recommended for the Firebase Functions workspace.
- npm
- A Firebase project configured to match the values in `src/firebase/firebaseConfig.ts`

### Install

```bash
npm install
cd functions && npm install
```

### Run the web app

```bash
npm run dev
```

### Build

```bash
npm run build
cd functions && npm run build
```

### Portable installer-style package check

```bash
npm run check:installer
```

This now validates both single-file installer-style artifacts:

- `release/CourseForge-<version>-portable.zip`
- `release/CourseForge-<version>-windows.zip`

Portable package contents include:

- `webapp/` built app assets
- `extension/` load-unpacked extension assets
- `AutoUpdate-CourseForge.ps1` startup updater (GitHub Releases)
- `Check-For-CourseForge-Updates.cmd` manual update check
- `Start-CourseForge.cmd` one-click launcher with automatic update check before app launch
- `CourseForge-Start.url` shortcut file
- release docs (`README.md`, `CHANGELOG.md`, `LICENSE`)

Windows package additions include:

- `Install-CourseForge-Windows.ps1`
- `Install-CourseForge-Windows.cmd`

Windows install flow:

- Unzip `CourseForge-<version>-windows.zip`
- Run `Install-CourseForge-Windows.cmd`
- It installs to `%LOCALAPPDATA%\CourseForge` by default (or custom path) and can create a desktop shortcut.

Auto-update behavior:

- On every launch, `Start-CourseForge.cmd` runs `AutoUpdate-CourseForge.ps1` silently.
- The updater checks `https://api.github.com/repos/ronaldarroyowatson/CourseForge/releases/latest`.
- If a newer semantic version exists and includes `CourseForge-<version>-portable.zip`, it downloads and applies the update in-place.
- If update check/download fails, startup continues using the current local package.

Optional auth token for higher GitHub API limits/private access:

- Set `COURSEFORGE_GITHUB_TOKEN` (or `GITHUB_TOKEN`) before launch.
- Packaging-time override for a different release source:
  - `COURSEFORGE_UPDATE_REPO_OWNER`
  - `COURSEFORGE_UPDATE_REPO_NAME`

### Test

```bash
npm run test:core
npm run test:unit
npm run test:integration
npm run test:rules
```

## Firebase notes

- Hosting rewrites are configured in `firebase.json` so BrowserRouter paths resolve correctly.
- Admin operations now go through callable Cloud Functions instead of direct browser-side cross-user writes.
- The admin custom claim is enforced from the auth token, while the mirrored Firestore `users` document exists only for admin UX and reporting.

### Firestore data paths and rules (v1.2)

- Canonical content paths:
  - `/textbooks/{textbookId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}/vocab/{vocabId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}/equations/{equationId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}/concepts/{conceptId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}/keyIdeas/{keyIdeaId}`
- Legacy user-scoped subcollection paths are blocked by rules:
  - `/users/{uid}/textbooks/*`
  - `/users/{uid}/chapters/*`
  - `/users/{uid}/sections/*`
  - `/users/{uid}/vocabTerms/*`
- Ownership checks accept `userId` (current schema) and `ownerId` (forward compatibility).
- Admin write override uses the custom auth claim: `request.auth.token.admin == true`.
- Read access for content documents is scoped to owner-or-admin to prevent cross-tenant reads.

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/DB_SCHEMA.md`
- `docs/XML_SCHEMA.md`
- `docs/PRD.md`

## License

See `LICENSE`.

# CourseForge

CourseForge is a local-first curriculum authoring platform for teachers. It combines a browser extension for quick capture with a full web app for textbook management, sync, moderation, and XML export.

Version `1.3.0` focuses on updater maintainability and user-facing status clarity, including friendlier manual check messaging and a dedicated updater maintainer guide for future architecture and pipeline work.

Quick release note: v1.3.0 improves manual update UX when already current and adds a full updater maintenance handoff guide.

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

## v1.2.4 highlights

- Adds image-level explicit-content scoring during Auto textbook setup (cover/title/TOC capture flow).
- Routes ambiguous educationally-graphic content to admin review instead of auto-blocking when educational context is detected.
- Keeps flagged textbooks local-only by setting moderation hold metadata and preventing cloud writes until admin approval.
- Adds admin user controls to block or restore cloud content sync access for specific users.
- Expands tests for moderation decisions and sync hold enforcement.

## v1.2.2 highlights

- Detects existing Level 1-only section content and offers optional AI augmentation to add missing Level 2/3 material.
- Adds persistent "always skip AI materials" preference for users who want non-AI ingest-only workflows.
- Expands equation ingestion support with normalization from LaTeX, Word-linear text, OMML/XML, and MathML formats.
- Improves malformed equation handling with preview + repair suggestions and normalized persistence for consistency.

## v1.2.1 highlights

- Added drag/drop plus multi-file and folder-based PowerPoint import from the dedicated workspace card.
- Implemented filename-aware chapter/section matching using name tokens and chapter/section numbering hints.
- Added SHA-256 duplicate detection with per-file skip messaging for already imported decks.
- Added source-key and slide-signature based incremental merges so re-imports add only new slides.
- Added import summaries to report added/skipped content and keep batch behavior transparent.

## Project structure

- `src/core` shared entities, repositories, sync logic, and XML export.
- `src/webapp` standalone React app for textbook management and admin operations.
- `src/extension` browser extension sidebar for quick capture workflows.
- `src/firebase` Firebase app, auth, Firestore, and Functions client wiring.
- `functions` Firebase Cloud Functions used for admin-only server actions.
- `tests/core` XML and core-service regression tests.
- `tests/integration` auth and admin integration tests.
- `docs` product, architecture, and schema references.

## Developer documentation

| Document | Description |
| --- | --- |
| [Developer Onboarding Guide](docs/developer-onboarding.md) | Setup, architecture overview, key modules, coding standards, and testing strategy for new contributors |
| [Auto Mode Pipeline Flowchart](docs/auto-mode-flowchart.md) | Mermaid flowchart of the full Auto Mode capture → extract → stitch → save pipeline |
| [Firestore Debug Rules](docs/firestore-debug-rules.md) | Firestore security rules for debug log protection: access model, helper functions, testing and deploy guide |
| [Architecture Overview](docs/ARCHITECTURE.md) | High-level layers, data flow, and Firestore structure |
| [DB Schema](docs/DB_SCHEMA.md) | Entity definitions for all local and cloud-synced data |
| [Code Style](docs/CODE_STYLE.md) | File organization, naming, spacing, and comment conventions |
| [XML Schema](docs/XML_SCHEMA.md) | Canonical export format for game engines and AI tutors |
| [Windows File Layout](docs/windows-file-layout.md) | Windows install paths, shortcut layout, and registry map |
| [Installer Flowchart](docs/installer-flowchart.md) | Mermaid flowcharts for install/repair/uninstall/rollback lifecycle |
| [Updater Maintainer Guide](docs/updater-maintainer-guide.md) | Updater architecture, staging pipeline, diagnostics files, coding conventions, and extension points |
| [ChromeOS Deployment](docs/chromeos-deployment.md) | Chrome extension/webapp deployment guidance for managed Chromebooks |
| [i18n Architecture](docs/i18n-architecture.md) | Language detection, fallback strategy, and localization data model |
| [Accessibility Plan](docs/accessibility-plan.md) | Foundational accessibility features, settings, and roadmap |

## Local development

### Prerequisites

- Node.js `20` for Firebase Functions development and deploy parity.
- Node.js `20-24` for the root workspace (webapp/extension tooling); Node 24 is supported for canary validation only.
- npm
- A Firebase project configured to match the values in `src/firebase/firebaseConfig.ts`

### Node runtime checks

```bash
npm run check:node
npm run check:node:functions
npm run verify:stable
npm run verify:canary
```

- `check:node` validates root workspace compatibility (`>=20 <25`).
- `check:node:functions` is strict and enforces Node 20 for Functions workflows.
- `verify:stable` is the release lane (Node 20 root + strict Node 20 Functions).
- `verify:canary` validates newer Node for root tooling and bridges Functions build through Node 20.
- Node pins are tracked in `.nvmrc` and `.node-version`.

When your local machine uses newer Node (for example Node 24) but you still need to run Functions checks safely:

```bash
npm run functions:build:compat
npm run functions:serve:compat
npm run functions:deploy:compat
```

These commands keep Functions runtime compatibility by executing Functions tasks on Node 20 automatically.

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

For planned Node 24 canary runs:

```bash
npm run check:node:next24
```

See `docs/NODE_RUNTIME_PLAN.md` for the staged adoption plan and release gates.

### Portable installer-style package check

```bash
npm run check:installer
```

Installer test and quality commands:

```bash
npm run test:installer
npm run quality:installer
npm run quality:installer:gui
```

- `test:installer` runs installer lifecycle logic tests and Windows installer template guardrail tests.
- `quality:installer` runs `test:installer` and then performs full package generation + verification (`check:installer`).
- `quality:installer:gui` runs the same installer tests, but requires the GUI installer build path and fails if Inno Setup is unavailable.

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
- `Uninstall-CourseForge-Windows.cmd`
- `installer-integrity.json`
- `release/CourseForge-<version>-installer.exe` self-extracting bootstrap installer for first-time setup

Windows install flow:

- Download `CourseForge-<version>-installer.exe`
- Double-click the installer and follow the prompts.
- Default install path is `%LOCALAPPDATA%\Programs\CourseForge`, so first-time setup works without admin rights on standard Windows PCs.
- The `CourseForge-<version>-windows.zip` artifact remains available for advanced/manual deployments and update payloads.
- Supports full lifecycle modes: Install, Modify, Repair, Uninstall, Silent Install, and Full Auto Install.
- Supports component flags and icon flags for IT automation: `/SILENT`, `/FULLAUTO`, `/INSTALL_WEBAPP`, `/INSTALL_EXTENSION`, `/INSTALL_BOTH`, `/NO_DESKTOP_ICON`, `/NO_STARTMENU_ICON`, `/REPAIR`, `/UNINSTALL`.
- Writes structured logs to `%LOCALAPPDATA%\CourseForge\logs\` including `installer.log`, `silent-install.log`, `auto-install.log`, `repair.log`, `uninstaller.log`, and `rollback.log`.

Windows installer UX notes:

- The packaging script now prefers an Inno Setup GUI wizard build when `ISCC.exe` (Inno Setup 6 compiler) is available on the build host.
- If Inno Setup is not installed, packaging falls back to the legacy self-extracting bootstrap installer.
- To always get the standard Windows wizard UI on double-click, install Inno Setup 6 and ensure `ISCC.exe` is available in PATH (or in a default Inno install location).
- Release guardrail option: run `npm run package:windows:gui` (or set `COURSEFORGE_REQUIRE_GUI_INSTALLER=1`) to fail packaging if GUI installer prerequisites are missing.
- Full GUI release lane: run `npm run quality:installer:gui` to test, package, and verify the wizard installer end to end.

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

### Moderation and hold behavior (v1.2.4)

- Auto textbook setup applies image-level moderation before persistence.
- Moderation outcomes:
  - `allow`: textbook can sync normally.
  - `pending-admin-review`: textbook is saved locally and blocked from cloud sync until admin approval.
  - `blocked-explicit-content`: textbook is blocked from cloud sync and requires admin intervention.
- Admins can block a user from cloud content sync access without deleting local data on that user's machine.

### Legacy PowerPoint conversion setup (.ppt -> .pptx)

CourseForge can import legacy .ppt files by calling the Firebase callable function convertPresentationFile, which forwards to a configured conversion API.

Required Functions environment variables:

- CONVERSION_API_URL: primary HTTPS endpoint that accepts JSON `{ fileName, base64 }` and returns JSON with converted `base64` data.
- CONVERSION_API_KEY: bearer token sent to the conversion endpoint.
- CONVERSION_FALLBACK_API_URL: optional backup endpoint used when the primary endpoint fails.

Behavior and safety fallback:

- If conversion config is missing, the app shows a manual-conversion message and asks the teacher to convert to .pptx manually.
- If conversion retries fail on both primary and fallback endpoints, the callable returns an unavailable error with retry/manual guidance.
- The frontend only sends legacy .ppt files to conversion; .pptx imports bypass conversion.

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/DB_SCHEMA.md`
- `docs/XML_SCHEMA.md`
- `docs/PRD.md`

## License

See `LICENSE`.

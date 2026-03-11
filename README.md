# CourseForge

CourseForge is a local-first curriculum authoring platform for teachers. It combines a browser extension for quick capture with a full web app for textbook management, sync, moderation, and XML export.

Version `1.1.0` adds persistent Firebase login, true path-based routing, Cloud Function-backed admin tools, and integration coverage for the auth and admin flows.

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

### Test

```bash
npm run test:core
npm run test:integration
```

## Firebase notes

- Hosting rewrites are configured in `firebase.json` so BrowserRouter paths resolve correctly.
- Admin operations now go through callable Cloud Functions instead of direct browser-side cross-user writes.
- The admin custom claim is enforced from the auth token, while the mirrored Firestore `users` document exists only for admin UX and reporting.

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/DB_SCHEMA.md`
- `docs/XML_SCHEMA.md`
- `docs/PRD.md`

## License

See `LICENSE`.
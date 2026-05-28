# CourseForge – Architecture Overview

## 1. High‑level architecture

CourseForge consists of three main layers:

1. **Core layer (`src/core`)**
   - Data models (textbook, chapter, section, vocab, equation, concept)
   - Database access layer
   - XML export logic

2. **Web app (`src/webapp`)**
   - Full‑screen UI for:
     - Creating and editing textbooks
     - Managing chapters and sections
     - Editing vocab, equations, concepts, key ideas
     - Exporting XML

3. **Browser extension (`src/extension`)**
   - Sidebar UI for:
     - Quick capture of vocab, equations, concepts while viewing the textbook
   - Shares core logic and database with the web app.

---

## 2. Data flow

1. Teacher uses web app or sidebar to enter data.
2. Data is persisted via the core database service.
3. Auto textbook capture applies text/image moderation; flagged educational content is marked `pending-admin-review` and remains local-only.
4. Sync service uploads only content allowed by textbook moderation state and user cloud-access policy.
5. Textbook deletion is author-scoped: only the owning user can issue a delete for canonical textbook records.
6. Deleted textbooks create a local tombstone when cloud deletion cannot be confirmed immediately.
7. During sync reconciliation, tombstones with pending delete intent take precedence over timestamp drift so deleted textbooks cannot rehydrate as ghost records on refresh.
8. When requested, the XML exporter reads from the database and generates a schema‑compliant XML document.
9. The game engine and AI tutor consume the XML.
10. Textbook list and duplicate-resolution surfaces compute per-textbook content stats (chapters, sections, vocab, equations, concepts, key ideas) to classify data quality (`Complete`, `Partial`, `Empty`) and surface a strongest-record hint (`Best Data`) for quick duplicate triage.
11. Sync preflight performs a single `/users/{uid}` token read (`syncToken`) and skips hierarchy fan-out reads when the token matches the last local checkpoint and there are no pending local writes.

---

## 3. Database

- Local‑first approach (e.g., IndexedDB or SQLite via WASM).
- Stores:
  - Textbooks
  - Chapters
  - Sections
  - Vocab terms
  - Equations
  - Concepts
  - Key ideas
  - Timestamps and basic versioning
- Firestore cloud mirror for synced entities:
  - `/textbooks/{textbookId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}`
  - `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}/vocab/{vocabId}`
- User profile docs stored at `/users/{uid}` for auth bootstrap and admin user management.
- User profile docs also store cloud content policy state (`isContentBlocked`, reason/updatedBy metadata).
- User profile docs store a lightweight cloud content token (`syncToken`) updated after cloud curriculum mutations so clients can cheaply detect no-change sync windows.
- Firestore security model:
  - Authenticated users can read canonical curriculum docs.
  - Users can only write docs they own (`userId` / `ownerId` match).
  - Admin claim (`request.auth.token.admin == true`) bypasses ownership checks.
  - Legacy user-scoped content subcollections under `/users/{uid}` are explicitly denied.

### Moderation and policy gates

- Auto textbook setup performs image-level moderation on capture output.
- Textbooks marked `pending-admin-review` or `blocked-explicit-content` are excluded from cloud upload.
- Users marked content-blocked by admin cannot upload any curriculum entities to cloud until unblocked.
- Local-first persistence remains available even when cloud upload is blocked.

### Textbook quality comparison signals

- The repository helper `getTextbookContentStatsMap(textbookIds)` performs a single-pass aggregation over hierarchy stores and returns per-textbook counts for structure and captured learning entities.
- UI consumers (`TextbookList`, `DuplicateResolutionDialog`) avoid per-card N+1 counting queries by requesting stats for all visible textbooks at once.
- Quality classification is intentionally user-facing and conservative:
  - `Complete`: cover image present, chapter/section structure present, and at least one captured content entity.
  - `Partial`: some captured data exists, but one or more core capture dimensions are still missing.
  - `Empty`: no cover, no structure, no captured entities, and minimal metadata richness.
- The `Best Data` hint uses a deterministic strength score based on structure depth, captured entity totals, metadata richness, and cover presence, so users can eliminate weaker duplicates quickly during cleanup.

See `DB_SCHEMA.md` for details.

---

## 4. XML export

- XML is the canonical export format.
- Designed to be:
  - AI‑readable
  - Game‑engine‑readable
  - Hierarchical and semantic
- Export granularity:
  - Full textbook
  - Single chapter
  - Single section

See `XML_SCHEMA.md` for details.

---

## 5. Extension vs web app

- **Web app**
  - Full editing experience
  - Structure management
  - XML export
- **Extension sidebar**
  - Quick capture while viewing textbook pages
  - Minimal UI, keyboard‑first
  - Uses the same core models and database services

---

## 6. Future integration points

- Cloud sync service for multi‑device and multi‑teacher use.
- API endpoints for game engines to fetch XML directly.
- AI services for:
  - Vocab definition suggestions
  - Equation suggestions
  - Student hint generation based on XML.

---

## 7. Updater maintenance

- For updater architecture, pipeline, diagnostics files, and extension conventions, see `updater-maintainer-guide.md`.

---

## 8. MemPalace governance

From now on, every architectural change, new file, refactor, plugin addition, plugin removal, loader update, installer/uninstaller change, CLI command, or design decision MUST be written into MemPalace using add_memory. MemPalace is the authoritative source of truth for the CourseForge architecture.

---

## 9. School Admin and Super Admin Governance

- Settings now includes school affiliation capture (search existing school entries or create a manual school name + district).
- School identity is persisted on `/users/{uid}` (`schoolId`, `schoolName`, `districtName`) and mirrored to `/schools/{schoolId}` for directory and membership counts.
- First-member bootstrap: when a school has no existing school-admin users, the first user to save affiliation is auto-assigned school-admin (`schoolAdmin` custom claim + `isSchoolAdmin` user profile flag).
- New school-admin surface (`/school-admin`) is scoped to one school/district and supports:
  - school member visibility
  - invite creation by email (stored in `schoolInvites`)
  - user removal from school membership
  - textbook delete/undelete control within recycle window metadata
- New super-admin surface (`/super-admin`) is global and supports:
  - all-schools directory and counts
  - global user role controls (admin and super-admin)
  - promotion request queue (`schoolAdminPromotionRequests`) with approve/reject workflow
  - global usage/stats snapshot for core collections
- Super-admin global stats source-of-truth:
  - user totals from Firebase Auth user records (not only mirrored Firestore user docs)
  - textbook totals from Firestore collection-group `textbooks`
  - tracked activity totals aggregated from `ocrUsage` and `premiumUsage` collection-group docs
- Existing `/admin` route remains global admin tooling; super-admins are also allowed through this route.

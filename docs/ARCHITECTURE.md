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
5. When requested, the XML exporter reads from the database and generates a schema‑compliant XML document.
6. The game engine and AI tutor consume the XML.

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

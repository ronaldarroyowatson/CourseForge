# CourseForge – Database Schema

## 1. Overview

The database stores all editable curriculum data before export to XML.

Core entities:

- Textbook
- Chapter
- Section
- VocabTerm
- Equation
- Concept
- KeyIdea (optional)

---

## 2. Entities

### 2.1 Textbook

- `id` (string/UUID)
- `userId` (string, owner uid)
- `title` (string)
- `grade` (string)
- `subject` (string)
- `edition` (string)
- `publicationYear` (number)
- `isbnRaw` (string)
- `isbnNormalized` (string)
- `platformUrl` (string, optional)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)
- `lastModified` (timestamp/string)
- `pendingSync` (boolean)
- `source` (local | cloud)
- `isFavorite` (boolean)
- `isArchived` (boolean)
- `status` (draft | submitted | approved | rejected, optional)
- `isDeleted` (boolean, optional)

### 2.2 Chapter

- `id`
- `userId` (string, owner uid)
- `textbookId`
- `index` (number, order in textbook)
- `name` (string)
- `description` (string, optional)
- `lastModified` (timestamp/string)
- `pendingSync` (boolean)
- `source` (local | cloud)
- `status` (draft | submitted | approved | rejected, optional)
- `isDeleted` (boolean, optional)

### 2.3 Section

- `id`
- `userId` (string, owner uid)
- `textbookId` (string, optional but required for cloud path derivation)
- `chapterId`
- `index` (number, order in chapter)
- `title` (string)
- `notes` (string, optional)
- `lastModified` (timestamp/string)
- `pendingSync` (boolean)
- `source` (local | cloud)
- `status` (draft | submitted | approved | rejected, optional)
- `isDeleted` (boolean, optional)

### 2.4 VocabTerm

- `id`
- `userId` (string, owner uid)
- `textbookId` (string, optional but required for cloud path derivation)
- `chapterId` (string, optional but required for cloud path derivation)
- `sectionId`
- `word` (string)
- `definition` (string, optional)
- `altDefinitions` (array of strings, optional, for AI‑generated variants)
- `lastModified` (timestamp/string)
- `pendingSync` (boolean)
- `source` (local | cloud)
- `status` (draft | submitted | approved | rejected, optional)
- `isDeleted` (boolean, optional)

### 2.5 Equation

- `id`
- `sectionId`
- `name` (string, e.g., "Newton's Second Law")
- `latex` (string)
- `description` (string, optional)

### 2.6 Concept

- `id`
- `sectionId`
- `name` (string)
- `explanation` (string, optional)

### 2.7 KeyIdea (optional)

- `id`
- `sectionId`
- `text` (string)

---

## 3. Implementation notes

- Local‑first storage (IndexedDB/SQLite) with a simple abstraction in `src/core/services/db.ts`.
- Cloud sync mirrors textbooks/chapters/sections/vocab to Firestore canonical hierarchy:
	- `/textbooks/{textbookId}`
	- `/textbooks/{textbookId}/chapters/{chapterId}`
	- `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}`
	- `/textbooks/{textbookId}/chapters/{chapterId}/sections/{sectionId}/vocab/{vocabId}`
- Firestore security ownership checks accept either `userId` (current) or `ownerId` (compatibility).
- Legacy user-scoped subcollections are blocked (`/users/{uid}/textbooks|chapters|sections|vocabTerms`).
- All entities should be easily serializable to XML.
- Foreign keys are logical (enforced in code, not necessarily by the storage engine).
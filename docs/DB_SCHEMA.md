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
- `title` (string)
- `grade` (string)
- `subject` (string)
- `edition` (string)
- `publicationYear` (number)
- `platformUrl` (string, optional)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

### 2.2 Chapter

- `id`
- `textbookId`
- `index` (number, order in textbook)
- `name` (string)
- `description` (string, optional)

### 2.3 Section

- `id`
- `chapterId`
- `index` (number, order in chapter)
- `title` (string)
- `notes` (string, optional)

### 2.4 VocabTerm

- `id`
- `sectionId`
- `word` (string)
- `definition` (string, optional)
- `altDefinitions` (array of strings, optional, for AI‑generated variants)

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
- All entities should be easily serializable to XML.
- Foreign keys are logical (enforced in code, not necessarily by the storage engine).
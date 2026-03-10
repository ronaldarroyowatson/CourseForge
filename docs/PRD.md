# CourseForge – Product Requirements Document (PRD)

## 1. Product overview

CourseForge is a teacher‑facing tool for building structured curriculum datasets that can be exported as XML and consumed by a game engine and AI tutor.

Teachers use CourseForge to:

- Define textbooks/curricula and their structure (chapters, sections)
- Capture vocab, definitions, equations, concepts, and key ideas
- Export game‑ready XML files for each textbook, chapter, or section

CourseForge is the **input layer** for a mastery‑based educational game ecosystem.

---

## 2. Users and personas

- **Classroom teachers:** Build curriculum datasets for their own classes.
- **Curriculum coordinators / providers:** Build canonical datasets for a district or program.
- **Game designers / developers:** Consume XML exports to generate levels and mastery paths.

---

## 3. Goals

- Make it fast and easy for teachers to enter structured curriculum data.
- Ensure data is stored in a database for editing, querying, and versioning.
- Provide reliable XML exports that are:
  - AI‑readable
  - Game‑engine‑readable
  - Stable and schema‑validated
- Support a hybrid UX:
  - Browser extension sidebar for quick capture
  - Standalone web app for full editing and export

---

## 4. Non‑goals (initial)

- No OCR or DOM scraping.
- No direct integration with publisher platforms.
- No student‑facing UI (handled by the game engine).
- No real‑time multi‑user collaboration in v1.

---

## 5. Core workflows

### 5.1 Create a new textbook

1. Teacher opens CourseForge (web app or sidebar).
2. Clicks “Add new textbook”.
3. Enters metadata: title, grade, subject, edition, publication year, optional website/platform.
4. Saves textbook.

### 5.2 Define structure (chapters and sections)

1. For a textbook, teacher specifies number of chapters/units.
2. For each chapter:
   - Enter chapter name and optional description.
   - Enter number of sections.
3. For each section:
   - Enter section title and optional notes.

### 5.3 Capture content for a section

For each section, teacher can enter:

- Vocab (word + definition, or word only)
- Equations (manual entry or AI‑assisted suggestion in future)
- Concepts covered
- Key ideas / notes

The sidebar focuses on quick capture; the web app supports full editing.

### 5.4 Export XML

1. Teacher opens the web app.
2. Selects a textbook (or chapter/section).
3. Clicks “Export as XML”.
4. CourseForge generates a schema‑compliant XML file.

---

## 6. Future features

- AI‑assisted vocab definitions.
- AI‑assisted equation matching and formatting.
- AI‑assisted hints for students inside the game (using the same XML).
- Cloud sync and multi‑device access.
- Analytics on coverage and mastery.

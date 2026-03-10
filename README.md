# CourseForge

CourseForge is a teacher‑guided curriculum builder and knowledge engine.

Teachers use CourseForge to:

- Define textbooks/curricula (metadata, chapters, sections)
- Capture vocab, definitions, equations, concepts, and key ideas
- Store everything in a structured database
- Export game‑ready XML files for ingestion by a game engine and AI tutor

CourseForge is the **curriculum compiler** for a mastery‑based educational game ecosystem.

---

## Core concepts

- **Teacher‑guided input:** Teachers manually enter the important elements of each chapter/section.
- **Database‑backed:** All data is stored in a structured database for editing, querying, and versioning.
- **XML export:** CourseForge exports canonical XML files that are readable by both the game engine and AI systems.
- **Hybrid UX:** A browser extension sidebar for quick capture, plus a standalone web app for full editing and export.

---

## High‑level architecture

- `src/core`: Shared models, database services, and XML export logic.
- `src/webapp`: Standalone web app for full textbook management and export.
- `src/extension`: Browser extension (sidebar) for quick capture while viewing the textbook.
- `docs/`: Product and technical documentation (PRD, architecture, schemas).

See `docs/ARCHITECTURE.md` for more details.

---

## Roadmap (initial)

- [ ] Implement core data models (textbook, chapter, section, vocab, equation, concept).
- [ ] Implement local database layer.
- [ ] Implement XML export for a full textbook.
- [ ] Implement basic web app UI for textbook creation and editing.
- [ ] Implement browser extension sidebar for quick capture.
- [ ] Integrate XML export with game engine prototype.

---

## License

See `LICENSE`.
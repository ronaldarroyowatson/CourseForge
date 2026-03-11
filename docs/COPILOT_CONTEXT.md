# Copilot Context for CourseForge

This document provides guidance for GitHub Copilot when generating code for the CourseForge project.

## Project Summary

CourseForge is a teacher-guided curriculum builder and knowledge engine. It allows teachers to:

- Create textbooks with chapters and sections
- Enter vocab terms, equations, concepts, and key ideas
- Store everything in a local-first database
- Export structured XML files for use by a game engine and AI tutor

CourseForge consists of:
- A browser extension sidebar for quick capture
- A standalone web app for full editing and XML export
- A shared core library for models, database access, and XML generation

## Architecture Principles

- Local-first storage (IndexedDB or SQLite via WASM)
- Shared core logic between extension and web app
- Clean separation of concerns
- XML export is deterministic and schema-driven
- No DOM scraping or OCR
- Teacher-first UX

## Coding Style

- Use clear, unambiguous names
- Prefer small, single-purpose functions
- Keep files focused and short
- Use TypeScript interfaces for all models
- Add comments that explain intent, not obvious behavior
- Avoid cleverness; prioritize readability
- Use async/await consistently

## Future Roadmap

- AI-assisted definition and equation suggestions
- Cloud sync
- Multi-teacher collaboration
- Game engine integration

Copilot should generate code that aligns with these principles.

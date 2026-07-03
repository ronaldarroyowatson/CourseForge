# CourseForge - Greenfield Rewrite (vNext)

CourseForge is a local-first curriculum authoring platform for teachers.
This repository is the clean rewrite workspace for CourseForge vNext.

## Current Status

- Repository is intentionally lean for indexing and fresh implementation work.
- Legacy binary artifacts are kept local-only and are not tracked in this repository.
- Architecture and planning notes are maintained in `docs/`.

## Goals

- Local-first reliability
- Modular architecture
- Clear boundaries between core, webapp, extension, and backend services
- Strong testing and release hygiene from day one

## Current Repository Structure

```
README.md
SECURITY.md
copilot-instructions.md
docs/
deliverables/
```

## Planned Structure

```
src/core/           # Entities, repositories, sync logic, export
src/webapp/         # Web app for textbook management and admin tools
src/extension/      # Browser extension capture workflows
src/firebase/       # Firebase client wiring
functions/          # Cloud Functions
tests/core/         # Core regression tests
tests/integration/  # Auth/admin integration tests
docs/               # Architecture, schema, onboarding, flowcharts
```

## Testing Direction

- tests/core for logic and domain behavior
- tests/integration for auth/admin/moderation workflows
- tests/e2e for capture, OCR, and metadata flows

## License

See LICENSE.
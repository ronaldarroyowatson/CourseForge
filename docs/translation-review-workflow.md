# Translation Review Workflow

## Purpose

The translation review workflow gives teachers and admins a focused queue to validate AI-generated and low-confidence translations before students see them.

## Data Models

- `TranslationMemoryEntry` now supports `locked` to mark approved classroom-ready entries.
- `TranslationReviewItem` drives the queue UI with `reason` values:
  - `new-ai`
  - `low-confidence`
  - `recently-changed`

## Developer Extension Guide

- Queue logic lives in `src/core/services/translationReviewService.ts`.
- Review actions:
  - `approveTranslationForReview`
  - `editTranslationForReview`
  - `rejectAndRegenerateTranslation`
  - `getTranslationHistory`
- Queue filtering supports language, subject tag, confidence threshold, and Zomi focus mode.

## Teacher/Admin Workflow

1. Open Admin Tools and switch to **Translation Review**.
2. Filter by language/subject and optionally enable **Highlight Zomi**.
3. For each row:
   - **Approve** to lock current translation (`confidence = 1.0`).
   - **Edit** to update text inline and write to translation memory.
   - **Reject & Regenerate** to force fresh AI output.
   - **View History** for version traceability.
   - **Add to Glossary** when the override should become a reusable term.

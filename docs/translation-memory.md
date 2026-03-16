# Translation Memory System

## Overview

CourseForge now supports a translation-memory-first workflow for multilingual terminology:

1. Local lookup in IndexedDB (`translationMemory` store)
2. Optional shared cloud lookup (`translationMemory/{language}/terms/{termId}`)
3. AI-assisted fallback candidate generation
4. Teacher/admin override with history retention

## Data Model

Each entry tracks:

- `termId`
- `sourceText`
- `translatedText`
- `language`
- `updatedBy` (`ai`, `teacher`, `admin`)
- `confidence`
- Variant candidates (`literalTranslation`, `contextualTranslation`, `academicTranslation`)
- `history` of manual changes and resets

## Admin and Teacher Overrides

- Admins can review and override entries in the Admin panel.
- Reset-to-AI restores the best available AI baseline variant.
- Overrides are stored locally first and can be synchronized to shared cloud memory.

## Batch Translation

`batchResolveTranslations` resolves multiple terms by applying the same TM-first pipeline per item.

## Operational Notes

- Language normalization uses primary tags (for example `es-MX` -> `es`).
- Unknown or unavailable remote registries automatically fall back to built-in language metadata.

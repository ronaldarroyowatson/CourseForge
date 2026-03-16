# Game Text Pipeline

## Purpose

Support multilingual game experiences (quizzes, flashcards, interactive activities) with translation-memory-first localization and English fallback.

## Data Model

`GameTextEntry`:

- `id`
- `gameId`
- `key`
- `defaultLanguage`
- `texts: Record<string, string>`
- `contextTags?`
- `lastUpdated`
- `updatedBy`

## Storage

- IndexedDB store: `gameText`
- ID convention: `${gameId}:${entryId}`
- Static text option: locale `game.json` files under `locales/*/`.

## Pipeline

When creating game text:

1. Persist source text as default language.
2. For each target language, call translation workflow.
3. Translation workflow checks translation memory first.
4. If missing, AI translation is generated (with glossary boost when available).
5. Result is saved into:
   - game text entry (`gameText`)
   - translation memory (handled by translation workflow)

## Runtime Switching

- Use current user language preference as input.
- Resolve text from `texts[targetLanguage]`.
- Fall back to English or `defaultLanguage` when missing.

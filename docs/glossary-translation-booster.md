# Glossary Translation Booster

## Purpose

Increase translation consistency for domain-heavy content (biology, physics, math) by combining glossary constraints with AI translation generation.

## Data Model

`GlossaryEntry`:

- `id`
- `subject`
- `sourceLanguage`
- `targetLanguage`
- `sourceTerm`
- `preferredTranslation`
- `notes?`
- `usageRefs?`
- `createdAt`, `updatedAt`, `updatedBy`

## Storage

- IndexedDB store: `glossaries`
- ID pattern mirrors `/glossaries/{subject}/{languagePair}/{entryId}` semantics.

## Translation Usage

- `lookupGlossaryHints` finds matching glossary entries by subject and language pair.
- `buildGlossaryAwareTranslator` boosts AI candidates with preferred terminology.
- Teacher/admin override can call `addGlossaryFromOverride` to persist terms from review flow.

## Admin/Teacher UI

- New **Glossaries** section in Admin Tools.
- Features:
  - filter by subject and language pair
  - add/edit (save overwrite by key) and remove entries
  - usage reference tracking (`usageRefs`) to show where a term is used

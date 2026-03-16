# Zomi Starter Pack

## Purpose

Provide immediate, usable Zomi language support while translation quality improves through teacher/admin review.

## Contents

- Locale files in `locales/zm/`:
  - `common.json`
  - `onboarding.json`
  - `autoMode.json`
  - `settings.json`
  - `errors.json`
  - `game.json`
- Runtime catalog updates in `src/core/services/i18nService.ts`.

## Fallback Strategy

- Missing Zomi keys fall back to English in `t(language, namespace, key)`.
- Some starter strings are intentionally English to keep classroom UX stable while review coverage grows.

## How to Extend

- Add or refine Zomi keys in locale JSON files.
- Keep key names aligned with English locale keys.
- Use translation review queue + glossary tools to stabilize high-frequency terms.

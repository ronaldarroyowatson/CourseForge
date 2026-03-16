# i18n Architecture

## Overview

CourseForge now includes a scalable language foundation supporting:

- English (`en`)
- Spanish (`es`)
- Portuguese (`pt`)
- Zomi (`zm`)
- French (`fr`)
- German (`de`)

## Implementation Details

### Locale Layout

Locale resources are structured under:

- `locales/en/`
- `locales/es/`
- `locales/pt/`
- `locales/zm/`
- `locales/fr/`
- `locales/de/`

Each language folder contains:

- `common.json`
- `onboarding.json`
- `autoMode.json`
- `settings.json`
- `errors.json`

### Runtime Services

Core service `src/core/services/i18nService.ts` provides:

- language detection (`detectLanguage`)
- key-based translation lookup with fallback (`t`)
- supported language registry (`getSupportedLanguages`)
- optional AI translation hook (`translateTextOptional`)

### Detection Priority

Language resolution order:

1. User profile preference
2. OS locale
3. Browser locale
4. English fallback

### Live Language Switching

- Settings page language selector updates state immediately.
- Selected language is persisted to user profile (`users/{uid}.preferences.language`).

## Textbook Localization Model

Textbook model includes:

- `originalLanguage: string`
- `translatedFields?: Record<string, { title?, subtitle?, chapters?, sections? }>`

This keeps data language-agnostic and ready for future export targets.

## Future Roadmap

- Promote locale JSON files to primary runtime catalogs for all UI text.
- Add translator workflows for admin-managed district language packs.
- Expand AI translation pipeline from optional hook to integrated batch operation.

## Developer Notes

- For new language support, add a locale folder and include it in the supported language union.
- New user-facing strings must include English fallback keys.
- Avoid hard-coding display text in new components where translation keys exist.

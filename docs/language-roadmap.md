# Language Roadmap

## Current Built-In Languages

- English (`en`)
- Spanish (`es`)
- Portuguese (`pt`)
- Zambian locale (`zm`)
- French (`fr`)
- German (`de`)

## Roadmap Candidates

Tracked in `languages.json` and surfaced in Settings/Admin update checks:

- Chinese (Simplified)
- Chinese (Traditional)
- Hindi
- Arabic
- Bengali
- Russian
- Japanese
- Korean
- Italian
- Dutch

## Expansion Process

1. Add language code to `languages.json` `supported`.
2. Add UI localization resources under `locales/`.
3. Validate accessibility typography and contrast.
4. Add translation-memory acceptance tests.
5. Run typecheck and test suites before release packaging.

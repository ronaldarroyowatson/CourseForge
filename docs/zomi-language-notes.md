# Zomi Language Notes

## Orthography

- Current starter strings use Latin-script Zomi placeholders for practical classroom review.
- Spelling variants may appear between communities; teacher override is the source of truth.

## Font Considerations

- Current UI defaults are acceptable for the starter pack.
- If classroom testing reveals glyph issues, add a dedicated Zomi-friendly font in the app typography stack.

## Directionality

- Zomi is treated as left-to-right (LTR).
- No RTL layout handling is required for the current implementation.

## Improvement Strategy

1. Seed with English-safe fallback plus Zomi placeholders.
2. Prioritize teacher review queue with **Highlight Zomi** toggle.
3. Lock approved classroom translations at confidence `1.0`.
4. Promote recurring overrides into glossaries for better future AI output.

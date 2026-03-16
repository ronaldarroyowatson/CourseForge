# Accessibility and Internationalization

## Objectives

CourseForge language features are implemented with accessibility parity as a requirement, not an add-on.

## Key Practices

- Language preference persists in profile and local storage.
- `html[lang]` is updated when user language changes.
- High contrast and color-blind modes remain active across language switches.
- Dyslexia and dyscalculia support settings remain independent from language.

## Translation UX Guidelines

- Keep educational wording age-appropriate and concise.
- Favor explicit glossary terms over ambiguous synonyms.
- Store alternate AI candidates to support educator review.

## Validation Checklist

- Keyboard navigation remains fully usable in localized settings/admin views.
- Status messaging is announced via `aria-live` where asynchronous updates occur.
- Contrast checks stay WCAG AA-compliant for translated UI labels.

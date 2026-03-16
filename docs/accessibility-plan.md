# Accessibility Plan

## Overview

CourseForge now includes foundational accessibility support for:

- color blindness
- dyslexia
- dyscalculia
- low-vision users
- keyboard-first navigation

## Implementation Details

### Preference Model

User profile preferences support:

- `accessibility.colorBlindMode`
- `accessibility.dyslexiaMode`
- `accessibility.dyscalculiaMode`
- `accessibility.highContrastMode`
- `accessibility.fontScale`
- `accessibility.uiScale`

These settings are mirrored between local state and Firestore user profile preferences.

### Color Blindness

Supported palettes:

- `protanopia`
- `deuteranopia`
- `tritanopia`

Theme variables update through root data attributes.

### Dyslexia

Dyslexia mode applies:

- dyslexia-friendly font stack fallback
- expanded line height
- increased letter and word spacing

### Dyscalculia

Dyscalculia support applies:

- tabular number rendering
- increased equation/symbol spacing in math-oriented panels

### Low Vision

Low-vision support includes:

- high-contrast mode
- font scale slider
- UI scale slider
- persistent focus-visible ring

### Keyboard Navigation

Added global shortcuts:

- `Alt+1`: Textbooks
- `Alt+2`: Settings
- `Alt+3`: Admin (if available)
- `Alt+S`: show sync hint

## Future Roadmap

- Add automated contrast audit tools for component-level checks.
- Add WCAG AA/AAA score reporting in development.
- Expand keyboard shortcut discoverability and customization.

## Developer Notes

- Keep interactive elements keyboard reachable.
- Use semantic HTML and ARIA labels when no visible label exists.
- Test accessibility modes with both light and dark themes.

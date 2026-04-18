# CourseForge Codebase Index

This file is maintained to help AI agents quickly locate code, services, tests, and conventions across the CourseForge monorepo.

---

## Repository Layout

```text
/
├── src/
│   ├── core/
│   │   ├── models/           — TypeScript domain model types
│   │   └── services/         — All business-logic services (browser + Node compatible)
│   ├── firebase/             — Firebase client initialization (auth, firestore, functions, storage)
│   ├── webapp/
│   │   ├── components/       — React components
│   │   │   ├── settings/     — SettingsPage and related cards
│   │   │   ├── admin/        — Admin-only panels
│   │   │   └── layout/       — Header, Shell, etc.
│   │   ├── store/            — Zustand stores (uiStore, authStore)
│   │   └── styles/           — CSS (globals.css, sidebar.css)
│   └── extension/            — VS Code extension entry points + sidebar styles
├── functions/                — Firebase Cloud Functions (Node 20)
├── scripts/                  — Build, release, and CLI helper scripts
│   └── program-cli.mjs       — CLI entry point (`npm run program -- debug ...`)
├── tests/
│   ├── core/                 — Unit tests for services
│   ├── integration/          — Integration and e2e tests
│   └── rules/                — Firestore security rules tests
├── docs/                     — Project documentation
├── .github/
│   ├── copilot-instructions.md — Agent workflow instructions (MANDATORY reading)
│   └── agents/               — Agent-specific configs (do not read directly)
└── package.json              — Scripts, dependencies
```

---

## Key Services (`src/core/services/`)

| File | Purpose |
| ---- | ------- |
| `designSystemService.ts` | Restored DSC design-token engine: type scale, stroke, spacing, motion, semantic colors, local/cloud persistence, corruption recovery. |
| `masonryLayoutService.ts` | Masonry layout engine spec for DSC: adaptive columns, Fibonacci spacing tokens, card-type heuristics, auto-arrange and drag/drop readiness metadata. |
| `semanticTokens.ts` | **Authoritative DSC semantic palette** — MAJOR, MINOR, ACCENT, SUCCESS, WARNING, ERROR, INFO. Single source of truth for all color tokens. |
| `tokenDebugService.ts` | Token resolution debug module — records every token resolution, generates full DSC debug reports, detects legacy colors and cascading failures. |
| `debugLogService.ts` | General-purpose local debug log (auto-mode, sync events). Separate from DSC token debugging. |
| `accessibilityService.ts` | WCAG contrast checking, colorblind helpers. |
| `autoOcrService.ts` | OCR provider management (cloud + local Tesseract). |
| `syncService.ts` | Firestore read/write sync with budget enforcement. |
| `i18nService.ts` | Translation/localization helpers. |
| `presentationService.ts` | PPTX generation and design suggestion helpers. |

---

## Authoritative Semantic Color Palette

Defined in `src/core/services/semanticTokens.ts`. These values are **immutable**.

| Token | Hex | CSS Variable |
| ----- | --- | ------------ |
| MAJOR | `#2563EB` | `--dsc-major` |
| MINOR | `#73A2F5` | `--dsc-minor` |
| ACCENT | `#FFFFFF` | `--dsc-accent` |
| SUCCESS | `#22C55E` | `--dsc-success` |
| WARNING | `#FACC15` | `--dsc-warning` |
| ERROR | `#EF4444` | `--dsc-error` |
| INFO | `#06B6D4` | `--dsc-info` |

**Legacy colors:** `#0c3183` (LEGACY_BRAND_BLUE) — must NOT appear in active UI. Whitelisted only for historical export templates.

---

## CSS Variables

- DSC semantic tokens: `--dsc-*` — defined at top of `src/webapp/styles/globals.css`
- UI design tokens: `--cf-*` — theme variables (accent, surface, border, shadow, etc.)
- Both light and dark theme overrides via `[data-theme="dark"]`

---

## CLI Debug Pipeline

```bash
npm run program -- debug dsc enable          # Enable DSC debug mode
npm run program -- debug dsc report          # Generate token debug report (stdout)
npm run program -- debug dsc report --report /path/out.json  # Write to file
npm run program -- debug dsc clear           # Clear DSC debug logs
npm run program -- debug dump-log            # Dump general debug log
npm run program -- debug clear-log           # Clear general debug log
```

---

## Tests

| File | What it covers |
| ---- | -------------- |
| `tests/core/masonryLayoutService.test.ts` | Masonry DSC layout engine decisions: adaptive columns, panel spans, Fibonacci spacing tokens, feature-set flags |
| `tests/core/semanticTokens.test.ts` | Authoritative palette values, token matching, CSS generation, legacy color detection, token resolution recording, debug report generation |
| `tests/core/uiStore.preferences.test.ts` | Language + accessibility preference store |
| `tests/core/debugLogService.test.ts` | General debug log service |
| `tests/core/accessibilityService.test.ts` | WCAG contrast calculation |

Run all unit tests: `npm run test:unit`
Run a specific test: `npx vitest run tests/core/semanticTokens.test.ts`

---

## Settings Page Debug Log Card

Location: `src/webapp/components/settings/SettingsPage.tsx`

The Debug Log card (`article.settings-card > h3:Debug Log`) is the unified control surface for:

- Enabling/disabling general debug logging
- Uploading/clearing the general debug log
- **DSC Token Debug section**: Enable/disable DSC debug mode, generate/copy full DSC report, clear DSC logs

The restored DSC card now uses a masonry layout engine with preview-first placement, adaptive reflow, Fibonacci spacing tokens, and mirrored preview/control surfaces.

---

## Workflow Rules (from `.github/copilot-instructions.md`)

1. **Always write a failing test first** before fixing any bug.
2. Bugfix workflow: test → confirm failure → fix code → expand coverage → release.
3. Only bump PATCH version for bug fixes. NEVER bump MINOR for a fix.
4. Use `npm run bugfix:release -- -Description "..."` to publish a release.
5. `#0c3183` in active UI is always a bug — report it, fix it, test it.

# CourseForge — Copilot Instructions

## Bugfix Release Workflow (ALWAYS follow this for every bug fix)

When fixing a bug, complete ALL steps in this order before finishing:

1. **Fix the bug** in source code.
2. **Run `npm run bugfix:test`** — typecheck + build + full test battery.
3. **Fix any failures** — TypeScript errors (VS Code Problems pane), failing tests.
4. **Update docs** — if the fix changes behavior, update relevant docs in `docs/`.
5. **Run the release script**: `npm run bugfix:release -- -Description "Short description of fix"`
   - This bumps patch version, commits, tags, pushes, packages, and publishes.

### Quick manual release (if needed):
```
powershell -ExecutionPolicy Bypass -File scripts/bugfix-release.ps1 -Description "Fix: <what was fixed>"
```

### Dry run (tests only, no publish):
```
npm run bugfix:release -- -Description "..." -DryRun
```

---

## Version Numbering — CRITICAL

**PATCH only for bug fixes. PATCH counts indefinitely — never resets, never rolls over.**

| Type | Example |
|------|---------|
| Bug fix | `1.4.10` → `1.4.11` → `1.4.12` → ... → `1.4.100` |
| New feature | `1.4.10` → `1.5.0` |
| Breaking change | `1.4.10` → `2.0.0` |

- `bugfix-release.ps1` handles patch bumping automatically.
- **NEVER** bump MINOR for a bug fix (e.g. `1.4.10 → 1.5.0` is WRONG for a bug fix).
- **NEVER** reset patch to 0 after a bug fix.

---

## Key Test Commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck:all` | Clears VS Code Problems pane TypeScript errors across app and scripts |
| `npm run test:index` | Regenerates the checked-in test index |
| `npm run test:samples:validate` | Verifies canonical sample naming and usage |
| `npm run bugfix:test` | Full quality gate: typecheck + build + all tests |
| `npm run test:e2e:comprehensive` | Complete end-to-end + unit + integration battery |
| `npm run test:rules` | Firestore rules tests (Java or static fallback) |
| `npm run test:smoke:ocr:cloud` | Cloud OCR smoke test |

---

## Bugfix Checklist

Before marking any bug fix complete, confirm:

- [ ] `npm run typecheck:all` passes (zero errors)
- [ ] `npm run test:index` was run after test-suite changes
- [ ] `npm run test:samples:validate` passes after fixture changes
- [ ] `npm run test:e2e:comprehensive` passes
- [ ] VS Code Problems pane shows no new errors
- [ ] Relevant docs updated (if behavior changed)
- [ ] `npm run bugfix:release` completed (version bumped, git synced, GitHub release published)
- [ ] Auto-updater can discover new release (`gh api repos/ronaldarroyowatson/CourseForge/releases/latest`)

---

## Project Conventions

### Testing And Fixture Standards

- Read and follow `docs/TESTING_AND_DEBUG_STANDARDS.md` when changing tests, smoke flows, fixtures, or debug tooling.
- Canonical smoke samples belong in `tmp-smoke/samples` only and must use `<category>__<scenario>__<expected-outcome>.<ext>` naming.
- Keep one blank-input fixture and one corrupted-input fixture per distinct corruption mode. Delete redundant duplicates.
- Timestamped smoke outputs under `tmp-smoke/` are generated artifacts, not canonical fixtures.
- When changing parser or extraction tests, prefer structured expected-versus-actual assertions over weak truthy checks.

### Debug And CLI Mirror Standards

- Any new debug behavior in the app should keep a CLI-equivalent path via `npm run program -- debug ...`.
- Debug metadata should include timestamp, subsystem, severity, source type, and error context whenever available.
- Use normalized source type vocabulary (`automatic`, `manual`) for new debug and CLI flows; preserve compatibility with older app entity values only where needed.


---

## Changelog Size Management

`bugfix-release.ps1` automatically keeps `CHANGELOG.md` under **300 KB** using a two-tier system:

| Setting | Value | Meaning |
|---------|-------|---------|
| `$MainChangelogReleaseCount` | 12 | Maximum recent releases kept in `CHANGELOG.md` |
| `$ArchivePageReleaseCount` | 50 | Releases per archive page |
| `$MaxChangelogSizeKB` | 300 | Hard size ceiling for `CHANGELOG.md` |

**How it works on every release:**
1. The current `CHANGELOG.md` size is reported before the new entry is inserted.
2. A warning is shown if the file is already >80% of the 300 KB limit.
3. After inserting the new entry, `Publish-ChangelogPages` builds the main file with the 12 most recent releases.
4. If the built content exceeds 300 KB, entries are moved to archive pages **two-at-a-time** until it fits.
5. Archived entries are written to `CHANGELOG-page-1.md`, `CHANGELOG-page-2.md`, … at the repo root.
6. Stale archive pages from previous runs are automatically deleted.
7. The final size and entry counts are printed for every run.

**Rules:**
- `CHANGELOG.md` always retains the `## [Unreleased]` section and an archive page index block.
- Archive pages are tracked by git — they are the permanent historical record.
- Never manually edit `CHANGELOG-page-N.md` files; they are fully regenerated each release.

---

## Codebase Index Usage (Persistent)

- Canonical codebase index file: `docs/codebase-index.md`.
- For architecture mapping, domain discovery, flow tracing, and shared-utility lookup, consult `docs/codebase-index.md` first before broad repo exploration.
- Treat the existing Step 1–Step 7 sections in `docs/codebase-index.md` as historical/canonical unless a user explicitly requests rewriting them.
- Index updates are append-only by default: add new sections/subsections (for example: `Updates`, `Revisions`, `New Domain`, `Updated Flow`, `New Shared Utility`, `Refactor Notes`, `Deprecations`) instead of rewriting prior sections.
- If newer behavior supersedes older behavior, append an explicit update note rather than silently modifying historical sections.
- When boundaries are ambiguous, state assumptions explicitly in the appended update.

---

## Permanent UI And Design Codex

These are permanent architectural rules for all future agents, code generation, refactors, tests, and design updates in CourseForge. Treat them as non-optional unless a user explicitly authorizes a deviation.

### Atomic Design System (Always On)

- All UI work must follow atomic design layering: design tokens -> atoms -> molecules -> organisms -> pages.
- All design tokens must come from a single source of truth. Do not hard-code production UI values when a tokenized value should exist.
- The canonical design-token implementation must remain centralized and reusable across settings, previews, runtime UI, skeleton states, tests, and debug flows.
- The Example Card and Controls Card architecture is the canonical live-preview surface for design system work. New visual system work should be previewed there before being propagated broadly.

### Token Methodologies (Mandatory)

- Color scale: use a gamma-based 9-shade scale with constant hue and luminance progression `L = V^gamma`.
- Typography scale: use a modular geometric progression `FontSize = Base x Ratio^n`.
- Stroke scale: use a modular geometric progression `Stroke = BaseStroke x Ratio^n`.
- Spacing scale: use a modular geometric progression `Spacing = Base x Ratio^n`.
- Motion scale: timing and easing must be tokenized and user-adjustable.
- Semantic colors are mandatory and must support at minimum `error`, `success`, `pending`, and `new`.
- Settings safety is mandatory: keep-changes confirmation, timed revert, reset-to-defaults, and CLI recovery path.
- Persistence is mandatory: local persistence first, optional cloud sync, and system-default detection where relevant.
- Corrupted settings must never be blindly applied. Validate first, then repair, delete, or fall back.

### Layout Engine Rules (Mandatory)

- All multi-card layouts must use Fibonacci-derived ratios.
- Two-card layouts default to `3:2`, with Example Card occupying the larger pane and Controls Card occupying the smaller pane.
- Three-card layouts default to `5:3:2` or `8:5:3`.
- Four-or-more-card layouts should use cascading Fibonacci partitions rather than equal-width grids unless the surrounding design system explicitly requires uniformity.
- Responsive fallbacks must preserve the Fibonacci hierarchy through vertical stacking order rather than flattening layout intent.
- Directional-flow is a first-class layout rule. Left/right anchoring and movement direction must derive from directional-flow decisions, not arbitrary placement.
- Horizontal alignment between control surfaces and preview surfaces is required whenever both are visible in the same composition.
- Gaps, padding, and margins must come from spacing tokens.

### Motion Choreography Rules (Mandatory)

- Enter transitions use `ease-in`.
- Moving/repositioning transitions use `ease-in-out`.
- Exit transitions use `ease-out`.
- Animation timing must always come from motion settings tokens.
- Transition direction must come from directional-flow.
- Apply this choreography consistently to page transitions, card transitions, settings panels, example preview updates, skeleton transitions, motion preview boxes, and any element that appears, moves, or disappears.

### Skeleton Loader Rules (Mandatory)

- Loading states must use structure-aware skeleton loaders, not generic spinners when layout structure is known.
- Skeletons must mirror the final UI hierarchy: headings, cards, text lines, buttons, and major panel geometry.
- Skeleton colors, radii, spacing, and animation timing must come from design tokens.

### Settings And Recovery Rules (Mandatory)

- On first run, attempt to detect OS/browser defaults relevant to UI state: font sizing hints, contrast, color scheme, reduced motion, and similar supported preferences.
- If system detection succeeds, use it as the initial default layer.
- If detection partially or fully fails, fall back safely to CourseForge defaults and record why.
- When cloud-synced settings exist, future implementations should explicitly handle these user choices: apply cloud, keep local, merge local into cloud, or delete cloud settings and use local defaults.
- When local or cloud settings are corrupted, present repair/delete/reset options instead of silently applying broken values.

### Development Cache Flush Rules (Mandatory)

- In development mode, prefer aggressive cache clearing to avoid stale-state regressions during UI/design iteration.
- Development startup should clear cached design tokens, cached settings, cached UI state, cached metadata, cached OCR/agent responses, cached layout preferences, cached motion settings, and other stale prototyping artifacts unless the user explicitly opts out.
- Development-only cache behavior must not silently leak into packaged or production behavior.

### Debug And Trace Rules (Mandatory)

- Debug mode must produce a chronological trace for design-system behavior.
- Log layout decisions, Fibonacci ratio choices, directional-flow choices, motion timing/easing, skeleton activation, example preview updates, control changes, animation lifecycle events, cache flush events, system-detection attempts, cloud settings detection, corruption detection, repair/delete/reset events, safety-system triggers, and all fallback logic.
- Debug metadata should continue to include timestamp, subsystem, severity, source type, and error context wherever available.
- Any new debug-capable UI behavior should preserve a CLI-equivalent recovery or inspection path where practical.

### Testing Expectations (Mandatory)

- New UI-system features must include deterministic tests for token generation, layout choices, motion behavior, fallback logic, corruption handling, persistence, and debug traces where feasible.
- When changing settings, preview, recovery, skeleton, or trace behavior, add tests that verify both the user-visible behavior and the fallback/recovery path.

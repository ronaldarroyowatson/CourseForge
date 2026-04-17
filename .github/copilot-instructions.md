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

## Test-First Bugfix Workflow — MANDATORY

**Agents MUST follow this workflow for every bug fix. Refusing to follow it is not acceptable.**

### Steps

1. **Write a failing test first.**
   - Reproduce the exact bug in a test assertion before touching any source code.
   - Confirm the test fails for the right reason (not a test setup error).

2. **Confirm the failure reason.**
   - Read the test output carefully.
   - The failure must describe the actual bug, not a missing fixture or import error.

3. **Fix the code.**
   - Make the minimal change that causes the failing test to pass.
   - Do not refactor unrelated code in the same commit.

4. **Expand coverage.**
   - Add light/dark/hover/active/disabled/focus state variants where applicable.
   - Add regression assertions for any related edge cases discovered during investigation.

5. **Add to regression suite.**
   - Ensure the new tests are included in the test index (`npm run test:index`).
   - Ensure `npm run test:e2e:comprehensive` passes end-to-end.

### Color and Token Bug Specific Rules

- **NEVER** accept a fix that does not include a failing test demonstrating the wrong color.
- **NEVER** accept a fix for `#0c3183` (legacy brand blue) without confirming the authoritative replacement token is `--dsc-major` (#2563EB) or another correct DSC token.
- All semantic token tests live in `tests/core/semanticTokens.test.ts`.
- All token resolutions are validated in `src/core/services/semanticTokens.ts` — the authoritative source of truth.
- Use `npm run program -- debug dsc report` to generate a CLI token debug report at any time.

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
- DSC token debug pipeline is accessible via `npm run program -- debug dsc report`.

### Color System Standards

- Authoritative semantic tokens live in `src/core/services/semanticTokens.ts`.
- CSS custom properties for DSC tokens are prefixed `--dsc-*` and defined at the top of `src/webapp/styles/globals.css`.
- Any appearance of `#0c3183` in active themes, cards, or components is a bug unless explicitly referenced via `LEGACY_COLOR_WHITELIST["LEGACY_BRAND_BLUE"]`.
- Tests for semantic tokens and token debug module: `tests/core/semanticTokens.test.ts`.

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

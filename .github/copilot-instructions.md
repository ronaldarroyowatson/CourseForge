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

## MemPalace Architecture Governance (MANDATORY)

From now on, every architectural change, new file, refactor, plugin addition, plugin removal, loader update, installer/uninstaller change, CLI command, or design decision MUST be written into MemPalace using add_memory. MemPalace is the authoritative source of truth for the CourseForge architecture.

Before performing any task, ALWAYS verify MemPalace is alive.
If not alive, trigger the CourseForge watchdog restart sequence.

Completion gate:

- Any architecture-impacting task is incomplete until its MemPalace entry has been written.
- Include changed files, rationale, and compatibility impact in the memory record.

### Workspace-Scoped Startup Rules (MANDATORY)

- MemPalace startup logic must stay in workspace automation (`.vscode/tasks.json`, watchdog scripts, preflight scripts), not in app runtime entrypoints.
- App startup commands (`npm run dev`, `npm run webapp`, app bootstrap code) must not depend on MemPalace preflight, restart, or watchdog success.
- If MemPalace is offline, the web app must still start immediately; diagnostics and retries belong to watchdog/task layers only.
- Watchdog retry policy must be bounded (single `--once` retry cycle before watch mode) to prevent runaway loops.
- Port cleanup and ownership checks must verify the listener belongs to CourseForge before treating recovery as successful.
- Prevent duplicate MemPalace instances: startup scripts/tasks should avoid spawning additional watchers when one is already active for the workspace.
- Add or update regression tests whenever changing startup/task/watchdog coupling to enforce app/MemPalace isolation.

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

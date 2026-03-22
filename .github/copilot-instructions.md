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
| `npm run typecheck` | Clears VS Code Problems pane TypeScript errors |
| `npm run bugfix:test` | Full quality gate: typecheck + build + all tests |
| `npm run test:e2e:comprehensive` | Complete end-to-end + unit + integration battery |
| `npm run test:rules` | Firestore rules tests (Java or static fallback) |
| `npm run test:smoke:ocr:cloud` | Cloud OCR smoke test |

---

## Bugfix Checklist

Before marking any bug fix complete, confirm:

- [ ] `npm run typecheck` passes (zero errors)
- [ ] `npm run test:e2e:comprehensive` passes
- [ ] VS Code Problems pane shows no new errors
- [ ] Relevant docs updated (if behavior changed)
- [ ] `npm run bugfix:release` completed (version bumped, git synced, GitHub release published)
- [ ] Auto-updater can discover new release (`gh api repos/ronaldarroyowatson/CourseForge/releases/latest`)

---

## Project Conventions

- Source root: `src/`
- Version in: `package.json` (root)
- Release zips: `release/CourseForge-<version>-portable.zip` and `release/CourseForge-<version>-windows.zip`
- Release notes: `docs/releases/<version>.md`
- CHANGELOG: `CHANGELOG.md` (root)
- Git tags: `v<version>` (e.g. `v1.4.11`)
- GitHub owner: `ronaldarroyowatson` / repo: `CourseForge`

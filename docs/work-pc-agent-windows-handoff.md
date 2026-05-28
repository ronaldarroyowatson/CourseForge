# Work PC Agent - Windows Installer Handoff

Use this brief when the remote Windows agent is running without the release authority laptop present.

## Scope

- Build and verify Windows installer artifacts only.
- Do not bump version, create tags, or publish releases.

## Branch and Sync Rules

1. Checkout the designated release-prep branch.
2. Pull latest changes before build.
3. Keep commits limited to Windows workflow/build fixes only.

## Required Commands

Run from repo root in order:

```powershell
npm ci
npm run package:windows -- -AllowLegacyBootstrap
npm run verify:windows
```

Optional additional verification:

```powershell
npm run package:portable
npm run verify:portable
```

## Deliverables Back to Release Authority

Provide these files from `release/` for the current version:

- `CourseForge-<version>-portable.zip`
- `CourseForge-<version>-windows.zip`
- `CourseForge-<version>-installer.exe`
- `CourseForge-<version>-windows/` directory contents (or zipped equivalent)

Provide SHA256 for each deliverable.

## Report Template

- Branch:
- Commit SHA:
- Node version:
- package.json version:
- package:windows result:
- verify:windows result:
- Artifact file list with sizes:
- SHA256 checksums:
- Known warnings/errors (if any):

## Guardrails

- Never run `bugfix:release` from work PC.
- Never publish GitHub release from work PC.
- Never retag versions from work PC.

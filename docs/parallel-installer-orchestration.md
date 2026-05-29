# Parallel Installer Orchestration

This document defines a one-command parallel installer matrix workflow where this macOS laptop remains the final release authority.

## Final Authority Model

- This laptop owns final patch bump, changelog finalization, tag creation, and release publication.
- Parallel jobs only build and verify platform artifacts.
- Windows and Linux installer validation run in GitHub Actions while macOS packaging/testing stays local by default.

## One-Command Dispatch

From repo root:

```bash
npm run orchestrate:installers -- --description "Bugfix artifact build" --ref main

# Blocking mode (recommended for testing agents)
npm run orchestrate:installers:wait -- --description "Bugfix artifact build" --ref main
```

Optional flags:

- `--with-macos` to include macOS job in GitHub Actions
- `--no-macos` to force-skip macOS job in GitHub Actions
- `--no-windows` to skip Windows job
- `--no-linux` to skip Linux job
- `--wait` to block until workflow completion and return pass/fail
- `--ref <branch-or-sha>` to build a specific revision

Underlying workflow:

- `.github/workflows/parallel-installer-build.yml` (workflow name: `Parallel Installer Matrix Build`)

## Track Workflow Run

```bash
gh run list --workflow parallel-installer-build.yml
gh run view <run-id> --log
```

## Produced Artifacts

- macOS job:
  - `CourseForge-<version>-macos-portable.zip`
  - `CourseForge-<version>-macos.dmg`
  - `CourseForge-<version>-macos/` staged payload
  - SHA256 files for macOS artifacts

- Windows job:
  - `CourseForge-<version>-portable.zip`
  - `CourseForge-<version>-windows.zip`
  - `CourseForge-<version>-installer.exe`
  - `CourseForge-<version>-windows/` staged payload
  - SHA256 files for Windows artifacts

- Linux job:
  - `CourseForge-<version>-portable.zip`
  - `CourseForge-<version>-portable/` staged payload
  - SHA256 for Linux-hosted portable artifact
  - Installer lifecycle guardrail test execution logs

## Recommended Daily Flow

1. Run the one-command dispatch from this laptop.
2. Let workflow run Windows + Linux lanes in parallel (and macOS only when explicitly enabled).
3. Download artifacts from workflow run.
4. Validate installer checksums and smoke test outcomes.
5. Perform final bugfix release publish from this laptop only.

## Work PC Agent Handoff

If a work-PC agent is also active, assign it the Windows validation checklist in:

- `docs/work-pc-agent-windows-handoff.md`

The work-PC agent should not publish tags/releases; it should only build, verify, and upload/report artifact outcomes.

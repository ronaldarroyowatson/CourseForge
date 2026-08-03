# Next Agent Handoff (2026-08-02)

## Scope

This handoff covers the multi-repo Otto + CourseForge workspace:

- CourseForge
- Maestro
- otto-kernel
- otto-command-service
- otto-update
- otto-extensions
- otto-protocol
- otto-ui
- otto-server

## What Was Just Synced To GitHub

### CourseForge

- Branch: `main`
- Commit: `e975738bdc0266c7304c5ba5e87a209f87d4c20b`
- Changes:

- `.github/workflows/build-installers.yml`
- `.github/workflows/main.yml`
- `.vscode/settings.json`

### Maestro

- Branch: `main`
- Commit: `91446ddd967c065e2b0e889c04c95b77fe61e293`
- Changes:

- `package.json` (`@otto/command-service` path corrected to `file:../otto-command-service`)
- `package-lock.json` added

### otto-update

- Branch: `main`
- Commit: `9a6d6b0dc2d49730770f12e4fad3c89a77b72560`
- Changes:

- `README.md` payload checklist and installer reference updates

### otto-ui

- Branch: `main`
- Commit: `76ac29f657aeb7be97ae866587d0370eeb9dea7d`
- Changes:

- `otto-helper/vite.renderer.config.ts` switched from CommonJS `require` to ESM import for `@vitejs/plugin-react`

## Mempalace Updates Completed

### Mempalace: otto-update

- Updated: `mempalace/gitops/repo-sync-index.json`
- Added: `mempalace/testing/testing-cycle-2026-08-02.json`

### Mempalace: otto-ui

- Updated: `mempalace/gitops/repo-sync-index.json`
- Added: `mempalace/testing/testing-cycle-2026-08-02.json`

## Current Test/Tooling Notes

- Global Vitest installed: `vitest/4.1.10`.
- `otto-ui` Vitest startup issue resolved (ESM config load now works).
- In this Windows environment, prefer `npm.cmd` over `npm` in PowerShell due execution-policy restrictions on `npm.ps1`.
- `Maestro` can run Vitest, but full native-path test coverage may still require local native toolchain support for `better-sqlite3` (Python + node-gyp build chain).

## Instructions and Key Context Files

- Primary repo instructions (CourseForge): `copilot-instructions.md`
- CI/workflow changes: `.github/workflows/`
- Update payload and manifest context: `deployment/`, `manifests/`, `otto-update/manifests/`
- Mempalace roots in Otto repos: `otto-kernel/mempalace/`, `otto-command-service/mempalace/`, `otto-update/mempalace/`, `otto-extensions/mempalace/`, `otto-protocol/mempalace/`, `otto-ui/mempalace/`, `otto-server/mempalace/`

## Recommended Next-Stage Checklist

1. Pull latest `main` in all repos before further edits.
2. Re-run repo-level sanity checks where touching runtime code (`npm.cmd run test`, `npm.cmd run typecheck`).
3. If touching release/update logic, update both `mempalace/gitops/repo-sync-index.json` and `mempalace/testing/testing-cycle-YYYY-MM-DD.json`.
4. Keep generated artifacts and manifests aligned with README guidance in `otto-update/README.md`.
5. For Windows shells, use `npm.cmd` commands in automation notes and troubleshooting docs.

## Open Risks / Follow-up Items

- `Maestro` native module builds (`better-sqlite3`) may fail on hosts without supported Python/toolchain configuration.
- If full integration test parity is required, set up node-gyp prerequisites and rebuild native bindings.

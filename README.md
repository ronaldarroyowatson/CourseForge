# CourseForge Tracer Bullet

CourseForge is a local-first curriculum authoring platform for teachers.
This repository now contains a tracer-bullet bootstrap that wires a CourseForge skeleton shell to an Otto-managed startup flow.

## What This Slice Proves

- A CourseForge package can bootstrap Otto in CourseForge mode.
- Otto can read the deployment payload and bootstrap config.
- Required Otto components can be materialized into a local runtime cache, verified, and marked ready.
- Otto can apply a bootstrap update cycle, simulate a restart when components are first installed, and hand readiness back to CourseForge.
- CourseForge can render a skeleton UI that reports Otto, CLI, API, and update status.

## Repository Structure

```text
README.md
SECURITY.md
copilot-instructions.md
deployment/
docs/
manifests/
src/
tests/
```

## Key Entry Points

- `src/main.ts` starts the tracer-bullet startup flow.
- `src/bootstrap/otto-bootstrap.ts` owns Otto bootstrap orchestration.
- `src/bootstrap/courseforge-bootstrap.ts` waits on Otto readiness, then launches the CourseForge skeleton UI.
- `src/ui/skeleton-ui.tsx` renders the minimal CourseForge status window.

## Scripts

- `npm run start` runs the bootstrap flow.
- `npm run build` type-checks and emits JavaScript.
- `npm test` runs the bootstrap tests.

## Notes

- Otto release URLs in `deployment/otto-payload.json` are tracer-bullet placeholders and are intended to be swapped to real Otto release endpoints once the shared Otto repos are available in this workspace.
- Runtime artifacts are written under `.courseforge-runtime/` and are ignored by git.
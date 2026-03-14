# Node Runtime And Dependency Risk Plan

## Current baseline

- Production Functions runtime target: Node `20`.
- Root workspace compatibility window: Node `>=20 <25`.
- Local pin files: `.nvmrc` and `.node-version` (value `20`).

## Why this split exists

- Firebase Functions deployment behavior must match the runtime in `functions/package.json`.
- Webapp and extension tooling can be validated on newer Node versions before backend runtime changes.
- This lowers risk by decoupling frontend tooling upgrades from server runtime upgrades.

## Guardrails now in repo

- Root check: `npm run check:node`
- Strict Functions check: `npm run check:node:functions`
- Node 24 canary check: `npm run check:node:next24`
- Functions build/serve/deploy scripts now require a successful strict runtime check first.

## Active implementation status

- Delegated exploration completed for runtime touchpoints and staged rollout risks.
- Stable release lane added: `npm run verify:stable`
- Newer-node canary lane added: `npm run verify:canary`
- Functions runtime bridge added for canary workstations:
  - `npm run functions:build:compat`
  - `npm run functions:serve:compat`
  - `npm run functions:deploy:compat`

This allows root-tooling validation on newer Node while keeping Functions execution on Node 20.

## Staged plan for newer Node (example: Node 24)

1. Canary phase (non-production)

- Run root checks on Node 24:
  - `npm run check:node:next24`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - `npm run check:installer`
- Keep Functions deploy/build on Node 20.

1. Compatibility phase

- Track upstream Firebase Functions support status for Node 24.
- Validate local emulator behavior and deploy behavior in a staging Firebase project.
- Compare logs for auth, callable functions, and Firestore access paths.

1. Promotion phase

- Update `functions/package.json` engines to Node 24 once officially supported and validated.
- Update `.nvmrc` and `.node-version` to 24.
- Re-run full E2E checks and package verification before release.

1. Rollback strategy

- Keep the previous Node 20 release artifacts available.
- If regressions appear, restore engine pins to Node 20 and re-run packaging pipeline.

## Dependency risk remediation plan (Functions)

Current audit status reported low-severity transitive advisories in the Functions dependency tree.

1. Short-term

- Keep `firebase-admin` and `firebase-functions` on current major versions.
- Re-run `npm audit --omit=dev` monthly and on every release candidate.

1. Mid-term

- Test newest minor/patch versions of `firebase-admin` and `firebase-functions` in staging.
- Prefer targeted upgrades over `npm audit fix --force` to avoid accidental major downgrades/upgrades.

1. Long-term

- Move to the newest Firebase SDK major versions once release notes confirm runtime compatibility.
- Re-baseline this plan after each runtime promotion (Node 20 -> 22 -> 24, etc.).

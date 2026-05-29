# CourseForge Cloud Bugfix Workflow

Use this sequence for every bug fix and regression patch.

1. Add or adjust failing tests first for the reported bug.
2. Run the smallest relevant test command and confirm the failure before editing source code.
3. Implement the source fix only after the failure is reproduced.
4. Re-run the targeted tests until they pass.
5. Run `npm run bugfix:test` before considering the bug fix complete.
6. If behavior changed, update the relevant docs under `docs/`.
7. Run remote installer matrix validation from this machine: `npm run orchestrate:installers:wait -- --description "<short bugfix summary>" --ref <branch-or-tag>`.
8. Use `npm run bugfix:release -- -Description "<short bugfix summary>"` for the patch release workflow after the quality gate passes.
9. Agents must refuse to implement a bug fix when steps 1-4 are skipped or cannot be demonstrated in logs/test output.

## Installer Matrix Requirement

- Treat GitHub Actions Windows/Linux installer validation as mandatory for bugfix releases.
- Keep macOS packaging/testing local on the release-authority laptop unless explicitly overridden.
- Use `scripts/dispatch-parallel-installer-build.mjs --wait` (or `npm run orchestrate:installers:wait`) for deterministic pass/fail output in agent logs.

## DSC And Debug Requirements

- Keep the existing CLI entry as `npm run program -- debug ...`.
- Preserve the DSC sub-flow: `debug dsc enable`, `debug dsc disable`, `debug dsc report`, `debug dsc clear`.
- When adding debug UI in the app, mirror the same capability in the CLI.
- Treat `#0c3183` as a bug in live token output unless an explicit legacy whitelist is present.

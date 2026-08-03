# MacBook Handoff: Otto + CourseForge Workspace

This handoff gives you a fast path to resume work on macOS with the same multi-repo layout used on Windows.

## 1) Clone and install on macOS

From a terminal on your laptop:

```bash
cd ~/dev
mkdir -p otto-workspace
cd otto-workspace

# Option A: one-step setup
bash CourseForge/docs/setup-macos-workspace.sh
```

If `CourseForge` is not cloned yet, run these first:

```bash
git clone https://github.com/ronaldarroyowatson/CourseForge.git
cd CourseForge
bash docs/setup-macos-workspace.sh
```

## 2) Open the exact workspace in VS Code

Open:

- `~/dev/otto-workspace/CourseForge/OTTO-COURSEFORGE.code-workspace`

This loads all repos as one multi-root workspace.

## 3) Recommended VS Code extensions

- GitHub Copilot (`GitHub.copilot`)
- GitHub Copilot Chat (`GitHub.copilot-chat`)
- GitHub Pull Requests and Issues (`GitHub.vscode-pull-request-github`)
- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- YAML (`redhat.vscode-yaml`)
- TypeScript and JavaScript Language Features (built-in)

## 4) Daily validation commands

Run from each repo when you touch code:

```bash
npm run typecheck
npm test
```

## 5) Note about the Git warning on Windows

The warning about "too many active changes" is typically caused by large generated artifact trees (for example `release/`).

Mitigations already applied in CourseForge:

- `release/` is ignored in `.gitignore`
- VS Code workspace settings now reduce watcher pressure for `release/`

If you still see the warning after opening the workspace:

1. Run `git status` in `CourseForge` and confirm clean state.
2. Reload the VS Code window (`Developer: Reload Window`).
3. If needed, delete local generated artifacts and rebuild only when packaging.

## 6) Where to continue

Start from:

- `CourseForge/copilot-instructions.md`
- `CourseForge/docs/NEXT-AGENT-HANDOFF-2026-08-02.md`

These provide the current integration guardrails and latest handoff context.

# CourseForge Setup Checklist

This checklist is the human-friendly companion to the setup automation scripts and VS Code tasks.

## Phase 0 - Open The Workspace

- Open the CourseForge repository root folder in VS Code.
- Confirm these scripts are present:
  - scripts/setup-courseforge.windows.ps1
  - scripts/setup-courseforge.macos.sh
  - scripts/setup-courseforge.linux.sh
  - scripts/verify-mcp-servers.mjs
  - scripts/print-vscode-extension-commands.mjs
- Open Run Task in VS Code and verify these task labels exist:
  - CourseForge: Setup (Windows)
  - CourseForge: Setup (macOS)
  - CourseForge: Setup (Linux)
  - CourseForge: Install Recommended VS Code Extensions
  - CourseForge: Verify MCP Servers

## Phase 1 - Run OS Setup Automation

Choose exactly one setup task for your OS:

- Windows: CourseForge: Setup (Windows)
- macOS: CourseForge: Setup (macOS)
- Linux: CourseForge: Setup (Linux)

Each setup script does the following in order:

- Verifies or installs core tools:
  - Node.js
  - Git
  - GitHub CLI
  - PowerShell 7
  - Java runtime
  - Browser (Chrome/Chromium/Edge depending on platform)
  - jq
- Verifies or installs firebase-tools globally.
- Runs dependency bootstrap:
  - npm install (root)
  - npm install (functions)
- Runs validation and quality gates:
  - npm run check:node
  - npm run check:node:functions
  - npm run typecheck:all
  - npm run test:index
  - npm run test:samples:validate
  - npm run bugfix:test
  - If cloud OCR providers are rate-limited or unavailable, setup retries and falls back to local quality gates so environment provisioning can complete.

## Phase 2 - Extension Commands (Print-Only)

- Run task: CourseForge: Install Recommended VS Code Extensions
- The task prints install commands only. It does not auto-install extensions.
- Copy/paste only the commands you want to run.

## Phase 3 - Verify MCP Servers

- Run task: CourseForge: Verify MCP Servers
- This checks each MCP server configured in .vscode/settings.json by attempting startup and reporting pass/fail.

## Phase 4 - Optional Verification-Only Re-Run

Use verification-only mode when you do not want installers or npm install steps to run.

- Windows:
  - pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/setup-courseforge.windows.ps1 -VerifyOnly
- macOS:
  - bash scripts/setup-courseforge.macos.sh --verify-only
- Linux:
  - bash scripts/setup-courseforge.linux.sh --verify-only

## Phase 5 - Troubleshooting

- If package installation fails due to permissions, rerun with an account that has required privileges.
- If a tool is installed but still reported missing, restart your terminal/VS Code and rerun setup.
- If MCP verification fails, inspect .vscode/settings.json mcpServers command/args entries and rerun:
  - node scripts/verify-mcp-servers.mjs

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const cwd = process.cwd();
const settingsPath = resolve(cwd, ".vscode/settings.json");

const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const servers = settings.mcpServers ?? {};
const entries = Object.entries(servers);

if (entries.length === 0) {
  console.error("No mcpServers configured in .vscode/settings.json");
  process.exit(1);
}

const startupRegex = /(running on stdio|server running|mcp terminal server running|secure mcp filesystem server running)/i;

function runServerCheck(name, config) {
  return new Promise((resolveResult) => {
    const command = config?.command;
    const args = Array.isArray(config?.args) ? config.args : [];

    if (!command || typeof command !== "string") {
      resolveResult({ name, ok: false, detail: "Missing command in configuration." });
      return;
    }

    const useShell = process.platform === "win32";
    // DEP0190: when shell=true, args must not be passed separately — join into one string
    const spawnCmd = useShell
      ? [command, ...args].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")
      : command;
    const spawnArgs = useShell ? [] : args;

    const child = spawn(spawnCmd, spawnArgs, {
      cwd,
      shell: useShell,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let completed = false;

    const finish = (result) => {
      if (completed) {
        return;
      }
      completed = true;

      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill("SIGKILL");
          }
        }, 500).unref();
      }

      resolveResult(result);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (startupRegex.test(stdout)) {
        finish({ name, ok: true, detail: "Startup message detected." });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish({ name, ok: false, detail: `Spawn error: ${error.message}` });
    });

    child.on("exit", (code) => {
      const output = `${stdout}\n${stderr}`.trim();
      if (completed) {
        return;
      }

      if (code === 0) {
        finish({ name, ok: true, detail: "Process exited with code 0." });
        return;
      }

      // If the server refused to start because the port is already in use,
      // that means a prior instance is running — treat as healthy.
      if (/port .* is already in use/i.test(output)) {
        finish({ name, ok: true, detail: "Server already running (port in use)." });
        return;
      }

      if (startupRegex.test(output)) {
        finish({ name, ok: true, detail: "Startup message detected before process exit." });
        return;
      }

      const excerpt = output.slice(0, 300) || `Exited with code ${code}`;
      finish({ name, ok: false, detail: excerpt });
    });

    setTimeout(() => {
      if (completed) {
        return;
      }

      if (child.exitCode === null) {
        finish({ name, ok: true, detail: "Process stayed alive beyond startup timeout." });
      }
    }, 7000).unref();
  });
}

console.log("Checking MCP servers from .vscode/settings.json");

const results = [];
for (const [name, config] of entries) {
  console.log(`- Checking ${name}...`);
  // eslint-disable-next-line no-await-in-loop
  const result = await runServerCheck(name, config);
  results.push(result);
  if (result.ok) {
    console.log(`  OK: ${result.detail}`);
  } else {
    console.log(`  FAIL: ${result.detail}`);
  }
}

const failed = results.filter((item) => !item.ok);
console.log("");
console.log(`MCP verification summary: ${results.length - failed.length}/${results.length} passed`);

if (failed.length > 0) {
  process.exit(1);
}

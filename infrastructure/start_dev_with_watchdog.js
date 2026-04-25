import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function spawnNodeScript(scriptPath, args, options = {}) {
  return spawn(process.execPath, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
    ...options,
  });
}

function yellow(text) {
  return `\x1b[33m${text}\x1b[0m`;
}

const watchdogScript = path.join(ROOT, "infrastructure", "mempalace_watchdog.js");
const preflightScript = path.join(ROOT, "infrastructure", "mem_palace", "preflight.js");
const viteScript = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");

function startRuntime() {
  const watcher = spawnNodeScript(watchdogScript, ["--watch", "--intervalMs", "3000"]);
  const vite = spawn(process.execPath, [viteScript, ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
  });

  const stopWatcher = () => {
    if (!watcher.killed) {
      watcher.kill("SIGTERM");
    }
  };

  process.on("SIGINT", () => {
    stopWatcher();
    if (!vite.killed) {
      vite.kill("SIGINT");
    }
  });

  process.on("SIGTERM", () => {
    stopWatcher();
    if (!vite.killed) {
      vite.kill("SIGTERM");
    }
  });

  vite.on("exit", (viteCode) => {
    stopWatcher();
    process.exit(viteCode ?? 0);
  });

  vite.on("error", (error) => {
    console.error("Failed to start Vite:", error);
    stopWatcher();
    process.exit(1);
  });
}

process.env.CF_DEV_MODE = "server";
const preflight = spawnNodeScript(preflightScript, []);

let started = false;
function startOnce() {
  if (started) {
    return;
  }
  started = true;
  startRuntime();
}

preflight.on("error", (error) => {
  console.warn(yellow("[CourseForge dev] MemPalace preflight errored in relaxed mode; continuing startup."));
  console.warn(yellow(String(error instanceof Error ? error.message : error)));
  startOnce();
});

preflight.on("exit", (code) => {
  if (code !== 0) {
    console.warn(yellow("[CourseForge dev] MemPalace preflight reported issues in relaxed mode; continuing startup."));
  }
  startOnce();
});

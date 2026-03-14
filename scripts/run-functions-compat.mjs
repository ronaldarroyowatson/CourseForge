#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const task = process.argv[2] ?? "build";
const extraArgs = process.argv.slice(3);
const nodeMajor = Number.parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
const isNode20 = Number.isFinite(nodeMajor) && nodeMajor === 20;

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const cwd = options.cwd ?? repoRoot;
    const isWindows = process.platform === "win32";

    const child = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", `${command} ${args.join(" ")}`], {
          cwd,
          stdio: "inherit",
          shell: false,
        })
      : spawn(command, args, {
          cwd,
          stdio: "inherit",
          shell: false,
        });

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function npmCommand() {
  return "npm";
}

function npxCommand() {
  return "npx";
}

async function runNativeTask() {
  const args = ["--prefix", "functions", "run", task];
  if (extraArgs.length > 0) {
    args.push("--", ...extraArgs);
  }

  console.log(`[functions-compat] Host Node is v${nodeMajor}. Running native task: npm ${args.join(" ")}`);
  return run(npmCommand(), args);
}

async function runNode20Fallback() {
  const bridgeMap = {
    build: ["functions/node_modules/typescript/bin/tsc", "-p", "functions/tsconfig.json"],
    serve: ["node_modules/firebase-tools/lib/bin/firebase.js", "emulators:start", "--only", "functions"],
    deploy: ["node_modules/firebase-tools/lib/bin/firebase.js", "deploy", "--only", "functions"],
  };

  if (!bridgeMap[task]) {
    console.error(`[functions-compat] Unsupported task '${task}'. Supported tasks: build, serve, deploy.`);
    return 1;
  }

  const args = ["-y", "node@20", ...bridgeMap[task], ...extraArgs];
  console.warn(`[functions-compat] Host Node is ${process.version}. Bridging '${task}' through Node 20 via npx.`);
  return run(npxCommand(), args);
}

const exitCode = isNode20 ? await runNativeTask() : await runNode20Fallback();
process.exit(exitCode);

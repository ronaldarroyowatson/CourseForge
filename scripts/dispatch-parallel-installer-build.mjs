#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function readOption(name, fallback = "") {
  const index = args.findIndex((value) => value === `--${name}`);
  if (index < 0) {
    return fallback;
  }

  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    return fallback;
  }

  return next;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const description = readOption("description", "Parallel installer artifact build");
const gitRef = readOption("ref", "main");
const buildMacos = !hasFlag("no-macos");
const buildWindows = !hasFlag("no-windows");

if (!buildMacos && !buildWindows) {
  console.error("At least one platform build must be enabled.");
  process.exit(1);
}

const ghCheck = spawnSync("gh", ["--version"], { stdio: "ignore" });
if (ghCheck.status !== 0) {
  console.error("GitHub CLI (gh) is required. Install gh and run gh auth login.");
  process.exit(1);
}

const workflowArgs = [
  "workflow",
  "run",
  "parallel-installer-build.yml",
  "-f",
  `releaseDescription=${description}`,
  "-f",
  `gitRef=${gitRef}`,
  "-f",
  `buildMacos=${String(buildMacos)}`,
  "-f",
  `buildWindows=${String(buildWindows)}`,
];

const runResult = spawnSync("gh", workflowArgs, { stdio: "inherit" });
if (runResult.status !== 0) {
  process.exit(runResult.status ?? 1);
}

console.log("Workflow dispatched successfully.");
console.log("Use: gh run list --workflow parallel-installer-build.yml");
console.log("Then: gh run view <run-id> --log");

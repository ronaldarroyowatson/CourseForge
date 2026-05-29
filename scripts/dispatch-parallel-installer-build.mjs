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
const buildMacos = hasFlag("with-macos") && !hasFlag("no-macos");
const buildWindows = !hasFlag("no-windows");
const buildLinux = !hasFlag("no-linux");
const waitForCompletion = hasFlag("wait");

if (!buildMacos && !buildWindows && !buildLinux) {
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
  "-f",
  `buildLinux=${String(buildLinux)}`,
];

const runResult = spawnSync("gh", workflowArgs, { stdio: "inherit" });
if (runResult.status !== 0) {
  process.exit(runResult.status ?? 1);
}

console.log("Workflow dispatched successfully.");
console.log("Use: gh run list --workflow parallel-installer-build.yml");
console.log("Then: gh run view <run-id> --log");
console.log("Defaults: Windows + Linux enabled, macOS disabled (pass --with-macos to include macOS).\n");

if (waitForCompletion) {
  const runIdResult = spawnSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      "parallel-installer-build.yml",
      "--limit",
      "1",
      "--json",
      "databaseId",
      "--jq",
      ".[0].databaseId",
    ],
    { encoding: "utf8" },
  );

  if (runIdResult.status !== 0) {
    console.error("Failed to resolve workflow run id for --wait mode.");
    process.exit(runIdResult.status ?? 1);
  }

  const runId = (runIdResult.stdout || "").trim();
  if (!runId) {
    console.error("No workflow run id was returned for --wait mode.");
    process.exit(1);
  }

  console.log(`Waiting for run ${runId} to complete...`);
  const watchResult = spawnSync("gh", ["run", "watch", runId, "--exit-status"], { stdio: "inherit" });
  if (watchResult.status !== 0) {
    process.exit(watchResult.status ?? 1);
  }
}

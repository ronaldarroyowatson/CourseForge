#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";

function runCommand(command) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function loadPrevious(pathname) {
  if (!existsSync(pathname)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return null;
  }
}

const repoRoot = process.cwd();
const mempalaceDir = path.join(repoRoot, ".mempalace");
mkdirSync(mempalaceDir, { recursive: true });

const statusPath = path.join(mempalaceDir, "startup-change-check.json");
const historyPath = path.join(mempalaceDir, "startup-change-check.log.jsonl");

const branch = runCommand("git rev-parse --abbrev-ref HEAD") || "unknown";
const head = runCommand("git rev-parse HEAD") || "unknown";
const statusOutput = runCommand("git status --porcelain=v1");
const changedFiles = statusOutput
  ? statusOutput
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
  : [];

const fingerprint = createHash("sha256")
  .update([head, ...changedFiles].join("|"), "utf8")
  .digest("hex");

const previous = loadPrevious(statusPath);
const changedSinceLastBoot = !previous || previous.fingerprint !== fingerprint;

const report = {
  checkedAt: new Date().toISOString(),
  branch,
  head,
  dirty: changedFiles.length > 0,
  changedFileCount: changedFiles.length,
  changedFilesSample: changedFiles.slice(0, 20),
  fingerprint,
  changedSinceLastBoot,
  previousFingerprint: previous?.fingerprint ?? null,
};

writeFileSync(statusPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
appendFileSync(historyPath, `${JSON.stringify(report)}\n`, "utf8");

if (changedSinceLastBoot) {
  console.log(`[MemPalace startup] Repository fingerprint changed on boot (dirty=${report.dirty}, files=${report.changedFileCount}).`);
} else {
  console.log("[MemPalace startup] Repository fingerprint unchanged since last boot.");
}

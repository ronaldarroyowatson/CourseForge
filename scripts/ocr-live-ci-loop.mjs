#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function readOption(name, fallback = "") {
  const key = `--${name}`;
  const direct = args.find((arg) => arg.startsWith(`${key}=`));
  if (direct) {
    return direct.slice(key.length + 1);
  }

  const index = args.findIndex((arg) => arg === key);
  if (index < 0 || index + 1 >= args.length) {
    return fallback;
  }

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return fallback;
  }

  return value;
}

function run(command, commandArgs, options = {}) {
  const startedAt = Date.now();
  const capture = Boolean(options.capture);
  const shell = Boolean(options.shell);

  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: capture ? "pipe" : "inherit",
    shell,
    encoding: capture ? "utf8" : undefined,
  });

  const durationMs = Date.now() - startedAt;
  return {
    status: result.status ?? 1,
    signal: result.signal ?? null,
    durationMs,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function currentIsoStamp() {
  const date = new Date();
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function trimText(value, max = 6000) {
  if (!value) {
    return "";
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n...[truncated]`;
}

function readJsonFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getGitRef(defaultRef) {
  if (defaultRef) {
    return defaultRef;
  }

  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  if (branch.status === 0) {
    const resolved = branch.stdout.trim();
    if (resolved) {
      return resolved;
    }
  }

  return "main";
}

function resolveLatestInstallerRun() {
  const idResult = run(
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
    { capture: true },
  );

  if (idResult.status !== 0) {
    return null;
  }

  const runId = idResult.stdout.trim();
  if (!runId) {
    return null;
  }

  const metaResult = run(
    "gh",
    [
      "run",
      "view",
      runId,
      "--json",
      "databaseId,status,conclusion,url,displayTitle,headBranch,headSha,createdAt,updatedAt",
    ],
    { capture: true },
  );

  if (metaResult.status !== 0) {
    return { databaseId: runId };
  }

  try {
    return JSON.parse(metaResult.stdout);
  } catch {
    return { databaseId: runId };
  }
}

const description = readOption("description", "OCR/Text pipeline live CI loop");
const gitRef = getGitRef(readOption("ref", ""));
const skipCloudSmoke = hasFlag("skip-cloud-smoke");
const skipRemote = hasFlag("skip-remote");
const skipLocalLive = hasFlag("skip-local-live");
const reuseMacArtifact = hasFlag("reuse-mac-artifact");
const includeRemoteMacos = hasFlag("with-remote-macos");
const liveImageFile = readOption("live-image-file", "");
const goldTranscriptFile = readOption("gold-transcript-file", "");
const liveOcrReportPath = readOption("live-ocr-report", "");

const reportDir = path.join(process.cwd(), "tmp-smoke", "live-ci-loop");
ensureDirectory(reportDir);
const reportPath = path.join(reportDir, `ocr-live-ci-loop-${currentIsoStamp()}.json`);

const report = {
  generatedAtUtc: new Date().toISOString(),
  description,
  gitRef,
  options: {
    skipCloudSmoke,
    skipRemote,
    skipLocalLive,
    reuseMacArtifact,
    includeRemoteMacos,
    liveImageFile,
    goldTranscriptFile,
    liveOcrReportPath,
  },
  steps: [],
  artifacts: {
    remoteInstallerRun: null,
    localMacInstallerSmokeReport: null,
    localMacInstallerSmokeSummary: null,
    liveOcrReport: null,
  },
  overallStatus: "passed",
};

function executeStep(stepName, command, commandArgs, options = {}) {
  console.log(`\n=== ${stepName} ===`);
  const result = run(command, commandArgs, options);
  const status = result.status === 0 ? "passed" : "failed";
  report.steps.push({
    name: stepName,
    status,
    command: [command, ...commandArgs].join(" "),
    durationMs: result.durationMs,
    exitCode: result.status,
    signal: result.signal,
    stderr: trimText(result.stderr),
    stdout: options.capture ? trimText(result.stdout) : "",
  });

  if (status === "failed") {
    report.overallStatus = "failed";
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.error(`\nStep failed: ${stepName}`);
    console.error(`Report written: ${reportPath}`);
    process.exit(result.status || 1);
  }

  return result;
}

executeStep("OCR integration regression", "npx", ["vitest", "run", "tests/integration/autoTextbookFlow.integration.test.tsx"]);
executeStep("OCR parser regression", "npx", ["vitest", "run", "tests/core/textbookAutoExtractionService.test.ts"]);

if (!skipCloudSmoke) {
  executeStep("Cloud OCR smoke gate", "npm", ["run", "test:smoke:ocr:cloud:gate"]);
}

if (!skipRemote) {
  const remoteArgs = [
    "run",
    "orchestrate:installers:wait",
    "--",
    "--description",
    description,
    "--ref",
    gitRef,
  ];
  if (includeRemoteMacos) {
    remoteArgs.push("--with-macos");
  }
  executeStep("Remote installer matrix (GitHub Actions)", "npm", remoteArgs);
  report.artifacts.remoteInstallerRun = resolveLatestInstallerRun();
}

if (!skipLocalLive) {
  const smokeArgs = ["scripts/installer/run-macos-packaged-installer-smoke.sh"];
  if (reuseMacArtifact) {
    smokeArgs.push("--skip-build");
  }

  const localSmoke = executeStep("Local macOS packaged installer live smoke", "bash", smokeArgs, { capture: true });
  process.stdout.write(localSmoke.stdout);
  process.stderr.write(localSmoke.stderr);

  const workDirMatch = localSmoke.stdout.match(/workDir=([^\n\r]+)/);
  const localSmokeReportPath = workDirMatch
    ? path.join(workDirMatch[1].trim(), "results.json")
    : "";

  const localSmokeReport = readJsonFileIfExists(localSmokeReportPath);
  report.artifacts.localMacInstallerSmokeReport = localSmokeReportPath || null;
  report.artifacts.localMacInstallerSmokeSummary = localSmokeReport?.summary ?? null;
}

if (liveImageFile) {
  const liveReport = liveOcrReportPath || path.join(reportDir, `ocr-live-tab-${currentIsoStamp()}.json`);
  const ocrArgs = [
    "run",
    "debug:ocr:live",
    "--",
    "--image-file",
    liveImageFile,
    "--output",
    liveReport,
  ];

  if (goldTranscriptFile) {
    ocrArgs.push("--gold-transcript-file", goldTranscriptFile);
  }

  executeStep("Live tab OCR debug report", "npm", ocrArgs, { capture: true });
  report.artifacts.liveOcrReport = liveReport;
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log("\n=== OCR live CI loop completed ===");
console.log(`Status: ${report.overallStatus}`);
console.log(`Report: ${reportPath}`);
if (report.artifacts.remoteInstallerRun?.url) {
  console.log(`Remote run: ${report.artifacts.remoteInstallerRun.url}`);
}

process.exit(report.overallStatus === "passed" ? 0 : 1);

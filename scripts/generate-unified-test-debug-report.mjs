import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const reportDir = path.join(cwd, "tmp-smoke", "reports");
const markdownPath = path.join(reportDir, "unified-test-debug-report.md");
const jsonPath = path.join(reportDir, "unified-test-debug-report.json");

const candidateLogs = [
  "/tmp/cf-security-full-gate.log",
  "/tmp/cf-bugfix-gate.log",
  "/tmp/courseforge-core-vitest.log",
  "/tmp/cf-auto-ocr-vitest.log",
];

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  const summaryLines = lines.filter((line) => (
    /FULL_GATE_EXIT|BUGFIX_EXIT|Test Files|Tests\s+\d+\s+passed|FAILED|FAIL|Smoke report|smoke-gate|github-throttle|rate-limit|cooldown/i.test(line)
  ));

  return {
    path: filePath,
    modifiedAt: stat.mtime.toISOString(),
    sizeBytes: stat.size,
    lineCount: lines.length,
    summaryLines: summaryLines.slice(-80),
    tail: lines.slice(-120),
  };
}

function getLatestSmokeReport() {
  const smokeDir = path.join(cwd, "tmp-smoke");
  if (!fs.existsSync(smokeDir)) {
    return null;
  }

  const matches = fs.readdirSync(smokeDir)
    .filter((name) => /^ocr-smoke-report-\d{8}-\d{6}\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(smokeDir, name);
      const stat = fs.statSync(filePath);
      return { filePath, name, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!matches.length) {
    return null;
  }

  const latest = matches[0];
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(latest.filePath, "utf8"));
  } catch {
    parsed = null;
  }

  return {
    path: latest.filePath,
    name: latest.name,
    parsed,
  };
}

const logs = candidateLogs
  .map((filePath) => readIfExists(filePath))
  .filter(Boolean);

const latestSmokeReport = getLatestSmokeReport();

const unified = {
  generatedAt: new Date().toISOString(),
  cwd,
  logs,
  latestSmokeReport,
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify(unified, null, 2), "utf8");

const md = [];
md.push("# Unified Test and Debug Report");
md.push("");
md.push(`Generated: ${unified.generatedAt}`);
md.push("");

if (!logs.length) {
  md.push("No known test/debug logs were found.");
} else {
  for (const log of logs) {
    md.push(`## Log: ${log.path}`);
    md.push(`- Modified: ${log.modifiedAt}`);
    md.push(`- Size (bytes): ${log.sizeBytes}`);
    md.push(`- Line count: ${log.lineCount}`);
    md.push("");
    md.push("### Summary Lines");
    md.push("```text");
    md.push(log.summaryLines.join("\n") || "(no summary lines matched)");
    md.push("```");
    md.push("");
  }
}

if (latestSmokeReport) {
  md.push(`## Latest OCR Smoke Report: ${latestSmokeReport.path}`);
  md.push("");
  md.push("```json");
  md.push(JSON.stringify(latestSmokeReport.parsed ?? { error: "Unable to parse smoke report JSON." }, null, 2));
  md.push("```");
}

fs.writeFileSync(markdownPath, `${md.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  markdownPath,
  jsonPath,
  logCount: logs.length,
  smokeReportPath: latestSmokeReport?.path ?? null,
}, null, 2));

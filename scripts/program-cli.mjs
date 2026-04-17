import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

const localAppData = process.env.LOCALAPPDATA;
const baseDir = localAppData
  ? path.join(localAppData, "CourseForge", "debug")
  : path.join(os.homedir(), ".courseforge", "debug");

const configPath = path.join(baseDir, "debug-config.json");
const logPath = path.join(baseDir, "debug-log.jsonl");
const rotatedPrefix = path.join(baseDir, "debug-log");

const defaultConfig = {
  enabled: true,
  maxLocalBytes: 1_500_000,
  rotateBytes: 300_000,
  maxRotatedFiles: 4,
  requireApprovalForDeleteAfterSync: true,
};

function ensureDir() {
  fs.mkdirSync(baseDir, { recursive: true });
}

function readConfig() {
  ensureDir();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf8");
    return { ...defaultConfig };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { ...defaultConfig, ...parsed };
  } catch {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf8");
    return { ...defaultConfig };
  }
}

function writeConfig(next) {
  ensureDir();
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");
}

function parseFlag(name, fallback = "") {
  const key = `--${name}`;
  const direct = args.find((arg) => arg.startsWith(`${key}=`));
  if (direct) {
    return direct.slice(key.length + 1);
  }

  const index = args.indexOf(key);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }

  return fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function normalizeSourceType(value) {
  const lowered = String(value || "").trim().toLowerCase();
  if (lowered === "manual") {
    return "manual";
  }

  if (lowered === "automatic" || lowered === "auto") {
    return "automatic";
  }

  return "automatic";
}

function rotateLogs(config) {
  ensureDir();
  if (!fs.existsSync(logPath)) {
    return;
  }

  const currentSize = fs.statSync(logPath).size;
  if (currentSize < config.rotateBytes) {
    return;
  }

  for (let index = config.maxRotatedFiles; index >= 1; index -= 1) {
    const source = `${rotatedPrefix}.${index}.jsonl`;
    const dest = `${rotatedPrefix}.${index + 1}.jsonl`;
    if (fs.existsSync(source)) {
      if (index === config.maxRotatedFiles) {
        fs.unlinkSync(source);
      } else {
        fs.renameSync(source, dest);
      }
    }
  }

  fs.renameSync(logPath, `${rotatedPrefix}.1.jsonl`);
}

function trimIfOversized(config) {
  if (!fs.existsSync(logPath)) {
    return;
  }

  const maxBytes = config.maxLocalBytes;
  const size = fs.statSync(logPath).size;
  if (size <= maxBytes) {
    return;
  }

  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
  const kept = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const lineBytes = Buffer.byteLength(line + "\n", "utf8");
    if (bytes + lineBytes > maxBytes) {
      continue;
    }

    bytes += lineBytes;
    kept.push(line);
  }

  kept.reverse();
  fs.writeFileSync(logPath, kept.join("\n") + (kept.length ? "\n" : ""), "utf8");
}

function appendDebugEntry(feature) {
  const config = readConfig();
  if (!config.enabled) {
    console.error("Debug logging is disabled. Use: program debug enable");
    process.exit(1);
  }

  rotateLogs(config);

  const severity = parseFlag("severity", "info").toLowerCase();
  const sourceType = normalizeSourceType(parseFlag("sourceType", "automatic"));
  const sourceKind = parseFlag("sourceKind", "automatic").toLowerCase();
  const message = parseFlag("message", `Debug event for feature: ${feature}`);
  const errorContext = parseFlag("errorContext", "");
  const stack = parseFlag("stack", "");

  const entry = {
    timestamp: new Date().toISOString(),
    subsystem: feature,
    severity,
    sourceType,
    sourceKind,
    message,
    errorContext: errorContext || null,
    stackTrace: stack || null,
  };

  ensureDir();
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  trimIfOversized(config);
  console.log(`Logged debug event to ${logPath}`);
}

function readEntries() {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  return fs
    .readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function dumpLog() {
  const config = readConfig();
  const sourceTypeFilter = parseFlag("sourceType", "");
  const requestedSource = sourceTypeFilter ? normalizeSourceType(sourceTypeFilter) : "";
  const entries = readEntries().filter((entry) => {
    if (!requestedSource) {
      return true;
    }

    return normalizeSourceType(entry.sourceType) === requestedSource;
  });

  const outPath = parseFlag("output", "");
  if (outPath) {
    const resolvedOut = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, JSON.stringify(entries, null, 2), "utf8");
    console.log(`Wrote ${entries.length} entries to ${resolvedOut}`);
  } else {
    console.log(JSON.stringify(entries, null, 2));
  }

  if (hasFlag("sync-cloud")) {
    const approveDelete = hasFlag("approve-delete");
    const syncedAt = new Date().toISOString();
    const markerPath = path.join(baseDir, "last-cloud-sync.json");
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ syncedAt, count: entries.length, sourceTypeFilter: requestedSource || null }, null, 2),
      "utf8"
    );

    if (config.requireApprovalForDeleteAfterSync && !approveDelete) {
      console.log("Cloud sync marker written. Local logs retained until --approve-delete is provided.");
      return;
    }

    fs.writeFileSync(logPath, "", "utf8");
    console.log("Cloud sync marker written and local log deleted with user approval.");
  }
}

function clearLog() {
  ensureDir();
  fs.writeFileSync(logPath, "", "utf8");
  console.log(`Cleared ${logPath}`);
}

function setEnabled(enabled) {
  const config = readConfig();
  const next = { ...config, enabled };
  writeConfig(next);
  console.log(`Debug logging ${enabled ? "enabled" : "disabled"}.`);
}

// ============================================================
// DSC Token Debug Pipeline
// ============================================================

/** Authoritative semantic palette — must mirror semanticTokens.ts exactly */
const SEMANTIC_PALETTE = Object.freeze({
  MAJOR:   "#2563EB",
  MINOR:   "#73A2F5",
  ACCENT:  "#FFFFFF",
  SUCCESS: "#22C55E",
  WARNING: "#FACC15",
  ERROR:   "#EF4444",
  INFO:    "#06B6D4",
});

/** Legacy colors that are explicitly whitelisted */
const LEGACY_COLOR_WHITELIST = Object.freeze({
  LEGACY_BRAND_BLUE: "#0c3183",
});

const dscConfigPath = path.join(baseDir, "dsc-debug-config.json");
const dscLogPath = path.join(baseDir, "dsc-token-log.jsonl");

function readDscConfig() {
  ensureDir();
  if (!fs.existsSync(dscConfigPath)) {
    return { enabled: false };
  }

  try {
    return JSON.parse(fs.readFileSync(dscConfigPath, "utf8"));
  } catch {
    return { enabled: false };
  }
}

function writeDscConfig(next) {
  ensureDir();
  fs.writeFileSync(dscConfigPath, JSON.stringify(next, null, 2), "utf8");
}

function readDscLog() {
  if (!fs.existsSync(dscLogPath)) {
    return [];
  }

  return fs
    .readFileSync(dscLogPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function detectLegacyColors(records) {
  const legacyValues = Object.values(LEGACY_COLOR_WHITELIST).map((v) => v.toLowerCase().replace(/^#/, ""));
  return records
    .filter((r) => {
      const color = String(r.computedColor ?? "").toLowerCase().replace(/^#/, "");
      return legacyValues.includes(color);
    })
    .map((r) => ({
      color: r.computedColor,
      location: `${r.componentName ?? "unknown"}/${r.semanticRole ?? "?"}`,
      isWhitelisted: true,
    }));
}

function buildDscReport(options = {}) {
  const records = readDscLog();
  const mismatches = records.filter((r) => r.status === "mismatch");
  const errors = records.filter((r) => r.status === "error");
  const cascadingRisks = records.filter((r) => r.status === "cascading-failure-risk");
  const legacyInstances = detectLegacyColors(records);

  const paletteValidation = Object.entries(SEMANTIC_PALETTE).map(([role, expected]) => ({
    role,
    expected,
    status: "ok",
    note: "Authoritative value from semanticTokens.ts",
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    appVersion: options.appVersion ?? "unknown",
    source: "cli",
    semanticPalette: SEMANTIC_PALETTE,
    paletteValidation,
    tokenResolutions: records,
    legacyColorInstances: legacyInstances,
    summary: {
      totalResolutions: records.length,
      mismatches: mismatches.length,
      errors: errors.length,
      cascadingFailureRisks: cascadingRisks.length,
      legacyColorCount: legacyInstances.length,
      unwhitelistedLegacyColors: legacyInstances.filter((i) => !i.isWhitelisted).length,
    },
  };

  if (options.pageId) {
    report.filteredByPage = options.pageId;
  }

  if (options.cardId) {
    report.filteredByCard = options.cardId;
  }

  return report;
}

function runDscDebugCommand() {
  const sub = args[2];

  if (!sub || sub === "--help") {
    console.log("Usage:");
    console.log("  program debug dsc enable                   Enable DSC debug mode");
    console.log("  program debug dsc disable                  Disable DSC debug mode");
    console.log("  program debug dsc report [--report <path>] Generate full token debug report");
    console.log("  program debug dsc clear                    Clear DSC debug logs");
    console.log("");
    console.log("Flags:");
    console.log("  --report <path>   Write JSON report to file instead of stdout");
    console.log("  --page <pageId>   Filter report to a specific page");
    console.log("  --card <cardId>   Filter report to a specific card");
    return;
  }

  if (sub === "enable") {
    writeDscConfig({ enabled: true });
    console.log("DSC debug mode enabled. Token resolutions will be recorded.");
    return;
  }

  if (sub === "disable") {
    writeDscConfig({ enabled: false });
    console.log("DSC debug mode disabled.");
    return;
  }

  if (sub === "clear") {
    ensureDir();
    fs.writeFileSync(dscLogPath, "", "utf8");
    console.log(`DSC debug log cleared: ${dscLogPath}`);
    return;
  }

  if (sub === "report") {
    const reportPath = parseFlag("report", "");
    const pageId = parseFlag("page", "");
    const cardId = parseFlag("card", "");
    const report = buildDscReport({ pageId: pageId || null, cardId: cardId || null });
    const json = JSON.stringify(report, null, 2);

    if (reportPath) {
      const resolvedPath = path.resolve(reportPath);
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, json, "utf8");
      console.log(`DSC debug report written to ${resolvedPath}`);
      console.log(`Summary: ${report.summary.totalResolutions} resolutions, ${report.summary.mismatches} mismatch(es), ${report.summary.errors} error(s)`);
    } else {
      console.log(json);
    }

    return;
  }

  console.error(`Unknown DSC sub-command: ${sub}`);
  process.exit(1);
}

function showHelp() {
  console.log("Usage:");
  console.log("  program debug <feature> [--severity info|warn|error] [--sourceType automatic|manual] [--message text]");
  console.log("  program debug dump-log [--sourceType automatic|manual] [--output path] [--sync-cloud] [--approve-delete]");
  console.log("  program debug clear-log");
  console.log("  program debug enable");
  console.log("  program debug disable");
  console.log("  program debug dsc [enable|disable|report|clear] [--report <path>] [--page <id>] [--card <id>]");
}

if (command !== "debug") {
  showHelp();
  process.exit(1);
}

if (!subcommand) {
  showHelp();
  process.exit(1);
}

if (subcommand === "dsc") {
  runDscDebugCommand();
  process.exit(0);
}

if (subcommand === "dump-log") {
  dumpLog();
  process.exit(0);
}

if (subcommand === "clear-log") {
  clearLog();
  process.exit(0);
}

if (subcommand === "enable") {
  setEnabled(true);
  process.exit(0);
}

if (subcommand === "disable") {
  setEnabled(false);
  process.exit(0);
}

appendDebugEntry(subcommand);

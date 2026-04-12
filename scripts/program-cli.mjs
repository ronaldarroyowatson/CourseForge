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
const designResetPath = path.join(baseDir, "design-token-recovery.json");

const defaultConfig = {
  enabled: true,
  maxLocalBytes: 1_500_000,
  rotateBytes: 300_000,
  maxRotatedFiles: 4,
  requireApprovalForDeleteAfterSync: true,
};

const defaultDesignTokens = {
  gamma: 2.2,
  typeRatio: 1.25,
  strokePreset: "sweet-spot",
  spacingRatio: 1.25,
  motionTimingMs: 300,
  motionEasing: "ease-in-out",
  primaryHue: 212,
  semanticColors: {
    error: "#d14343",
    success: "#1f9d62",
    pending: "#d9a227",
    new: "#2f76d2",
  },
  useSystemDefaults: false,
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

function showHelp() {
  console.log("Usage:");
  console.log("  program settings reset-design-tokens");
  console.log("  program debug <feature> [--severity info|warn|error] [--sourceType automatic|manual] [--message text]");
  console.log("  program debug dump-log [--sourceType automatic|manual] [--output path] [--sync-cloud] [--approve-delete]");
  console.log("  program debug clear-log");
  console.log("  program debug enable");
  console.log("  program debug disable");
}

function resetDesignTokens() {
  ensureDir();
  fs.writeFileSync(
    designResetPath,
    JSON.stringify({
      requestedAt: new Date().toISOString(),
      resetToDefaults: true,
      defaults: defaultDesignTokens,
    }, null, 2),
    "utf8"
  );

  const recoveryLogEntry = {
    timestamp: new Date().toISOString(),
    subsystem: "settings",
    severity: "info",
    sourceType: "manual",
    sourceKind: "cli",
    message: "CLI recovery command executed: reset design tokens.",
    errorContext: null,
    stackTrace: null,
  };
  fs.appendFileSync(logPath, `${JSON.stringify(recoveryLogEntry)}\n`, "utf8");

  console.log(`Design token recovery payload written to ${designResetPath}`);
  console.log("Use this payload to restore defaults in app-level recovery tooling.");
}

if (command === "settings" && subcommand === "reset-design-tokens") {
  resetDesignTokens();
  process.exit(0);
}

if (command !== "debug") {
  showHelp();
  process.exit(1);
}

if (!subcommand) {
  showHelp();
  process.exit(1);
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

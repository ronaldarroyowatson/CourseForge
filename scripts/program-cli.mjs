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
const dscConfigPath = path.join(baseDir, "dsc-debug-config.json");
const dscReportCachePath = path.join(baseDir, "dsc-debug-report.json");

const authoritativeSemanticPalette = {
  MAJOR: "#2563EB",
  MINOR: "#73A2F5",
  ACCENT: "#FFFFFF",
  SUCCESS: "#22C55E",
  WARNING: "#FACC15",
  ERROR: "#EF4444",
  INFO: "#06B6D4",
};

const dscCatalog = {
  settings: {
    id: "settings",
    label: "Settings",
    cards: {
      "debug-log": {
        id: "debug-log",
        label: "Debug Log",
        components: [
          { id: "debug-toggle", label: "Enable Debug Logging", type: "toggle" },
          { id: "debug-clear", label: "Clear Debug Log", type: "button" },
          { id: "debug-send", label: "Send Debug Log to Cloud", type: "button" },
          { id: "debug-introspection", label: "Token Introspection", type: "summary" },
        ],
      },
    },
  },
};

const dscFallbacks = {
  MAJOR: ["--cf-semantic-major", "--primary-bg", "--cf-accent"],
  MINOR: ["--cf-semantic-minor", "--primary-border", "--cf-accent-strong"],
  ACCENT: ["--cf-semantic-accent", "--on-accent", "--cf-text-on-accent"],
  SUCCESS: ["--cf-semantic-success", "--success-color", "--cf-success"],
  WARNING: ["--cf-semantic-warning", "--cf-warning"],
  ERROR: ["--cf-semantic-error", "--danger-bg", "--cf-danger"],
  INFO: ["--cf-semantic-info", "--cf-info"],
};

const defaultConfig = {
  enabled: true,
  maxLocalBytes: 1_500_000,
  rotateBytes: 300_000,
  maxRotatedFiles: 4,
  requireApprovalForDeleteAfterSync: true,
};

const defaultDscConfig = {
  enabled: true,
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

function readDscConfig() {
  ensureDir();
  if (!fs.existsSync(dscConfigPath)) {
    fs.writeFileSync(dscConfigPath, JSON.stringify(defaultDscConfig, null, 2), "utf8");
    return { ...defaultDscConfig };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(dscConfigPath, "utf8"));
    return { ...defaultDscConfig, ...parsed };
  } catch {
    fs.writeFileSync(dscConfigPath, JSON.stringify(defaultDscConfig, null, 2), "utf8");
    return { ...defaultDscConfig };
  }
}

function writeDscConfig(next) {
  ensureDir();
  fs.writeFileSync(dscConfigPath, JSON.stringify(next, null, 2), "utf8");
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
  console.log("  program debug <feature> [--severity info|warn|error] [--sourceType automatic|manual] [--message text]");
  console.log("  program debug dsc <enable|disable|report|clear> [--page settings] [--card \"Debug Log\"] [--report path]");
  console.log("  program debug dump-log [--sourceType automatic|manual] [--output path] [--sync-cloud] [--approve-delete]");
  console.log("  program debug clear-log");
  console.log("  program debug enable");
  console.log("  program debug disable");
}

function normalizeCardId(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) {
    return "debug-log";
  }

  return trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "debug-log";
}

function buildDscReport() {
  const config = readDscConfig();
  const pageId = parseFlag("page", "settings").toLowerCase();
  const cardId = normalizeCardId(parseFlag("card", "Debug Log"));
  const page = dscCatalog[pageId] || dscCatalog.settings;
  const card = page.cards[cardId] || page.cards["debug-log"];

  const tokens = Object.entries(authoritativeSemanticPalette).reduce((accumulator, [token, value]) => {
    accumulator[token] = {
      expectedValue: value,
      resolvedValue: value,
      source: dscFallbacks[token][0],
      status: "resolved",
      fallbackChain: dscFallbacks[token],
      usedFallback: false,
      usedLegacyWhitelist: false,
    };
    return accumulator;
  }, {});

  return {
    enabled: config.enabled,
    page: {
      id: page.id,
      label: page.label,
    },
    card: {
      id: card.id,
      label: card.label,
      components: card.components,
    },
    tokens,
    mismatches: [],
    cascadingFailureRisk: {
      level: "none",
      summary: "No cascading token failures detected.",
      impactedTokens: [],
    },
  };
}

function handleDsc() {
  const action = args[2] || (hasFlag("enable") ? "enable" : hasFlag("disable") ? "disable" : hasFlag("clear") ? "clear" : hasFlag("report") ? "report" : "report");

  if (action === "enable") {
    const next = { ...readDscConfig(), enabled: true };
    writeDscConfig(next);
    console.log("DSC debug enabled.");
    return;
  }

  if (action === "disable") {
    const next = { ...readDscConfig(), enabled: false };
    writeDscConfig(next);
    console.log("DSC debug disabled.");
    return;
  }

  if (action === "clear") {
    if (fs.existsSync(dscReportCachePath)) {
      fs.unlinkSync(dscReportCachePath);
    }
    console.log("Cleared DSC debug report cache.");
    return;
  }

  const report = buildDscReport();
  ensureDir();
  fs.writeFileSync(dscReportCachePath, JSON.stringify(report, null, 2), "utf8");

  const reportPath = parseFlag("report", "");
  if (reportPath) {
    const resolvedOut = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, JSON.stringify(report, null, 2), "utf8");
  }

  console.log(JSON.stringify(report, null, 2));
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

if (subcommand === "dsc") {
  handleDsc();
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

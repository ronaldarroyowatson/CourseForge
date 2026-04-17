import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "courseforge" ? rawArgs.slice(1) : rawArgs;
const command = args[0];
const subcommand = args[1];

const LOCKED_SEMANTIC_PALETTE = {
  major: "#2563EB",
  minor: "#73A2F5",
  accent: "#FFFFFF",
  success: "#22C55E",
  warning: "#FACC15",
  error: "#EF4444",
  info: "#06B6D4",
};

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
  primaryHue: 221.2,
  semanticColors: {
    major: LOCKED_SEMANTIC_PALETTE.major,
    minor: LOCKED_SEMANTIC_PALETTE.minor,
    accent: LOCKED_SEMANTIC_PALETTE.accent,
    error: LOCKED_SEMANTIC_PALETTE.error,
    success: LOCKED_SEMANTIC_PALETTE.success,
    warning: LOCKED_SEMANTIC_PALETTE.warning,
    info: LOCKED_SEMANTIC_PALETTE.info,
    pending: LOCKED_SEMANTIC_PALETTE.warning,
    new: LOCKED_SEMANTIC_PALETTE.info,
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

function toContrastRatio(foreground, background) {
  const parse = (hex) => {
    const match = String(hex || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) {
      return null;
    }

    const full = match[1];
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
    };
  };

  const toLinear = (value) => {
    const normalized = value / 255;
    if (normalized <= 0.03928) {
      return normalized / 12.92;
    }
    return ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const toLuminance = (hex) => {
    const rgb = parse(hex);
    if (!rgb) {
      return 0;
    }

    return (0.2126 * toLinear(rgb.r)) + (0.7152 * toLinear(rgb.g)) + (0.0722 * toLinear(rgb.b));
  };

  const fg = toLuminance(foreground);
  const bg = toLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return Number((((lighter + 0.05) / (darker + 0.05))).toFixed(2));
}

function buildCliUiIntrospection(pageFilter, cardFilter) {
  const allPages = [
    {
      pageId: "settings",
      cards: [
        {
          cardId: "design-system-controls",
          cardType: "dsc",
          recipeName: "dsc-surface-card",
          expectedTokenSet: {
            background: "cardBackground",
            border: "border",
            titleText: "text",
            bodyText: "textSubtle",
          },
          actualTokenSet: {
            background: LOCKED_SEMANTIC_PALETTE.major,
            border: LOCKED_SEMANTIC_PALETTE.minor,
            titleText: LOCKED_SEMANTIC_PALETTE.accent,
            bodyText: LOCKED_SEMANTIC_PALETTE.accent,
          },
          backgroundColor: LOCKED_SEMANTIC_PALETTE.major,
          borderColor: LOCKED_SEMANTIC_PALETTE.minor,
          titleTextColor: LOCKED_SEMANTIC_PALETTE.accent,
          bodyTextColor: LOCKED_SEMANTIC_PALETTE.accent,
          buttonTypes: ["active", "new", "pending", "error"],
          buttonTokenSets: [
            {
              type: "active",
              expectedTokenSet: {
                background: "buttonPrimary",
                border: "accentActive",
                text: "text",
              },
              computed: {
                backgroundColor: LOCKED_SEMANTIC_PALETTE.major,
                borderColor: LOCKED_SEMANTIC_PALETTE.accent,
                textColor: LOCKED_SEMANTIC_PALETTE.accent,
              },
            },
          ],
          fallbacksUsed: [],
          mismatches: [],
          legacyColorUsage: [],
          components: [],
        },
      ],
    },
  ];

  let pages = allPages;
  if (pageFilter) {
    pages = pages.filter((page) => page.pageId === pageFilter);
  }

  if (cardFilter) {
    pages = pages
      .map((page) => ({
        ...page,
        cards: page.cards.filter((card) => card.cardId === cardFilter),
      }))
      .filter((page) => page.cards.length > 0);
  }

  return { pages };
}

function buildUnifiedDebugReport(options = {}) {
  const now = new Date().toISOString();
  const bg = LOCKED_SEMANTIC_PALETTE.major;
  const entries = readEntries();
  const pageFilter = String(options.page || "").trim();
  const cardFilter = String(options.card || "").trim();

  const semanticRoles = {
    major: LOCKED_SEMANTIC_PALETTE.major,
    minor: LOCKED_SEMANTIC_PALETTE.minor,
    accent: LOCKED_SEMANTIC_PALETTE.accent,
    success: LOCKED_SEMANTIC_PALETTE.success,
    warning: LOCKED_SEMANTIC_PALETTE.warning,
    error: LOCKED_SEMANTIC_PALETTE.error,
    info: LOCKED_SEMANTIC_PALETTE.info,
  };

  const resolvedSemantic = {
    background: LOCKED_SEMANTIC_PALETTE.major,
    surface: LOCKED_SEMANTIC_PALETTE.major,
    border: LOCKED_SEMANTIC_PALETTE.minor,
    text: LOCKED_SEMANTIC_PALETTE.accent,
    textSubtle: LOCKED_SEMANTIC_PALETTE.accent,
    accent: LOCKED_SEMANTIC_PALETTE.accent,
    accentHover: LOCKED_SEMANTIC_PALETTE.accent,
    accentActive: LOCKED_SEMANTIC_PALETTE.accent,
    success: LOCKED_SEMANTIC_PALETTE.success,
    warning: LOCKED_SEMANTIC_PALETTE.warning,
    error: LOCKED_SEMANTIC_PALETTE.error,
    info: LOCKED_SEMANTIC_PALETTE.info,
    cardBackground: LOCKED_SEMANTIC_PALETTE.major,
    cardShadow: LOCKED_SEMANTIC_PALETTE.minor,
    cardGlow: LOCKED_SEMANTIC_PALETTE.accent,
    buttonPrimary: LOCKED_SEMANTIC_PALETTE.major,
    buttonSecondary: LOCKED_SEMANTIC_PALETTE.minor,
    buttonGhost: LOCKED_SEMANTIC_PALETTE.major,
  };

  const fallbackRecords = Object.entries(semanticRoles).map(([role, color], index) => {
    const contrastAgainstBackground = toContrastRatio(color, bg);
    const contrastAcceptable = contrastAgainstBackground >= 4.5;
    return {
      id: `cli-dsc-${index + 1}`,
      timestamp: Date.now(),
      semanticRole: role,
      sourcePath: `lockedPalette.${role}`,
      requestedValue: color,
      requestedToken: color,
      resolvedToken: `lockedPalette.${role}`,
      computedValue: color,
      computedColor: color,
      fallbackChain: [`semanticAssignments.${role}`, `roles.${role}.shades[5]`, `lockedPalette.${role}`],
      reasonForFallback: null,
      component: "tokens",
      componentName: "tokens",
      interactionState: "default",
      componentState: "default",
      contrastRatio: contrastAgainstBackground,
      contrastAgainstBackground,
      contrastAcceptable,
      cascadingFailureRisk: false,
      themeMode: "light",
    };
  });

  const componentTokenMaps = {
    buttonPrimary: {
      default: LOCKED_SEMANTIC_PALETTE.major,
      hover: LOCKED_SEMANTIC_PALETTE.accent,
      active: LOCKED_SEMANTIC_PALETTE.accent,
      disabled: LOCKED_SEMANTIC_PALETTE.minor,
      focus: LOCKED_SEMANTIC_PALETTE.info,
    },
    buttonSecondary: {
      default: LOCKED_SEMANTIC_PALETTE.minor,
      hover: LOCKED_SEMANTIC_PALETTE.accent,
      active: LOCKED_SEMANTIC_PALETTE.accent,
      disabled: LOCKED_SEMANTIC_PALETTE.minor,
      focus: LOCKED_SEMANTIC_PALETTE.info,
    },
    buttonGhost: {
      default: LOCKED_SEMANTIC_PALETTE.major,
      hover: LOCKED_SEMANTIC_PALETTE.accent,
      active: LOCKED_SEMANTIC_PALETTE.accent,
      disabled: LOCKED_SEMANTIC_PALETTE.minor,
      focus: LOCKED_SEMANTIC_PALETTE.info,
    },
    alerts: {
      success: LOCKED_SEMANTIC_PALETTE.success,
      warning: LOCKED_SEMANTIC_PALETTE.warning,
      error: LOCKED_SEMANTIC_PALETTE.error,
      info: LOCKED_SEMANTIC_PALETTE.info,
      text: LOCKED_SEMANTIC_PALETTE.accent,
    },
    badges: {
      success: LOCKED_SEMANTIC_PALETTE.success,
      warning: LOCKED_SEMANTIC_PALETTE.warning,
      error: LOCKED_SEMANTIC_PALETTE.error,
      info: LOCKED_SEMANTIC_PALETTE.info,
      text: LOCKED_SEMANTIC_PALETTE.accent,
    },
    inputs: {
      default: LOCKED_SEMANTIC_PALETTE.major,
      hover: LOCKED_SEMANTIC_PALETTE.minor,
      active: LOCKED_SEMANTIC_PALETTE.accent,
      focus: LOCKED_SEMANTIC_PALETTE.info,
      disabled: LOCKED_SEMANTIC_PALETTE.minor,
      text: LOCKED_SEMANTIC_PALETTE.accent,
    },
  };

  const contrastChecks = Object.entries(componentTokenMaps).flatMap(([component, states]) =>
    Object.entries(states).map(([state, color]) => ({
      component,
      interactionState: state,
      foreground: color,
      background: bg,
      ratio: toContrastRatio(color, bg),
      themeMode: "light",
    }))
  );

  return {
    generatedAt: now,
    debugMode: readConfig().enabled,
    palette: LOCKED_SEMANTIC_PALETTE,
    semanticTokens: {
      roles: semanticRoles,
      resolved: resolvedSemantic,
    },
    cssVariablesSnapshot: {
      "--cf-semantic-background": resolvedSemantic.background,
      "--cf-semantic-surface": resolvedSemantic.surface,
      "--cf-semantic-border": resolvedSemantic.border,
      "--cf-semantic-text": resolvedSemantic.text,
      "--cf-semantic-accent": resolvedSemantic.accent,
      "--cf-semantic-accent-hover": resolvedSemantic.accentHover,
      "--cf-semantic-accent-active": resolvedSemantic.accentActive,
      "--cf-semantic-success": resolvedSemantic.success,
      "--cf-semantic-warning": resolvedSemantic.warning,
      "--cf-semantic-error": resolvedSemantic.error,
      "--cf-semantic-info": resolvedSemantic.info,
    },
    componentTokenMaps,
    fallbackRecords,
    contrastChecks,
    cascadingFailureSummary: {
      riskCount: 0,
      risks: [],
    },
    uiIntrospection: buildCliUiIntrospection(pageFilter, cardFilter),
    themeGeneration: {
      mode: "light",
      harmony: {
        mode: "mono",
        baseHue: defaultDesignTokens.primaryHue,
        brandHue: defaultDesignTokens.primaryHue,
        effectiveBrandHue: defaultDesignTokens.primaryHue,
        saturationMode: "free",
        saturation: 83,
        majorHue: defaultDesignTokens.primaryHue,
        minorHue: defaultDesignTokens.primaryHue,
        accentHue: defaultDesignTokens.primaryHue,
        highlightHue: defaultDesignTokens.primaryHue,
        colors: {
          major: LOCKED_SEMANTIC_PALETTE.major,
          minor: LOCKED_SEMANTIC_PALETTE.minor,
          accent: LOCKED_SEMANTIC_PALETTE.accent,
          highlight: LOCKED_SEMANTIC_PALETTE.info,
        },
      },
      semantic: {
        ...defaultDesignTokens.semanticColors,
      },
    },
    runtimeLogEntries: entries,
  };
}

function runUnifiedDebugPipeline() {
  if (hasFlag("enable")) {
    setEnabled(true);
  }

  if (hasFlag("disable")) {
    setEnabled(false);
  }

  if (hasFlag("clear")) {
    clearLog();
  }

  const report = buildUnifiedDebugReport({
    page: parseFlag("page", ""),
    card: parseFlag("card", ""),
  });
  const outputPath = parseFlag("report", path.join(baseDir, `debug-report-${Date.now()}.json`));
  const resolvedOut = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, JSON.stringify(report, null, 2), "utf8");
  console.log(`Unified debug report written to ${resolvedOut}`);
}

function showHelp() {
  console.log("Usage:");
  console.log("  program settings reset-design-tokens");
  console.log("  program debug <feature> [--severity info|warn|error] [--sourceType automatic|manual] [--message text]");
  console.log("  program debug [--enable] [--disable] [--clear] [--report path]");
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

if (!subcommand || subcommand === "report") {
  runUnifiedDebugPipeline();
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

if (hasFlag("report") || hasFlag("enable") || hasFlag("disable") || hasFlag("clear")) {
  runUnifiedDebugPipeline();
  process.exit(0);
}

appendDebugEntry(subcommand);

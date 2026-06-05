import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

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
const pluginStateDir = localAppData
  ? path.join(localAppData, "CourseForge", "plugins")
  : path.join(os.homedir(), ".courseforge", "plugins");
const pluginStatePath = path.join(pluginStateDir, "plugins-state.json");
const dscPluginArtifactDir = path.join(process.cwd(), ".debug", "plugins", "dsc");
const authSessionPath = path.join(baseDir, "auth-session.json");

const roleRanks = {
  guest: 0,
  student: 1,
  teacher: 2,
  schoolAdmin: 3,
  districtAdmin: 4,
  superAdmin: 5,
};

const roleAliases = {
  guest: "guest",
  student: "student",
  teacher: "teacher",
  schooladmin: "schoolAdmin",
  school_admin: "schoolAdmin",
  "school-admin": "schoolAdmin",
  districtadmin: "districtAdmin",
  district_admin: "districtAdmin",
  "district-admin": "districtAdmin",
  superadmin: "superAdmin",
  super_admin: "superAdmin",
  "super-admin": "superAdmin",
};

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

function normalizeRole(value) {
  const lowered = String(value || "").trim().toLowerCase();
  if (!lowered) {
    return "guest";
  }

  return roleAliases[lowered] || "guest";
}

function readAuthSession() {
  ensureDir();
  if (!fs.existsSync(authSessionPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(authSessionPath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeAuthSession(session) {
  ensureDir();
  fs.writeFileSync(authSessionPath, JSON.stringify(session, null, 2), "utf8");
  try {
    fs.chmodSync(authSessionPath, 0o600);
  } catch {
    // Best effort on platforms that do not support chmod semantics.
  }
}

function clearAuthSession() {
  if (fs.existsSync(authSessionPath)) {
    fs.unlinkSync(authSessionPath);
  }
}

function getAuthStatus() {
  const session = readAuthSession();
  if (!session) {
    return {
      authenticated: false,
      role: "guest",
      uid: null,
      email: null,
      displayName: null,
      issuedAt: null,
      expiresAt: null,
      expiresAtMs: 0,
      secondsRemaining: 0,
      tokenPreview: null,
      tokenState: "missing",
    };
  }

  const now = Date.now();
  const expiresAtMs = Number(session.expiresAtMs || 0);
  const secondsRemaining = Math.max(0, Math.floor((expiresAtMs - now) / 1000));
  const authenticated = Boolean(session.token) && expiresAtMs > now;
  const tokenText = String(session.token || "");
  const tokenPreview = tokenText
    ? `${tokenText.slice(0, 6)}...${tokenText.slice(-4)}`
    : null;

  return {
    authenticated,
    role: normalizeRole(session.role),
    uid: session.uid || null,
    email: session.email || null,
    displayName: session.displayName || null,
    issuedAt: session.issuedAt || null,
    expiresAt: session.expiresAt || null,
    expiresAtMs,
    secondsRemaining,
    tokenPreview,
    tokenState: !session.token ? "missing" : authenticated ? "valid" : "expired",
  };
}

function getRequiredRoleForInvocation(commandName) {
  if (["help", "permissions", "login", "logout", "whoami", "auth"].includes(commandName)) {
    return "guest";
  }

  if (commandName === "admin") {
    const area = String(args[1] || "status").toLowerCase();
    if (area === "super") {
      return "superAdmin";
    }
    if (area === "school") {
      return "schoolAdmin";
    }
    return "districtAdmin";
  }

  if (["textbooks", "settings", "ocr", "debug", "plugins"].includes(commandName)) {
    return "teacher";
  }

  return "guest";
}

function enforceAuthorizationOrExit(commandName) {
  const requiredRole = getRequiredRoleForInvocation(commandName);
  if (requiredRole === "guest") {
    return;
  }

  const auth = getAuthStatus();
  if (!auth.authenticated) {
    emitCommandResult("courseforge security access denied", {
      reason: "not_authenticated",
      requiredRole,
      currentRole: auth.role,
      command: args.join(" "),
      message: "Authentication is required. Run: courseforge login --role <role>",
    }, false);
    process.exit(1);
  }

  const currentRank = roleRanks[auth.role] ?? 0;
  const requiredRank = roleRanks[requiredRole] ?? Number.MAX_SAFE_INTEGER;
  if (currentRank < requiredRank) {
    emitCommandResult("courseforge security access denied", {
      reason: "insufficient_role",
      requiredRole,
      currentRole: auth.role,
      command: args.join(" "),
      uid: auth.uid,
      message: `Role ${auth.role} cannot execute this command. Required role: ${requiredRole}.`,
    }, false);
    process.exit(1);
  }
}

function handleLoginCommand() {
  const role = normalizeRole(parseFlag("role", "guest"));
  const uid = parseFlag("uid", `cli-${role}-${Date.now()}`);
  const email = parseFlag("email", `${role}@courseforge.local`);
  const displayName = parseFlag("displayName", `${role} CLI User`);
  const expiresInSeconds = Number(parseFlag("expiresInSeconds", "3600"));
  const lifetimeSeconds = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
    ? Math.floor(expiresInSeconds)
    : 3600;
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + (lifetimeSeconds * 1000);
  const token = parseFlag("token", randomUUID().replaceAll("-", ""));

  writeAuthSession({
    uid,
    email,
    displayName,
    role,
    token,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs,
  });

  emitCommandResult("courseforge login", {
    authenticated: true,
    uid,
    email,
    displayName,
    role,
    expiresAt: new Date(expiresAtMs).toISOString(),
    tokenStoredSecurely: true,
    message: `Logged in as ${role}.`,
  });
}

function handleLogoutCommand() {
  clearAuthSession();
  emitCommandResult("courseforge logout", {
    authenticated: false,
    role: "guest",
    message: "Logged out and removed local CLI session.",
  });
}

function handleWhoAmICommand() {
  const auth = getAuthStatus();
  emitCommandResult("courseforge whoami", {
    authenticated: auth.authenticated,
    uid: auth.uid,
    email: auth.email,
    displayName: auth.displayName,
    role: auth.authenticated ? auth.role : "guest",
    message: auth.authenticated ? `Signed in as ${auth.role}.` : "No active CLI session.",
  }, auth.authenticated);

  if (!auth.authenticated) {
    process.exit(1);
  }
}

function handleAuthCommand() {
  const action = String(subcommand || "status").toLowerCase();
  const auth = getAuthStatus();

  if (action === "status") {
    emitCommandResult("courseforge auth status", {
      authenticated: auth.authenticated,
      role: auth.authenticated ? auth.role : "guest",
      uid: auth.uid,
      email: auth.email,
      expiresAt: auth.expiresAt,
      secondsRemaining: auth.secondsRemaining,
      tokenState: auth.tokenState,
    }, true);
    return;
  }

  if (action === "refresh") {
    if (!auth.authenticated) {
      emitCommandResult("courseforge auth refresh", {
        authenticated: false,
        reason: "missing_or_expired_session",
        message: "Cannot refresh. Please login again.",
      }, false);
      process.exit(1);
    }

    const refreshSeconds = Number(parseFlag("expiresInSeconds", "3600"));
    const lifetimeSeconds = Number.isFinite(refreshSeconds) && refreshSeconds > 0
      ? Math.floor(refreshSeconds)
      : 3600;
    const nextIssuedAtMs = Date.now();
    const nextExpiresAtMs = nextIssuedAtMs + (lifetimeSeconds * 1000);
    const previous = readAuthSession() || {};
    writeAuthSession({
      ...previous,
      role: auth.role,
      uid: auth.uid,
      email: auth.email,
      displayName: auth.displayName,
      token: previous.token || randomUUID().replaceAll("-", ""),
      issuedAt: new Date(nextIssuedAtMs).toISOString(),
      expiresAt: new Date(nextExpiresAtMs).toISOString(),
      expiresAtMs: nextExpiresAtMs,
    });

    emitCommandResult("courseforge auth refresh", {
      authenticated: true,
      role: auth.role,
      uid: auth.uid,
      expiresAt: new Date(nextExpiresAtMs).toISOString(),
      secondsRemaining: lifetimeSeconds,
      message: "Auth session refreshed.",
    });
    return;
  }

  if (action === "token-info") {
    emitCommandResult("courseforge auth token-info", {
      authenticated: auth.authenticated,
      role: auth.authenticated ? auth.role : "guest",
      uid: auth.uid,
      issuedAt: auth.issuedAt,
      expiresAt: auth.expiresAt,
      secondsRemaining: auth.secondsRemaining,
      tokenState: auth.tokenState,
      tokenPreview: auth.tokenPreview,
      message: auth.authenticated ? "Token metadata returned." : "No active token.",
    }, auth.authenticated);

    if (!auth.authenticated) {
      process.exit(1);
    }
    return;
  }

  console.error("Unknown auth action. Use status, refresh, or token-info.");
  process.exit(1);
}

function ensurePluginStateDir() {
  fs.mkdirSync(pluginStateDir, { recursive: true });
}

function scanPluginManifests() {
  const pluginsRoot = path.join(process.cwd(), "plugins");
  if (!fs.existsSync(pluginsRoot)) {
    return [];
  }

  const childEntries = fs.readdirSync(pluginsRoot, { withFileTypes: true });
  const manifests = [];

  for (const entry of childEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = path.join(pluginsRoot, entry.name, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifests.push(parsed);
    } catch {
      manifests.push({
        name: entry.name,
        id: entry.name,
        version: "0.0.0",
        description: "Invalid plugin manifest.",
        optional: true,
        entry: "",
      });
    }
  }

  return manifests;
}

function readPluginState() {
  ensurePluginStateDir();
  if (!fs.existsSync(pluginStatePath)) {
    const initial = { installed: {} };
    fs.writeFileSync(pluginStatePath, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(pluginStatePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.installed || typeof parsed.installed !== "object") {
      throw new Error("Invalid plugin state format.");
    }

    return parsed;
  } catch {
    const reset = { installed: {} };
    fs.writeFileSync(pluginStatePath, JSON.stringify(reset, null, 2), "utf8");
    return reset;
  }
}

function writePluginState(next) {
  ensurePluginStateDir();
  fs.writeFileSync(pluginStatePath, JSON.stringify(next, null, 2), "utf8");
}

function getArtifactTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${yyyy}${mm}${dd}_${hh}${min}${sec}_${ms}`;
}

function writeDscLifecycleArtifact(action, payload) {
  fs.mkdirSync(dscPluginArtifactDir, { recursive: true });
  const artifact = {
    action,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  const filePath = path.join(dscPluginArtifactDir, `${getArtifactTimestamp()}_${action}.json`);
  fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2), "utf8");
  return filePath;
}

function handlePlugins() {
  const action = subcommand || "status";
  const pluginId = args[2] ? String(args[2]).trim().toLowerCase() : "";
  const manifests = scanPluginManifests();
  const state = readPluginState();

  if (action === "status") {
    const summary = manifests.map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      optional: Boolean(manifest.optional),
      installed: Boolean(state.installed[manifest.id]),
      available: true,
    }));
    const dscStatus = summary.find((plugin) => plugin.id === "dsc") || {
      id: "dsc",
      installed: Boolean(state.installed.dsc),
      available: false,
    };
    writeDscLifecycleArtifact("detect", {
      plugin: "dsc",
      installed: Boolean(dscStatus.installed),
      available: Boolean(dscStatus.available),
      state: state.installed,
    });
    console.log(JSON.stringify({ plugins: summary }, null, 2));
    return;
  }

  if (!pluginId) {
    console.error("Plugin id is required. Example: courseforge plugins install dsc");
    process.exit(1);
  }

  const manifest = manifests.find((item) => String(item.id).toLowerCase() === pluginId);
  if (!manifest) {
    if (pluginId === "dsc") {
      writeDscLifecycleArtifact(action, {
        plugin: pluginId,
        ok: true,
        message: "Plugin manifest not found. No action applied.",
        state: state.installed,
      });
    }
    console.log(JSON.stringify({
      plugin: pluginId,
      action,
      ok: true,
      message: "Plugin manifest not found. No action applied.",
    }, null, 2));
    return;
  }

  if (action === "install") {
    state.installed[manifest.id] = true;
    writePluginState(state);
    if (manifest.id === "dsc") {
      writeDscLifecycleArtifact("install", {
        plugin: manifest.id,
        installed: true,
        ok: true,
        state: state.installed,
      });
      writeDscLifecycleArtifact("refresh", {
        plugin: manifest.id,
        installed: true,
        ok: true,
        state: state.installed,
      });
    }
    console.log(JSON.stringify({
      plugin: manifest.id,
      action,
      ok: true,
      installed: true,
      message: `${manifest.name} installed.`,
    }, null, 2));
    return;
  }

  if (action === "uninstall") {
    delete state.installed[manifest.id];
    writePluginState(state);
    if (manifest.id === "dsc") {
      writeDscLifecycleArtifact("uninstall", {
        plugin: manifest.id,
        installed: false,
        ok: true,
        state: state.installed,
      });
      writeDscLifecycleArtifact("refresh", {
        plugin: manifest.id,
        installed: false,
        ok: true,
        state: state.installed,
      });
    }
    console.log(JSON.stringify({
      plugin: manifest.id,
      action,
      ok: true,
      installed: false,
      message: `${manifest.name} uninstalled.`,
    }, null, 2));
    return;
  }

  console.error("Unknown plugins action. Use install, uninstall, or status.");
  process.exit(1);
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

function hasAnyFlag(names) {
  return names.some((name) => hasFlag(name));
}

function getPositionalArgs(startIndex = 1) {
  const positional = [];
  for (let index = startIndex; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith("--")) {
      if (!value.includes("=") && index + 1 < args.length && !args[index + 1].startsWith("--")) {
        index += 1;
      }
      continue;
    }
    positional.push(value);
  }
  return positional;
}

function toCommandLogPath() {
  return path.join(baseDir, "workflow-command-log.jsonl");
}

function appendWorkflowCommandLog(entry) {
  ensureDir();
  fs.appendFileSync(toCommandLogPath(), `${JSON.stringify(entry)}\n`, "utf8");
}

function emitCommandResult(commandId, payload = {}, ok = true) {
  const result = {
    timestamp: new Date().toISOString(),
    commandId,
    ok,
    ...payload,
  };
  appendWorkflowCommandLog(result);
  console.log(JSON.stringify(result, null, 2));
}

function handleTextbooks() {
  const action = (subcommand || "status").toLowerCase();
  if (action === "status") {
    emitCommandResult("courseforge textbooks status", {
      supportedActions: [
        "mode",
        "isbn",
        "save",
        "edit",
        "select",
        "sections",
        "favorite",
        "archive",
        "sync",
        "cover",
        "delete",
        "auto",
      ],
    });
    return;
  }

  if (action === "mode") {
    const mode = parseFlag("mode", getPositionalArgs(2)[0] || "choose");
    emitCommandResult("courseforge textbooks mode", {
      mode,
      message: `Textbook mode command accepted: ${mode}`,
    });
    return;
  }

  if (action === "isbn") {
    const isbnAction = (getPositionalArgs(2)[0] || "lookup").toLowerCase();
    const isbn = parseFlag("isbn", "");
    emitCommandResult(`courseforge textbooks isbn ${isbnAction}`, {
      isbn,
      message: `ISBN workflow command accepted: ${isbnAction}`,
    });
    return;
  }

  if (action === "save") {
    emitCommandResult("courseforge textbooks save", {
      title: parseFlag("title", ""),
      isbn: parseFlag("isbn", ""),
      sourceType: parseFlag("sourceType", "manual"),
      message: "Textbook save workflow command accepted.",
    });
    return;
  }

  if (action === "edit") {
    const editAction = (getPositionalArgs(2)[0] || "cancel").toLowerCase();
    emitCommandResult(`courseforge textbooks edit ${editAction}`, {
      textbookId: parseFlag("textbookId", ""),
      message: `Textbook edit workflow command accepted: ${editAction}`,
    });
    return;
  }

  if (action === "select") {
    emitCommandResult("courseforge textbooks select", {
      textbookId: parseFlag("textbookId", ""),
      message: "Textbook selection command accepted.",
    });
    return;
  }

  if (action === "sections") {
    const sectionsAction = (getPositionalArgs(2)[0] || "continue").toLowerCase();
    emitCommandResult(`courseforge textbooks sections ${sectionsAction}`, {
      textbookId: parseFlag("textbookId", ""),
      message: `Textbook sections command accepted: ${sectionsAction}`,
    });
    return;
  }

  if (action === "favorite") {
    const favoriteAction = (getPositionalArgs(2)[0] || "toggle").toLowerCase();
    emitCommandResult(`courseforge textbooks favorite ${favoriteAction}`, {
      textbookId: parseFlag("textbookId", ""),
      isFavorite: parseFlag("isFavorite", ""),
      message: `Textbook favorite command accepted: ${favoriteAction}`,
    });
    return;
  }

  if (action === "archive") {
    const archiveAction = (getPositionalArgs(2)[0] || "toggle").toLowerCase();
    emitCommandResult(`courseforge textbooks archive ${archiveAction}`, {
      textbookId: parseFlag("textbookId", ""),
      isArchived: parseFlag("isArchived", ""),
      message: `Textbook archive command accepted: ${archiveAction}`,
    });
    return;
  }

  if (action === "sync") {
    const syncAction = (getPositionalArgs(2)[0] || "retry").toLowerCase();
    emitCommandResult(`courseforge textbooks sync ${syncAction}`, {
      textbookId: parseFlag("textbookId", ""),
      message: `Textbook sync command accepted: ${syncAction}`,
    });
    return;
  }

  if (action === "cover") {
    const coverAction = (getPositionalArgs(2)[0] || "recover").toLowerCase();
    emitCommandResult(`courseforge textbooks cover ${coverAction}`, {
      textbookId: parseFlag("textbookId", ""),
      message: `Textbook cover command accepted: ${coverAction}`,
    });
    return;
  }

  if (action === "delete") {
    emitCommandResult("courseforge textbooks delete", {
      textbookId: parseFlag("textbookId", ""),
      retentionMs: parseFlag("retentionMs", ""),
      message: "Textbook delete command accepted.",
    });
    return;
  }

  if (action === "auto") {
    const autoAction = (getPositionalArgs(2)[0] || "status").toLowerCase();
    if (autoAction === "capture") {
      const captureTarget = (getPositionalArgs(3)[0] || "cover").toLowerCase();
      const captureSuffix = captureTarget === "title"
        ? `${captureTarget} ${(getPositionalArgs(4)[0] || "").toLowerCase()}`.trim()
        : captureTarget;
      emitCommandResult(`courseforge textbooks auto capture ${captureSuffix}`, {
        step: parseFlag("step", ""),
        message: `Textbook auto capture command accepted: ${captureSuffix}`,
      });
      return;
    }

    if (autoAction === "toc") {
      const tocAction = (getPositionalArgs(3)[0] || "status").toLowerCase();
      const tocTarget = (getPositionalArgs(4)[0] || "").toLowerCase();
      const tocSuffix = `${tocAction}${tocTarget ? ` ${tocTarget}` : ""}`;
      emitCommandResult(`courseforge textbooks auto toc ${tocSuffix}`.trim(), {
        chapterIndex: parseFlag("chapterIndex", ""),
        message: `Textbook auto TOC command accepted: ${tocSuffix}`,
      });
      return;
    }

    if (autoAction === "save") {
      const saveTarget = (getPositionalArgs(3)[0] || "setup").toLowerCase();
      emitCommandResult(`courseforge textbooks auto save ${saveTarget}`, {
        title: parseFlag("title", ""),
        chapterCount: parseFlag("chapterCount", ""),
        hasCover: parseFlag("hasCover", ""),
        message: `Textbook auto save command accepted: ${saveTarget}`,
      });
      return;
    }

    emitCommandResult(`courseforge textbooks auto ${autoAction}`, {
      message: `Textbook auto command accepted: ${autoAction}`,
    });
    return;
  }

  console.error("Unknown textbooks action. Use status, mode, isbn, save, edit, select, sections, favorite, archive, sync, cover, delete, or auto.");
  process.exit(1);
}

function handleAdmin() {
  const action = (subcommand || "status").toLowerCase();
  if (action === "status") {
    emitCommandResult("courseforge admin status", {
      supportedActions: [
        "moderation",
        "content",
        "debug-policy",
        "premium",
        "corrections",
        "translations",
        "school",
        "super",
        "users",
        "glossary",
      ],
    });
    return;
  }

  if (action === "moderation") {
    const moderationAction = (getPositionalArgs(2)[0] || "refresh").toLowerCase();
    emitCommandResult(`courseforge admin moderation ${moderationAction}`, {
      docPath: parseFlag("docPath", ""),
      message: `Admin moderation command accepted: ${moderationAction}`,
    });
    return;
  }

  if (action === "content") {
    const contentAction = (getPositionalArgs(2)[0] || "search").toLowerCase();
    emitCommandResult(`courseforge admin content ${contentAction}`, {
      docPath: parseFlag("docPath", ""),
      collectionName: parseFlag("collectionName", "all"),
      filterTitle: parseFlag("title", ""),
      filterIsbn: parseFlag("isbn", ""),
      filterOwnerEmail: parseFlag("ownerEmail", ""),
      message: `Admin content command accepted: ${contentAction}`,
    });
    return;
  }

  if (action === "debug-policy") {
    const policyAction = (getPositionalArgs(2)[0] || "refresh").toLowerCase();
    emitCommandResult(`courseforge admin debug-policy ${policyAction}`, {
      enabledGlobally: parseFlag("enabledGlobally", ""),
      maxUploadBytes: parseFlag("maxUploadBytes", ""),
      maxLocalLogBytes: parseFlag("maxLocalLogBytes", ""),
      message: `Admin debug policy command accepted: ${policyAction}`,
    });
    return;
  }

  if (action === "premium") {
    const premiumAction = (getPositionalArgs(2)[0] || "refresh").toLowerCase();
    emitCommandResult(`courseforge admin premium ${premiumAction}`, {
      uid: parseFlag("uid", ""),
      message: `Admin premium command accepted: ${premiumAction}`,
    });
    return;
  }

  if (action === "corrections") {
    const area = (getPositionalArgs(2)[0] || "review").toLowerCase();
    const reviewAction = (getPositionalArgs(3)[0] || "refresh").toLowerCase();
    const commandSuffix = area === "review"
      ? `${area} ${reviewAction}`
      : `${area}`;
    emitCommandResult(`courseforge admin corrections ${commandSuffix}`, {
      recordId: parseFlag("recordId", ""),
      count: parseFlag("count", ""),
      message: `Admin corrections command accepted: ${commandSuffix}`,
    });
    return;
  }

  if (action === "translations") {
    const translationAction = (getPositionalArgs(2)[0] || "review").toLowerCase();
    const nextAction = (getPositionalArgs(3)[0] || "refresh").toLowerCase();
    const tailAction = (getPositionalArgs(4)[0] || "").toLowerCase();
    const commandSuffix = translationAction === "review"
      ? `${translationAction} ${nextAction}`
      : `${translationAction}${nextAction ? ` ${nextAction}` : ""}${tailAction ? ` ${tailAction}` : ""}`;
    emitCommandResult(`courseforge admin translations ${commandSuffix}`, {
      id: parseFlag("id", ""),
      language: parseFlag("language", ""),
      termId: parseFlag("termId", ""),
      message: `Admin translations command accepted: ${commandSuffix}`,
    });
    return;
  }

  if (action === "glossary") {
    const glossaryAction = (getPositionalArgs(2)[0] || "refresh").toLowerCase();
    emitCommandResult(`courseforge admin glossary ${glossaryAction}`, {
      id: parseFlag("id", ""),
      subject: parseFlag("subject", ""),
      sourceLanguage: parseFlag("sourceLanguage", ""),
      targetLanguage: parseFlag("targetLanguage", ""),
      message: `Admin glossary command accepted: ${glossaryAction}`,
    });
    return;
  }

  if (action === "school") {
    const schoolAction = (getPositionalArgs(2)[0] || "refresh").toLowerCase();
    if (schoolAction === "remove-user") {
      emitCommandResult("courseforge admin school remove-user", {
        schoolId: parseFlag("schoolId", ""),
        uid: parseFlag("uid", ""),
        message: "Admin school remove-user command accepted.",
      });
      return;
    }
    if (schoolAction === "textbook") {
      const nextAction = (getPositionalArgs(3)[0] || "deletion").toLowerCase();
      const finalAction = (getPositionalArgs(4)[0] || "toggle").toLowerCase();
      const suffix = `${nextAction} ${finalAction}`;
      emitCommandResult(`courseforge admin school textbook ${suffix}`, {
        schoolId: parseFlag("schoolId", ""),
        textbookId: parseFlag("textbookId", ""),
        isDeleted: parseFlag("isDeleted", ""),
        message: `Admin school textbook command accepted: ${suffix}`,
      });
      return;
    }
    if (schoolAction === "promotion") {
      const promotionAction = (getPositionalArgs(3)[0] || "request").toLowerCase();
      emitCommandResult(`courseforge admin school promotion ${promotionAction}`, {
        schoolId: parseFlag("schoolId", ""),
        message: `Admin school promotion command accepted: ${promotionAction}`,
      });
      return;
    }
    emitCommandResult(`courseforge admin school ${schoolAction}`, {
      schoolId: parseFlag("schoolId", ""),
      inviteEmail: parseFlag("inviteEmail", ""),
      message: `Admin school command accepted: ${schoolAction}`,
    });
    return;
  }

  if (action === "super") {
    const superAction = (getPositionalArgs(2)[0] || "dashboard").toLowerCase();
    if (superAction === "dashboard") {
      const dashboardAction = (getPositionalArgs(3)[0] || "refresh").toLowerCase();
      emitCommandResult(`courseforge admin super dashboard ${dashboardAction}`, {
        message: `Admin super dashboard command accepted: ${dashboardAction}`,
      });
      return;
    }
    if (superAction === "ai") {
      const aiTarget = (getPositionalArgs(3)[0] || "policy").toLowerCase();
      const aiAction = (getPositionalArgs(4)[0] || "save").toLowerCase();
      emitCommandResult(`courseforge admin super ai ${aiTarget} ${aiAction}`.trim(), {
        uid: parseFlag("uid", ""),
        message: `Admin super AI command accepted: ${aiTarget} ${aiAction}`,
      });
      return;
    }
    if (superAction === "backup") {
      const backupTarget = (getPositionalArgs(3)[0] || "run").toLowerCase();
      const backupAction = (getPositionalArgs(4)[0] || "").toLowerCase();
      const suffix = `${backupTarget}${backupAction ? ` ${backupAction}` : ""}`;
      emitCommandResult(`courseforge admin super backup ${suffix}`.trim(), {
        message: `Admin super backup command accepted: ${suffix}`,
      });
      return;
    }
    if (superAction === "promotion") {
      const promotionAction = (getPositionalArgs(3)[0] || "resolve").toLowerCase();
      emitCommandResult(`courseforge admin super promotion ${promotionAction}`, {
        requestId: parseFlag("requestId", ""),
        approve: parseFlag("approve", ""),
        message: `Admin super promotion command accepted: ${promotionAction}`,
      });
      return;
    }
    if (superAction === "user") {
      const userTarget = (getPositionalArgs(3)[0] || "admin").toLowerCase();
      const userAction = (getPositionalArgs(4)[0] || "toggle").toLowerCase();
      emitCommandResult(`courseforge admin super user ${userTarget} ${userAction}`.trim(), {
        uid: parseFlag("uid", ""),
        isAdmin: parseFlag("isAdmin", ""),
        isSuperAdmin: parseFlag("isSuperAdmin", ""),
        transferToUid: parseFlag("transferToUid", ""),
        message: `Admin super user command accepted: ${userTarget} ${userAction}`,
      });
      return;
    }
    emitCommandResult(`courseforge admin super ${superAction}`, {
      message: `Admin super command accepted: ${superAction}`,
    });
    return;
  }

  if (action === "users") {
    const usersAction = (getPositionalArgs(2)[0] || "refresh").toLowerCase();
    if (usersAction === "admin") {
      const adminAction = (getPositionalArgs(3)[0] || "toggle").toLowerCase();
      emitCommandResult(`courseforge admin users admin ${adminAction}`, {
        uid: parseFlag("uid", ""),
        isAdmin: parseFlag("isAdmin", ""),
        message: `Admin users admin command accepted: ${adminAction}`,
      });
      return;
    }
    if (usersAction === "content") {
      const contentTarget = (getPositionalArgs(3)[0] || "block").toLowerCase();
      const contentAction = (getPositionalArgs(4)[0] || "toggle").toLowerCase();
      emitCommandResult(`courseforge admin users content ${contentTarget} ${contentAction}`.trim(), {
        uid: parseFlag("uid", ""),
        isContentBlocked: parseFlag("isContentBlocked", ""),
        message: `Admin users content command accepted: ${contentTarget} ${contentAction}`,
      });
      return;
    }
    emitCommandResult(`courseforge admin users ${usersAction}`, {
      message: `Admin users command accepted: ${usersAction}`,
    });
    return;
  }

  console.error("Unknown admin action. Use status, moderation, content, debug-policy, premium, corrections, translations, school, super, users, or glossary.");
  process.exit(1);
}

function handleSettings() {
  const action = (subcommand || "status").toLowerCase();
  if (action === "status") {
    emitCommandResult("courseforge settings status", {
      supportedActions: [
        "language",
        "accessibility",
        "debug",
        "ocr",
        "plugin",
        "school",
        "auth",
        "updater",
        "design",
        "metadata",
      ],
    });
    return;
  }

  if (action === "language") {
    const languageAction = (getPositionalArgs(2)[0] || "set").toLowerCase();
    emitCommandResult(`courseforge settings language ${languageAction}`, {
      language: parseFlag("language", ""),
      message: `Settings language command accepted: ${languageAction}`,
    });
    return;
  }

  if (action === "accessibility") {
    const accessibilityAction = (getPositionalArgs(2)[0] || "patch").toLowerCase();
    emitCommandResult(`courseforge settings accessibility ${accessibilityAction}`, {
      fontScale: parseFlag("fontScale", ""),
      uiScale: parseFlag("uiScale", ""),
      highContrastMode: parseFlag("highContrastMode", ""),
      message: `Settings accessibility command accepted: ${accessibilityAction}`,
    });
    return;
  }

  if (action === "debug") {
    const debugAction = (getPositionalArgs(2)[0] || "status").toLowerCase();
    if (debugAction === "enable") {
      setEnabled(true);
      emitCommandResult("courseforge settings debug enable", { message: "Settings debug enabled." });
      return;
    }
    if (debugAction === "disable") {
      setEnabled(false);
      emitCommandResult("courseforge settings debug disable", { message: "Settings debug disabled." });
      return;
    }
    if (debugAction === "clear") {
      clearLog();
      emitCommandResult("courseforge settings debug clear", { message: "Settings debug log cleared." });
      return;
    }
    emitCommandResult(`courseforge settings debug ${debugAction}`, {
      message: `Settings debug command accepted: ${debugAction}`,
    });
    return;
  }

  if (action === "plugin") {
    const pluginId = (getPositionalArgs(2)[0] || "dsc").toLowerCase();
    const pluginAction = (getPositionalArgs(3)[0] || "status").toLowerCase();
    emitCommandResult(`courseforge settings plugin ${pluginId} ${pluginAction}`.trim(), {
      message: `Settings plugin command accepted: ${pluginId} ${pluginAction}`,
    });
    return;
  }

  if (action === "school") {
    const schoolAction = (getPositionalArgs(2)[0] || "affiliation").toLowerCase();
    const schoolTarget = (getPositionalArgs(3)[0] || "save").toLowerCase();
    emitCommandResult(`courseforge settings school ${schoolAction} ${schoolTarget}`.trim(), {
      schoolName: parseFlag("schoolName", ""),
      schoolId: parseFlag("schoolId", ""),
      message: `Settings school command accepted: ${schoolAction} ${schoolTarget}`,
    });
    return;
  }

  if (action === "auth") {
    const authAction = (getPositionalArgs(2)[0] || "status").toLowerCase();
    emitCommandResult(`courseforge settings auth ${authAction}`, {
      message: `Settings auth command accepted: ${authAction}`,
    });
    return;
  }

  if (action === "updater") {
    const updaterAction = (getPositionalArgs(2)[0] || "check").toLowerCase();
    emitCommandResult(`courseforge settings updater ${updaterAction}`, {
      message: `Settings updater command accepted: ${updaterAction}`,
    });
    return;
  }

  if (action === "design") {
    const designTarget = (getPositionalArgs(2)[0] || "save").toLowerCase();
    const designAction = (getPositionalArgs(3)[0] || "").toLowerCase();
    const designTail = (getPositionalArgs(4)[0] || "").toLowerCase();
    const suffix = `${designTarget}${designAction ? ` ${designAction}` : ""}${designTail ? ` ${designTail}` : ""}`;
    emitCommandResult(`courseforge settings design ${suffix}`.trim(), {
      decision: parseFlag("decision", ""),
      message: `Settings design command accepted: ${suffix}`,
    });
    return;
  }

  if (action === "metadata") {
    const metadataTarget = (getPositionalArgs(2)[0] || "sharing").toLowerCase();
    const metadataAction = (getPositionalArgs(3)[0] || "toggle").toLowerCase();
    emitCommandResult(`courseforge settings metadata ${metadataTarget} ${metadataAction}`.trim(), {
      enabled: parseFlag("enabled", ""),
      message: `Settings metadata command accepted: ${metadataTarget} ${metadataAction}`,
    });
    return;
  }

  if (action === "ocr") {
    const ocrAction = (getPositionalArgs(2)[0] || "status").toLowerCase();
    emitCommandResult(`courseforge settings ocr ${ocrAction}`, {
      providerId: parseFlag("providerId", ""),
      providerOrder: parseFlag("providerOrder", ""),
      message: `Settings OCR command accepted: ${ocrAction}`,
    });
    return;
  }

  console.error("Unknown settings action. Use status, language, accessibility, debug, ocr, plugin, school, auth, updater, design, or metadata.");
  process.exit(1);
}

function parseTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getOcrDebugLogEntries() {
  const entries = readEntries();
  return entries
    .filter((entry) => {
      const subsystem = String(entry.subsystem || "").toLowerCase();
      const message = String(entry.message || "").toLowerCase();
      const traceCandidate = String(entry.traceId || entry.context?.traceId || "").toLowerCase();
      return subsystem.includes("ocr")
        || message.includes("ocr")
        || message.includes("fallback")
        || traceCandidate.startsWith("ocr-");
    })
    .map((entry) => ({
      timestamp: entry.timestamp || null,
      timestampMs: parseTimestampMs(entry.timestamp),
      subsystem: entry.subsystem || "unknown",
      severity: entry.severity || "info",
      message: entry.message || "",
      sourceType: entry.sourceType || null,
      sourceKind: entry.sourceKind || null,
      context: entry.context || {},
      traceId: entry.traceId || entry.context?.traceId || null,
      errorContext: entry.errorContext || null,
      stackTrace: entry.stackTrace || null,
    }))
    .sort((left, right) => left.timestampMs - right.timestampMs);
}

function matchesOcrView(entry, view) {
  const message = String(entry.message || "").toLowerCase();
  const errorContext = String(entry.errorContext || "").toLowerCase();
  const merged = `${message} ${errorContext}`;

  if (view === "trace") {
    return true;
  }

  if (view === "pipeline") {
    return merged.includes("fallback")
      || merged.includes("provider_extract")
      || merged.includes("cloud_extract")
      || merged.includes("health_probe")
      || merged.includes("pipeline");
  }

  if (view === "crops") {
    return merged.includes("crop") || merged.includes("preprocess") || merged.includes("image");
  }

  if (view === "garbage") {
    return merged.includes("unusable") || merged.includes("garbage") || merged.includes("empty_text");
  }

  if (view === "rescans") {
    return merged.includes("retry") || merged.includes("rescan") || merged.includes("again");
  }

  if (view === "fallback") {
    return merged.includes("fallback") || merged.includes("provider_") || merged.includes("circuit");
  }

  if (view === "confidence") {
    return merged.includes("confidence") || merged.includes("score") || merged.includes("quality");
  }

  if (view === "structure") {
    return merged.includes("structure") || merged.includes("toc") || merged.includes("group");
  }

  if (view === "tokens") {
    return merged.includes("token") || merged.includes("auth") || merged.includes("provider policy");
  }

  if (view === "timings") {
    return true;
  }

  return false;
}

function buildTimingSummary(entries) {
  const groupedByTrace = new Map();
  for (const entry of entries) {
    const traceId = entry.traceId || "no-trace";
    if (!groupedByTrace.has(traceId)) {
      groupedByTrace.set(traceId, []);
    }
    groupedByTrace.get(traceId).push(entry);
  }

  const traces = [];
  for (const [traceId, traceEntries] of groupedByTrace.entries()) {
    const sorted = traceEntries.slice().sort((left, right) => left.timestampMs - right.timestampMs);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    traces.push({
      traceId,
      eventCount: sorted.length,
      startedAt: first?.timestamp ?? null,
      endedAt: last?.timestamp ?? null,
      durationMs: Math.max(0, (last?.timestampMs ?? 0) - (first?.timestampMs ?? 0)),
      startEvent: first?.message ?? null,
      endEvent: last?.message ?? null,
    });
  }

  traces.sort((left, right) => right.durationMs - left.durationMs);
  return {
    traceCount: traces.length,
    longestTraceMs: traces[0]?.durationMs ?? 0,
    traces,
  };
}

function buildOcrDebugView(view) {
  const allEntries = getOcrDebugLogEntries();
  const matchingEntries = allEntries.filter((entry) => matchesOcrView(entry, view));

  if (view === "timings") {
    return {
      view,
      generatedAt: new Date().toISOString(),
      summary: buildTimingSummary(matchingEntries),
      events: matchingEntries,
    };
  }

  return {
    view,
    generatedAt: new Date().toISOString(),
    totalEvents: matchingEntries.length,
    events: matchingEntries,
  };
}

function renderOcrDebugHtml(report) {
  const events = Array.isArray(report.events) ? report.events : [];
  const rows = events
    .map((event) => {
      const safeTimestamp = String(event.timestamp ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const safeMessage = String(event.message ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const safeSubsystem = String(event.subsystem ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const safeSeverity = String(event.severity ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const safeTraceId = String(event.traceId ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      return `<tr><td>${safeTimestamp}</td><td>${safeSubsystem}</td><td>${safeSeverity}</td><td>${safeTraceId}</td><td>${safeMessage}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CourseForge OCR Debug Export</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 20px; }
    h1 { margin-bottom: 6px; }
    .meta { color: #444; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
    th { background: #f6f6f6; }
  </style>
</head>
<body>
  <h1>CourseForge OCR Debug Export</h1>
  <p class="meta">Generated: ${report.generatedAt} | View: ${report.view}</p>
  <table>
    <thead>
      <tr><th>Timestamp</th><th>Subsystem</th><th>Severity</th><th>Trace ID</th><th>Message</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function outputOcrDebugReport(report) {
  const outputPath = parseFlag("output", "");
  const asJson = hasFlag("json") || outputPath.toLowerCase().endsWith(".json");
  const asHtml = hasFlag("html") || outputPath.toLowerCase().endsWith(".html");

  if (outputPath) {
    const resolvedOut = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    if (asHtml) {
      fs.writeFileSync(resolvedOut, renderOcrDebugHtml(report), "utf8");
    } else {
      fs.writeFileSync(resolvedOut, JSON.stringify(report, null, 2), "utf8");
    }
    console.log(`Wrote OCR debug ${asHtml ? "HTML" : "JSON"} report to ${resolvedOut}`);
    return;
  }

  if (asHtml) {
    console.log(renderOcrDebugHtml(report));
    return;
  }

  if (asJson || true) {
    console.log(JSON.stringify(report, null, 2));
  }
}

function handleOcrDebug() {
  const action = (args[2] || "trace").toLowerCase();
  const validViews = new Set(["trace", "pipeline", "crops", "garbage", "rescans", "fallback", "confidence", "structure", "tokens", "timings"]);

  if (action === "export") {
    const includeFull = hasFlag("full");
    if (includeFull) {
      const views = ["trace", "pipeline", "crops", "garbage", "rescans", "fallback", "confidence", "structure", "tokens", "timings"];
      const report = {
        view: "export",
        generatedAt: new Date().toISOString(),
        full: true,
        reports: Object.fromEntries(views.map((view) => [view, buildOcrDebugView(view)])),
      };
      outputOcrDebugReport(report);
      return;
    }

    const report = buildOcrDebugView("trace");
    outputOcrDebugReport({
      view: "export",
      generatedAt: new Date().toISOString(),
      full: false,
      report,
    });
    return;
  }

  if (!validViews.has(action)) {
    console.error("Unknown ocr debug action. Use trace, pipeline, crops, garbage, rescans, fallback, confidence, structure, tokens, timings, or export.");
    process.exit(1);
  }

  const report = buildOcrDebugView(action);
  outputOcrDebugReport(report);
}

function handleOcr() {
  const action = subcommand || "debug";
  if (action === "debug") {
    handleOcrDebug();
    return;
  }

  console.error("Unknown ocr action. Use debug.");
  process.exit(1);
}

function collectHelpTopics() {
  return {
    root: {
      command: "courseforge help",
      purpose: "Show command summaries and examples for the CourseForge CLI.",
      usage: [
        "courseforge help",
        "courseforge help <command>",
        "courseforge help <command> --examples",
        "courseforge help --all",
      ],
      flags: [
        "--all: Print details for all command groups.",
        "--examples: Print command examples only for the requested group.",
      ],
      examples: [
        "courseforge help",
        "courseforge help permissions",
        "courseforge help permissions --examples",
        "courseforge help --all",
      ],
      limitations: [
        "Help output reflects command capabilities available in scripts/program-cli.mjs.",
      ],
      requiredPermissions: ["None"],
      outputs: ["Human-readable command reference text."],
      errorCodes: ["1: Unknown help topic or invalid combination of flags."],
    },
    plugins: {
      command: "courseforge plugins",
      purpose: "Manage local plugin install state used by CourseForge debug workflows.",
      usage: [
        "courseforge plugins status",
        "courseforge plugins install <plugin-id>",
        "courseforge plugins uninstall <plugin-id>",
      ],
      flags: [],
      examples: [
        "courseforge plugins status",
        "courseforge plugins install dsc",
        "courseforge plugins uninstall dsc",
      ],
      limitations: [
        "Plugin operations currently update local plugin state; they do not download remote plugin bundles.",
      ],
      requiredPermissions: ["File system write access to local plugin state directory."],
      outputs: ["JSON output describing operation status and plugin state."],
      errorCodes: ["1: Invalid action or missing plugin id for install/uninstall."],
    },
    debug: {
      command: "courseforge debug",
      purpose: "Run debug logging, tracing, and OCR debug utilities.",
      usage: [
        "courseforge debug <feature> [flags]",
        "courseforge debug dump-log [--sourceType automatic|manual] [--output path] [--sync-cloud] [--approve-delete]",
        "courseforge debug dsc <enable|disable|report|clear>",
        "courseforge debug ocr-live --image-file <path> [--direct-cloud-provider cloud_github_models_vision|cloud_openai_vision] [--github-rate-limit-retry-cycles <n>]",
      ],
      flags: [
        "--severity info|warn|error",
        "--sourceType automatic|manual",
        "--message <text>",
        "--errorContext <text>",
        "--stack <text>",
        "--github-batch-size <n>, --github-batch-cooldown-seconds <n>, --github-max-cooldown-seconds <n>",
        "--github-inter-request-delay-ms <n>, --github-rate-limit-retry-cycles <n>",
      ],
      examples: [
        "courseforge debug auth-trace --event redirect-resolve-error --provider microsoft",
        "courseforge debug dump-log --sourceType automatic --output tmp-smoke/debug-log.json",
        "courseforge debug dsc report --page settings --card \"Debug Log\"",
        "courseforge debug ocr-live --image-file tmp-smoke/samples/toc__example__expected.png --output tmp-smoke/ocr-debug.json",
        "courseforge debug ocr-live --image-file tmp-smoke/samples/ocr__toc-spread-view__expect-parse-success.png --direct-cloud-provider cloud_github_models_vision --github-rate-limit-retry-cycles 2",
      ],
      limitations: [
        "debug ocr-live delegates to scripts/ocr-live-debug.ts and requires project dependencies.",
        "When direct GitHub cloud mode is used, CLI applies batch throttling and prints text countdown timers during cooldown windows.",
      ],
      requiredPermissions: [
        "File system access for local debug log reads/writes.",
        "Network access if sync-cloud or cloud OCR providers are used.",
      ],
      outputs: [
        "Text status for enable/disable/clear operations.",
        "JSON output for dump-log and dsc report.",
      ],
      errorCodes: ["1: Missing subcommand or debug logging disabled for write operations."],
    },
    permissions: {
      command: "courseforge permissions",
      purpose: "Audit and repair OCR permission prerequisites with safe dry-run defaults.",
      usage: [
        "courseforge permissions audit [--json] [--bundle-id <id>]",
        "courseforge permissions repair [--json] [--apply]",
        "courseforge permissions reset [--json] [--bundle-id <id>] [--apply]",
      ],
      flags: [
        "--json: Emit machine-readable JSON output.",
        "--apply: Execute changes; without this flag commands run in dry-run mode.",
        "--bundle-id <id>: App bundle id used for tccutil reset commands (macOS only).",
      ],
      examples: [
        "courseforge permissions audit --json",
        "courseforge permissions repair",
        "courseforge permissions repair --apply",
        "courseforge permissions reset --bundle-id com.ronaldarroyowatson.CourseForge",
      ],
      limitations: [
        "Direct screen/accessibility grant state cannot be read reliably from CLI without elevated host access.",
        "repair and reset apply-mode actions are macOS-oriented and run installer/tccutil commands.",
      ],
      requiredPermissions: [
        "Installer script execution permission for repair --apply.",
        "tccutil availability for reset --apply on macOS.",
      ],
      outputs: [
        "Human-readable audit/plan output by default.",
        "JSON audit and operation results when --json is specified.",
      ],
      errorCodes: [
        "1: Unsupported action or apply-mode execution failure.",
      ],
    },
    ocr: {
      command: "courseforge ocr",
      purpose: "Inspect OCR diagnostics, fallback chains, timings, and exports.",
      usage: [
        "courseforge ocr debug trace [--json]",
        "courseforge ocr debug pipeline [--json]",
        "courseforge ocr debug crops [--json]",
        "courseforge ocr debug garbage [--json]",
        "courseforge ocr debug rescans [--json]",
        "courseforge ocr debug fallback [--json]",
        "courseforge ocr debug confidence [--json]",
        "courseforge ocr debug structure [--json]",
        "courseforge ocr debug tokens [--json]",
        "courseforge ocr debug timings [--json]",
        "courseforge ocr debug export [--full] [--json|--html] [--output path]",
      ],
      flags: [
        "--json: emit JSON payload for automation.",
        "--html: emit HTML export view.",
        "--full: include all OCR debug views in export mode.",
        "--output <path>: write report artifact to file.",
      ],
      examples: [
        "courseforge ocr debug trace --json",
        "courseforge ocr debug fallback --json",
        "courseforge ocr debug timings --json",
        "courseforge ocr debug export --full --json --output tmp-smoke/ocr-debug-full.json",
        "courseforge ocr debug export --html --output tmp-smoke/ocr-debug.html",
      ],
      limitations: [
        "This command introspects locally persisted debug entries; it does not replay OCR extraction by itself.",
      ],
      requiredPermissions: [
        "Local debug log read access.",
        "File write access when using --output.",
      ],
      outputs: [
        "JSON payloads for trace, pipeline, fallback, timings, and related views.",
        "Optional HTML export artifact.",
      ],
      errorCodes: [
        "1: Unknown OCR action or debug view.",
      ],
    },
    textbooks: {
      command: "courseforge textbooks",
      purpose: "Run textbook workflow parity commands used by GUI setup and save flows.",
      usage: [
        "courseforge textbooks status",
        "courseforge textbooks mode --mode auto|manual|choose",
        "courseforge textbooks isbn lookup --isbn <value>",
        "courseforge textbooks save --title <title> --isbn <value>",
        "courseforge textbooks edit cancel --textbookId <id>",
        "courseforge textbooks select --textbookId <id>",
        "courseforge textbooks sections continue --textbookId <id>",
        "courseforge textbooks favorite toggle --textbookId <id> --isFavorite <true|false>",
        "courseforge textbooks archive toggle --textbookId <id> --isArchived <true|false>",
        "courseforge textbooks sync retry --textbookId <id>",
        "courseforge textbooks cover recover --textbookId <id>",
        "courseforge textbooks delete --textbookId <id> --retentionMs <ms>",
        "courseforge textbooks auto capture <cover|title|title add-shot|toc>",
        "courseforge textbooks auto toc <merge|split> chapter --chapterIndex <index>",
        "courseforge textbooks auto save setup --title <title> --chapterCount <n> --hasCover <true|false>",
      ],
      flags: [
        "--mode: textbook setup mode.",
        "--isbn: ISBN string for lookup or save context.",
        "--title: textbook title for save context.",
        "--textbookId: textbook id for edit-context commands.",
        "--isFavorite, --isArchived: desired textbook toggle state.",
        "--retentionMs: recycle-bin retention duration in milliseconds.",
        "--chapterIndex: target chapter index for TOC merge/split actions.",
        "--chapterCount, --hasCover: auto-save capture context.",
      ],
      examples: [
        "courseforge textbooks mode --mode auto",
        "courseforge textbooks isbn lookup --isbn 9780134685991",
        "courseforge textbooks save --title \"Biology\" --isbn 9780134685991",
        "courseforge textbooks favorite toggle --textbookId textbook-123 --isFavorite true",
        "courseforge textbooks sync retry --textbookId textbook-123",
        "courseforge textbooks auto capture toc",
        "courseforge textbooks auto save setup --title \"Biology\" --chapterCount 12 --hasCover true",
      ],
      limitations: [
        "These commands emit structured workflow records and command traces for parity orchestration.",
      ],
      requiredPermissions: ["Local workflow command log write access."],
      outputs: ["JSON command receipt payload."],
      errorCodes: ["1: Unknown textbooks action."],
    },
    admin: {
      command: "courseforge admin",
      purpose: "Run admin workflow parity commands for moderation, content, debug policy, and premium actions.",
      usage: [
        "courseforge admin status",
        "courseforge admin moderation <refresh|approve|reject|archive> [--docPath path]",
        "courseforge admin content <search|update|archive|delete> [flags]",
        "courseforge admin debug-policy <refresh|save> [flags]",
        "courseforge admin premium <refresh|action> [--uid <id>]",
        "courseforge admin corrections review <refresh|bulk|single> [flags]",
        "courseforge admin translations review <refresh|approve|edit|regenerate|history|glossary> [flags]",
        "courseforge admin translations memory <refresh|override|reset> [flags]",
        "courseforge admin translations roadmap refresh",
        "courseforge admin glossary <refresh|save|delete> [flags]",
        "courseforge admin school <refresh|invite|remove-user|textbook deletion toggle|promotion request> [flags]",
        "courseforge admin super <dashboard refresh|ai policy save|ai user override save|backup config save|backup run|promotion resolve|user admin toggle|user superadmin toggle> [flags]",
        "courseforge admin users <refresh|admin toggle|content block toggle> [flags]",
      ],
      flags: [
        "--docPath: document path for moderation/content actions.",
        "--uid: target user id for premium actions.",
        "--collectionName, --title, --isbn, --ownerEmail: content search filters.",
        "--recordId, --count: correction review context.",
        "--id, --language, --termId: translation review context.",
        "--subject, --sourceLanguage, --targetLanguage: glossary and translation memory filters.",
        "--schoolId, --inviteEmail, --uid, --textbookId, --isDeleted: school admin context.",
        "--requestId, --approve, --transferToUid: super-admin workflow context.",
        "--isAdmin, --isSuperAdmin, --isContentBlocked: role and content access toggles.",
      ],
      examples: [
        "courseforge admin moderation approve --docPath textbooks/abc123",
        "courseforge admin content search --collectionName textbooks --title Biology",
        "courseforge admin premium action --uid user-123",
        "courseforge admin corrections review single --recordId correction-123",
        "courseforge admin translations review approve --language es --termId mitosis",
        "courseforge admin translations memory override --language es --termId mitosis",
        "courseforge admin glossary save --subject biology --sourceLanguage en --targetLanguage es",
        "courseforge admin school invite --schoolId school-1 --inviteEmail teacher@school.edu",
        "courseforge admin school textbook deletion toggle --schoolId school-1 --textbookId textbook-1 --isDeleted true",
        "courseforge admin super ai policy save",
        "courseforge admin users admin toggle --uid user-123 --isAdmin true",
      ],
      limitations: [
        "These commands emit structured workflow records and command traces for parity orchestration.",
      ],
      requiredPermissions: ["Local workflow command log write access."],
      outputs: ["JSON command receipt payload."],
      errorCodes: ["1: Unknown admin action."],
    },
    settings: {
      command: "courseforge settings",
      purpose: "Run settings workflow parity commands for language, accessibility, debug, and OCR policy actions.",
      usage: [
        "courseforge settings status",
        "courseforge settings language set --language en",
        "courseforge settings accessibility patch [flags]",
        "courseforge settings debug <enable|disable|clear>",
        "courseforge settings ocr <status|primary|secondary|policy-load|policy-save> [flags]",
        "courseforge settings plugin dsc <install|uninstall>",
        "courseforge settings school affiliation save --schoolName <name> [--schoolId id]",
        "courseforge settings auth signout",
        "courseforge settings updater check",
        "courseforge settings design <save|cloud load|cloud decision <value>|local delete-corrupted|local repair>",
        "courseforge settings metadata sharing toggle --enabled <true|false>",
      ],
      flags: [
        "--language: language code to set.",
        "--fontScale, --uiScale, --highContrastMode: accessibility patch fields.",
        "--providerId, --providerOrder: OCR policy context.",
        "--schoolName, --schoolId: school affiliation context.",
        "--decision: cloud decision option for design settings.",
        "--enabled: metadata sharing toggle value.",
      ],
      examples: [
        "courseforge settings language set --language es",
        "courseforge settings debug clear",
        "courseforge settings ocr policy-save --providerOrder cloud_openai_vision,cloud_github_models_vision,local_tesseract",
        "courseforge settings plugin dsc install",
        "courseforge settings updater check",
        "courseforge settings design cloud decision apply-cloud",
        "courseforge settings metadata sharing toggle --enabled true",
      ],
      limitations: [
        "These commands emit structured workflow records and command traces for parity orchestration.",
      ],
      requiredPermissions: ["Local workflow command log write access."],
      outputs: ["JSON command receipt payload."],
      errorCodes: ["1: Unknown settings action."],
    },
  };
}

function printHelpTopic(topic, { examplesOnly = false } = {}) {
  console.log(`${topic.command}`);
  if (!examplesOnly) {
    console.log(`Purpose: ${topic.purpose}`);
    console.log("Usage:");
    for (const item of topic.usage) {
      console.log(`  - ${item}`);
    }
    if (topic.flags.length) {
      console.log("Flags:");
      for (const item of topic.flags) {
        console.log(`  - ${item}`);
      }
    }
  }
  console.log("Examples:");
  for (const item of topic.examples) {
    console.log(`  - ${item}`);
  }
  if (!examplesOnly) {
    console.log("Limitations:");
    for (const item of topic.limitations) {
      console.log(`  - ${item}`);
    }
    console.log("Required permissions:");
    for (const item of topic.requiredPermissions) {
      console.log(`  - ${item}`);
    }
    console.log("Expected outputs:");
    for (const item of topic.outputs) {
      console.log(`  - ${item}`);
    }
    console.log("Error codes:");
    for (const item of topic.errorCodes) {
      console.log(`  - ${item}`);
    }
  }
}

function handleHelp() {
  const topics = collectHelpTopics();
  const topicNames = Object.keys(topics).filter((key) => key !== "root");
  const showAll = hasFlag("all");
  const examplesOnly = hasFlag("examples");
  const requestedTopic = args
    .slice(1)
    .filter((value) => !value.startsWith("--"))
    .join(" ")
    .trim()
    .toLowerCase();

  if (showAll) {
    if (requestedTopic) {
      console.error("Do not pass a topic when using --all.");
      process.exit(1);
    }
    printHelpTopic(topics.root, { examplesOnly: false });
    for (const topicName of topicNames) {
      console.log("");
      printHelpTopic(topics[topicName], { examplesOnly });
    }
    return;
  }

  if (!requestedTopic) {
    printHelpTopic(topics.root, { examplesOnly: false });
    console.log("");
    console.log("Command groups:");
    for (const topicName of topicNames) {
      console.log(`  - ${topicName}`);
    }
    return;
  }

  if (!topics[requestedTopic]) {
    console.error(`Unknown help topic: ${requestedTopic}`);
    process.exit(1);
  }

  printHelpTopic(topics[requestedTopic], { examplesOnly });
}

function commandExists(name) {
  const check = spawnSync("sh", ["-lc", `command -v ${name} >/dev/null 2>&1`], { encoding: "utf8" });
  return (check.status ?? 1) === 0;
}

function runCommand(commandName, commandArgs = []) {
  return spawnSync(commandName, commandArgs, { encoding: "utf8" });
}

function getDefaultCourseForgeBundleId() {
  const envOverride = (process.env.COURSEFORGE_BUNDLE_ID || "").trim();
  if (envOverride) {
    return envOverride;
  }

  const fallbackBundleId = "com.ronaldarroyowatson.CourseForge";
  if (process.platform !== "darwin") {
    return fallbackBundleId;
  }

  const appCandidates = [
    "/Applications/CourseForge.app",
    path.join(process.env.HOME || "", "Applications", "CourseForge.app"),
  ];

  for (const appPath of appCandidates) {
    if (!appPath || !fs.existsSync(appPath)) {
      continue;
    }

    const infoPlistPath = path.join(appPath, "Contents", "Info");
    const read = runCommand("defaults", ["read", infoPlistPath, "CFBundleIdentifier"]);
    const detected = (read.stdout || "").trim();
    if ((read.status ?? 1) === 0 && detected) {
      return detected;
    }
  }

  return fallbackBundleId;
}

function collectPermissionsAudit() {
  const platform = process.platform;
  const bundleId = parseFlag("bundle-id", getDefaultCourseForgeBundleId());
  const installScript = path.join(process.cwd(), "scripts", "installer", "Install-CourseForge-macos.sh");
  const uninstallScript = path.join(process.cwd(), "scripts", "installer", "Uninstall-CourseForge-macos.sh");
  const tccutilAvailable = commandExists("tccutil");
  const securityAvailable = commandExists("security");

  let fileSystemWriteOk = false;
  let fileSystemWriteError = null;
  try {
    ensureDir();
    const probePath = path.join(baseDir, "permission-write-probe.tmp");
    fs.writeFileSync(probePath, `probe:${Date.now()}`, "utf8");
    fs.unlinkSync(probePath);
    fileSystemWriteOk = true;
  } catch (error) {
    fileSystemWriteError = error instanceof Error ? error.message : "unknown_fs_write_error";
  }

  return {
    timestamp: new Date().toISOString(),
    platform,
    bundleId,
    checks: {
      screenCapture: {
        status: platform === "darwin" ? "requires-manual-verification" : "not-applicable",
        details: platform === "darwin"
          ? "macOS screen capture permission must be confirmed via System Settings prompt flow."
          : "Screen capture audit currently targets macOS permission flow.",
        tccutilAvailable,
      },
      accessibility: {
        status: platform === "darwin" ? "requires-manual-verification" : "not-applicable",
        details: platform === "darwin"
          ? "Accessibility permission must be confirmed via System Settings prompt flow."
          : "Accessibility audit currently targets macOS permission flow.",
        tccutilAvailable,
      },
      fileSystem: {
        status: fileSystemWriteOk ? "ok" : "failed",
        writableDebugDirectory: fileSystemWriteOk,
        error: fileSystemWriteError,
      },
      localOcr: {
        status: fs.existsSync(path.join(process.cwd(), "node_modules", "tesseract.js", "package.json")) ? "ok" : "warning",
        tesseractJsInstalled: fs.existsSync(path.join(process.cwd(), "node_modules", "tesseract.js", "package.json")),
      },
      cloudOcrTokens: {
        status: (Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.COURSEFORGE_GITHUB_TOKEN) || Boolean(process.env.GITHUB_TOKEN)) ? "ok" : "warning",
        OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
        COURSEFORGE_GITHUB_TOKEN: Boolean(process.env.COURSEFORGE_GITHUB_TOKEN),
        GITHUB_TOKEN: Boolean(process.env.GITHUB_TOKEN),
        keychainCommandAvailable: securityAvailable,
      },
      installerScripts: {
        status: platform === "darwin"
          ? (fs.existsSync(installScript) && fs.existsSync(uninstallScript) ? "ok" : "failed")
          : "not-applicable",
        installScriptExists: fs.existsSync(installScript),
        uninstallScriptExists: fs.existsSync(uninstallScript),
        installScript,
        uninstallScript,
      },
    },
    guidance: {
      audit: [
        "Run courseforge permissions audit --json to capture machine-readable status.",
        "If screen capture/accessibility prompts did not appear, run repair and relaunch packaged app.",
      ],
      repair: [
        "courseforge permissions repair --apply",
      ],
      reset: [
        `courseforge permissions reset --bundle-id ${bundleId} --apply`,
      ],
    },
  };
}

function printPermissionsAuditHuman(audit) {
  console.log("CourseForge permissions audit");
  console.log(`platform: ${audit.platform}`);
  console.log(`bundleId: ${audit.bundleId}`);
  console.log("checks:");
  for (const [name, value] of Object.entries(audit.checks)) {
    console.log(`  - ${name}: ${value.status}`);
  }
  console.log("next:");
  console.log("  - courseforge permissions repair --apply");
  console.log(`  - courseforge permissions reset --bundle-id ${audit.bundleId} --apply`);
}

function handlePermissionsRepair() {
  const emitJson = hasFlag("json");
  const apply = hasAnyFlag(["apply", "yes"]);
  const platform = process.platform;
  const installScript = path.join(process.cwd(), "scripts", "installer", "Install-CourseForge-macos.sh");
  const uninstallScript = path.join(process.cwd(), "scripts", "installer", "Uninstall-CourseForge-macos.sh");

  const result = {
    timestamp: new Date().toISOString(),
    action: "repair",
    platform,
    dryRun: !apply,
    supported: platform === "darwin",
    steps: [
      { step: "uninstall", script: uninstallScript, exists: fs.existsSync(uninstallScript) },
      { step: "install", script: installScript, exists: fs.existsSync(installScript) },
    ],
    applied: false,
    ok: true,
  };

  if (platform !== "darwin") {
    result.ok = false;
    result.error = "permissions repair apply-mode is currently supported on macOS only";
    if (emitJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(result.error);
    }
    process.exit(1);
  }

  if (!apply) {
    if (emitJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("permissions repair dry-run");
      console.log(`  - uninstall script: ${uninstallScript}`);
      console.log(`  - install script: ${installScript}`);
      console.log("re-run with --apply to execute uninstall/install sequence.");
    }
    return;
  }

  if (!fs.existsSync(uninstallScript) || !fs.existsSync(installScript)) {
    result.ok = false;
    result.error = "Required macOS installer scripts are missing.";
    if (emitJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(result.error);
    }
    process.exit(1);
  }

  const uninstallRun = runCommand("bash", [uninstallScript]);
  const installRun = runCommand("bash", [installScript]);
  result.applied = true;
  result.uninstallExitCode = uninstallRun.status;
  result.installExitCode = installRun.status;
  result.ok = (uninstallRun.status ?? 1) === 0 && (installRun.status ?? 1) === 0;

  if (emitJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`repair uninstall exit code: ${String(uninstallRun.status)}`);
    console.log(`repair install exit code: ${String(installRun.status)}`);
  }

  if (!result.ok) {
    process.exit(1);
  }
}

function handlePermissionsReset() {
  const emitJson = hasFlag("json");
  const apply = hasAnyFlag(["apply", "yes"]);
  const platform = process.platform;
  const bundleId = parseFlag("bundle-id", getDefaultCourseForgeBundleId());
  const commands = [
    ["tccutil", ["reset", "ScreenCapture", bundleId]],
    ["tccutil", ["reset", "Accessibility", bundleId]],
  ];

  const result = {
    timestamp: new Date().toISOString(),
    action: "reset",
    platform,
    bundleId,
    dryRun: !apply,
    commands: commands.map(([name, cmdArgs]) => `${name} ${cmdArgs.join(" ")}`),
    applied: false,
    ok: true,
  };

  if (platform !== "darwin") {
    result.ok = false;
    result.error = "permissions reset apply-mode is currently supported on macOS only";
    if (emitJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(result.error);
    }
    process.exit(1);
  }

  if (!apply) {
    if (emitJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("permissions reset dry-run");
      for (const commandLine of result.commands) {
        console.log(`  - ${commandLine}`);
      }
      console.log("re-run with --apply to execute permission reset commands.");
    }
    return;
  }

  const runs = commands.map(([name, cmdArgs]) => {
    const run = runCommand(name, cmdArgs);
    return {
      command: `${name} ${cmdArgs.join(" ")}`,
      exitCode: run.status,
      stdout: (run.stdout || "").trim(),
      stderr: (run.stderr || "").trim(),
    };
  });

  result.applied = true;
  result.runs = runs;
  result.ok = runs.every((run) => (run.exitCode ?? 1) === 0);

  if (emitJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const run of runs) {
      console.log(`${run.command} => ${String(run.exitCode)}`);
    }
  }

  if (!result.ok) {
    process.exit(1);
  }
}

function handlePermissions() {
  const action = subcommand || "audit";
  if (action === "audit") {
    const audit = collectPermissionsAudit();
    if (hasFlag("json")) {
      console.log(JSON.stringify(audit, null, 2));
    } else {
      printPermissionsAuditHuman(audit);
    }
    return;
  }

  if (action === "repair") {
    handlePermissionsRepair();
    return;
  }

  if (action === "reset") {
    handlePermissionsReset();
    return;
  }

  console.error("Unknown permissions action. Use audit, repair, or reset.");
  process.exit(1);
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
  console.log("  courseforge login [--role guest|student|teacher|schoolAdmin|districtAdmin|superAdmin] [--uid id] [--email email]");
  console.log("  courseforge logout");
  console.log("  courseforge whoami");
  console.log("  courseforge auth <status|refresh|token-info>");
  console.log("  courseforge help [<command>] [--examples|--all]");
  console.log("  courseforge textbooks <status|mode|isbn|save|edit> [...]");
  console.log("  courseforge admin <status|moderation|content|debug-policy|premium> [...]");
  console.log("  courseforge settings <status|language|accessibility|debug|ocr> [...]");
  console.log("  courseforge permissions <audit|repair|reset> [--json] [--apply]");
  console.log("  courseforge ocr debug <trace|pipeline|crops|garbage|rescans|fallback|confidence|structure|tokens|timings|export> [--json|--html] [--output path]");
  console.log("  courseforge plugins <install|uninstall|status> [plugin-id]");
  console.log("  courseforge debug <feature> [flags]  (alias: npm run courseforge -- debug ...)");
  console.log("  program debug <feature> [--severity info|warn|error] [--sourceType automatic|manual] [--message text]");
  console.log("  program debug auth-trace [--event redirect-resolve-error] [--provider microsoft] [--message text] [--severity info|warn|error]");
  console.log("  program debug dsc <enable|disable|report|clear> [--page settings] [--card \"Debug Log\"] [--report path]");
  console.log("  program debug dump-log [--sourceType automatic|manual] [--output path] [--sync-cloud] [--approve-delete]");
  console.log("  program debug ocr-live --image-file path [--gold-transcript-file path] [--output path]");
  console.log("  program debug clear-log");
  console.log("  program debug enable");
  console.log("  program debug disable");
}

function handleAuthTrace() {
  const event = parseFlag("event", "redirect-attempt");
  const provider = parseFlag("provider", "microsoft");
  const code = parseFlag("code", "n/a");
  const message = parseFlag("message", `Auth redirect trace: ${event} (${provider})`);

  const config = readConfig();
  if (!config.enabled) {
    console.error("Debug logging is disabled. Use: program debug enable");
    process.exit(1);
  }

  rotateLogs(config);

  const entry = {
    timestamp: new Date().toISOString(),
    subsystem: "auth-redirect",
    severity: parseFlag("severity", "info").toLowerCase(),
    sourceType: normalizeSourceType(parseFlag("sourceType", "automatic")),
    sourceKind: parseFlag("sourceKind", "automatic").toLowerCase(),
    message,
    errorContext: parseFlag("errorContext", `${event}; provider=${provider}; code=${code}`),
    stackTrace: parseFlag("stack", "") || null,
  };

  ensureDir();
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  trimIfOversized(config);
  console.log(`Logged auth redirect trace to ${logPath}`);
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
  const themeMode = String(parseFlag("theme", "light")).toLowerCase() === "dark" ? "dark" : "light";
  const backgroundColor = "#FFFFFF";

  const tokens = Object.entries(authoritativeSemanticPalette).reduce((accumulator, [token, value]) => {
    const fallbackChain = dscFallbacks[token];
    accumulator[token] = {
      expectedValue: value,
      resolvedValue: value,
      source: fallbackChain[0],
      status: "resolved",
      fallbackChain,
      usedFallback: false,
      usedLegacyWhitelist: false,
    };
    return accumulator;
  }, {});

  const tokenResolution = Object.entries(tokens).map(([semanticRole, token]) => ({
    semanticRole,
    requestedToken: token.fallbackChain[0],
    resolvedToken: token.source,
    computedColor: token.resolvedValue,
    fallbackChain: token.fallbackChain,
    reasonForFallback: token.usedFallback ? `fallback:${token.source}` : "resolved-direct",
    themeMode,
    componentName: card.label,
    componentState: "default",
    contrastAgainstBackground: backgroundColor,
    contrastIsAcceptable: true,
    isLegacyColorError: token.resolvedValue.toUpperCase() === "#0C3183",
    isMismatch: token.resolvedValue !== token.expectedValue,
    cascadingFailureRisk: token.usedFallback,
  }));

  const mismatches = tokenResolution
    .filter((entry) => entry.isMismatch && !entry.isLegacyColorError)
    .map((entry) => ({
      token: entry.semanticRole,
      actual: entry.computedColor,
      expected: authoritativeSemanticPalette[entry.semanticRole],
      whitelisted: false,
    }));

  const uiIntrospection = {
    pageId: page.id,
    cardId: card.id,
    cardType: "settings-card",
    recipeName: `settings.${card.id}`,
    expectedTokenSet: authoritativeSemanticPalette,
    actualTokenSet: Object.fromEntries(Object.entries(tokens).map(([token, value]) => [token, value.resolvedValue])),
    backgroundColor: "var(--bg-panel)",
    borderColor: "var(--border-default)",
    titleTextColor: "var(--text-primary)",
    bodyTextColor: "var(--text-secondary)",
    buttonTypes: ["primary", "secondary", "danger"],
    buttonTokenSets: {
      primary: { semantic: "MAJOR", resolvedColor: authoritativeSemanticPalette.MAJOR },
      secondary: { semantic: "MINOR", resolvedColor: authoritativeSemanticPalette.MINOR },
      danger: { semantic: "ERROR", resolvedColor: authoritativeSemanticPalette.ERROR },
    },
    fallbacksUsed: tokenResolution.filter((entry) => entry.cascadingFailureRisk).map((entry) => entry.semanticRole),
    mismatches,
    legacyColors: tokenResolution.filter((entry) => entry.isLegacyColorError).map((entry) => entry.computedColor),
  };

  const riskReasons = [];
  if (tokenResolution.some((entry) => entry.isLegacyColorError)) {
    riskReasons.push("Legacy color detected in active token output.");
  }
  if (tokenResolution.some((entry) => entry.isMismatch)) {
    riskReasons.push("Semantic token mismatch detected.");
  }
  if (tokenResolution.some((entry) => entry.cascadingFailureRisk)) {
    riskReasons.push("Fallback chain was triggered.");
  }

  return {
    generatedAt: new Date().toISOString(),
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
    tokenResolution,
    uiIntrospection,
    mismatches,
    legacyColorMatches: tokenResolution.filter((entry) => entry.isLegacyColorError),
    cascadingFailureRisk: {
      level: riskReasons.length === 0 ? "none" : "high",
      summary: riskReasons.length === 0 ? "No cascading token failures detected." : riskReasons.join(" "),
      impactedTokens: tokenResolution.filter((entry) => entry.cascadingFailureRisk || entry.isMismatch).map((entry) => entry.semanticRole),
    },
    cascadingFailureDetector: {
      hasRisk: riskReasons.length > 0,
      reasons: riskReasons,
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

  console.log(JSON.stringify(report));
}

if (command === "plugins") {
  enforceAuthorizationOrExit(command);
  handlePlugins();
  process.exit(0);
}

if (command === "login") {
  handleLoginCommand();
  process.exit(0);
}

if (command === "logout") {
  handleLogoutCommand();
  process.exit(0);
}

if (command === "whoami") {
  handleWhoAmICommand();
  process.exit(0);
}

if (command === "auth") {
  handleAuthCommand();
  process.exit(0);
}

if (command === "help") {
  handleHelp();
  process.exit(0);
}

if (command === "permissions") {
  handlePermissions();
  process.exit(0);
}

if (command === "textbooks") {
  enforceAuthorizationOrExit(command);
  handleTextbooks();
  process.exit(0);
}

if (command === "admin") {
  enforceAuthorizationOrExit(command);
  handleAdmin();
  process.exit(0);
}

if (command === "settings") {
  enforceAuthorizationOrExit(command);
  handleSettings();
  process.exit(0);
}

if (command === "ocr") {
  enforceAuthorizationOrExit(command);
  handleOcr();
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

enforceAuthorizationOrExit(command);

if (subcommand === "dump-log") {
  dumpLog();
  process.exit(0);
}

if (subcommand === "dsc") {
  handleDsc();
  process.exit(0);
}

if (subcommand === "ocr-live") {
  const { spawnSync } = await import("node:child_process");
  const child = spawnSync(
    "npx",
    ["tsx", "scripts/ocr-live-debug.ts", ...args.slice(2)],
    { stdio: "inherit" }
  );

  process.exit(child.status ?? 1);
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

if (subcommand === "auth-trace") {
  handleAuthTrace();
  process.exit(0);
}

appendDebugEntry(subcommand);

/**
 * CourseForge Local Server
 * Simple HTTP server to serve the CourseForge webapp locally
 * 
 * Usage: node courseforge-serve.js [webapp_path] [port]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");
const crypto = require("crypto");

// Get webapp path from argument or default
const webappPath = process.argv[2] || process.cwd();
const portArg = process.argv[3];
const defaultPort = 3000;
const requestedHost = process.argv[4] || "127.0.0.1";
const enforceLoopbackHost = String(process.env.COURSEFORGE_ENFORCE_LOOPBACK_HOST || "1") === "1";
const enforceLoopbackClients = String(process.env.COURSEFORGE_ENFORCE_LOOPBACK_CLIENTS || "1") === "1";
const defaultLatestReleaseEndpoint = "https://api.github.com/repos/ronaldarroyowatson/CourseForge/releases/latest";
const heartbeatTimeoutMs = Math.max(15000, Number(process.env.COURSEFORGE_HEARTBEAT_TIMEOUT_MS || 45000));
const latestReleaseRequestTimeoutMs = Math.max(8000, Number(process.env.COURSEFORGE_UPDATE_CHECK_TIMEOUT_MS || 15000));
const latestReleaseMaxAttempts = Math.max(1, Number(process.env.COURSEFORGE_UPDATE_CHECK_RETRIES || 2));

// Package root is one level above the webapp folder.
// pending-update.json is written here by the updater.
const packageRoot = path.dirname(webappPath);
const updaterLogPath = path.join(packageRoot, "updater.log");
const ocrDebugLogPath = path.join(packageRoot, "ocr-debug.log");
const updaterCheckPath = path.join(packageRoot, "updater-check.json");
const textbookUploadRootPath = path.join(packageRoot, "textbook-upload-store");
const textbookUploadStatePath = path.join(textbookUploadRootPath, "state.json");
const textbookUploadActivePath = path.join(textbookUploadRootPath, "active");
const textbookUploadCommittedPath = path.join(textbookUploadRootPath, "committed");
const textbookUploadQuarantinePath = path.join(textbookUploadRootPath, "quarantine");
const textbookUploadQuarantineRetentionMs = Math.max(60 * 1000, Number(process.env.COURSEFORGE_UPLOAD_QUARANTINE_RETENTION_MS || (6 * 60 * 60 * 1000)));
const textbookUploadLoopBlockThreshold = Math.max(2, Number(process.env.COURSEFORGE_UPLOAD_LOOP_BLOCK_THRESHOLD || 3));
let manualStageProcess = null;
let hasActiveHeartbeat = false;
let lastHeartbeatAt = 0;

function isLoopbackHostName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function resolveHostBinding(value) {
  if (!enforceLoopbackHost) {
    return value;
  }

  return isLoopbackHostName(value) ? value : "127.0.0.1";
}

const host = resolveHostBinding(requestedHost);

function isLoopbackClientAddress(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "::ffff:127.0.0.1"
    || normalized === "localhost";
}

function applyResponseSecurityHeaders(req, res, finalPort) {
  const originHeader = req.headers.origin;
  const allowedOrigins = new Set([
    `http://127.0.0.1:${finalPort}`,
    `http://localhost:${finalPort}`,
    `http://[::1]:${finalPort}`,
  ]);

  if (typeof originHeader === "string" && allowedOrigins.has(originHeader)) {
    res.setHeader("Access-Control-Allow-Origin", originHeader);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function writeUpdaterLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    fs.appendFileSync(updaterLogPath, `${line}\n`, "utf8");
  } catch (error) {
    console.error("[CourseForge server] Failed to append updater log entry:", error);
  }
}

function appendOcrDebugLog(entry) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  try {
    fs.appendFileSync(ocrDebugLogPath, `${line}\n`, "utf8");
  } catch (error) {
    console.error("[CourseForge server] Failed to append OCR debug log entry:", error);
  }
}

async function readJsonRequestBody(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error("request-body-too-large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("request-body-invalid-json"));
      }
    });

    req.on("error", reject);
  });
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`[CourseForge server] Failed to read JSON file ${filePath}:`, error);
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.error(`[CourseForge server] Failed to write JSON file ${filePath}:`, error);
  }
}

function tailFileLines(filePath, maxLines) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const text = fs.readFileSync(filePath, "utf8");
    if (!text) {
      return [];
    }

    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= maxLines) {
      return lines;
    }

    return lines.slice(lines.length - maxLines);
  } catch (error) {
    console.error(`[CourseForge server] Failed to tail file ${filePath}:`, error);
    return [];
  }
}

function ensureDirectory(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    console.error(`[CourseForge server] Failed to ensure directory ${dirPath}:`, error);
  }
}

function safeRemovePath(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (error) {
    console.error(`[CourseForge server] Failed to remove path ${targetPath}:`, error);
  }
}

function safeMovePath(sourcePath, destinationPath) {
  try {
    ensureDirectory(path.dirname(destinationPath));
    fs.renameSync(sourcePath, destinationPath);
    return true;
  } catch {
    try {
      fs.cpSync(sourcePath, destinationPath, { recursive: true, force: true });
      safeRemovePath(sourcePath);
      return true;
    } catch (error) {
      console.error(`[CourseForge server] Failed to move ${sourcePath} to ${destinationPath}:`, error);
      return false;
    }
  }
}

function ensureTextbookUploadStorage() {
  ensureDirectory(textbookUploadRootPath);
  ensureDirectory(textbookUploadActivePath);
  ensureDirectory(textbookUploadCommittedPath);
  ensureDirectory(textbookUploadQuarantinePath);
}

function createDefaultTextbookUploadState() {
  return {
    updatedAt: new Date(0).toISOString(),
    corruptedTextbookIds: {},
    quarantineIndex: [],
    loopGuards: {},
  };
}

function readTextbookUploadState() {
  ensureTextbookUploadStorage();
  const fallback = createDefaultTextbookUploadState();
  const parsed = readJsonFile(textbookUploadStatePath);
  if (!parsed || typeof parsed !== "object") {
    return fallback;
  }

  return {
    ...fallback,
    ...parsed,
    corruptedTextbookIds: typeof parsed.corruptedTextbookIds === "object" && parsed.corruptedTextbookIds !== null
      ? parsed.corruptedTextbookIds
      : {},
    quarantineIndex: Array.isArray(parsed.quarantineIndex) ? parsed.quarantineIndex : [],
    loopGuards: typeof parsed.loopGuards === "object" && parsed.loopGuards !== null
      ? parsed.loopGuards
      : {},
  };
}

function writeTextbookUploadState(state) {
  ensureTextbookUploadStorage();
  writeJsonFile(textbookUploadStatePath, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
}

function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortObject(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const keys = Object.keys(value).sort();
  const result = {};
  for (const key of keys) {
    result[key] = stableSortObject(value[key]);
  }
  return result;
}

function computePayloadHash(payload) {
  try {
    const normalized = JSON.stringify(stableSortObject(payload));
    return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
  } catch {
    return null;
  }
}

function makeStructuredUploadError(code, message, statusCode, details = {}) {
  return { code, message, statusCode, details };
}

function isPositiveFiniteInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function validateTextbookUploadPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return makeStructuredUploadError("INVALID_PAYLOAD", "Upload payload must be a JSON object.", 422);
  }

  const textbookId = typeof payload.textbookId === "string" ? payload.textbookId.trim() : "";
  const uploadSessionId = typeof payload.uploadSessionId === "string" ? payload.uploadSessionId.trim() : "";
  const clientId = typeof payload.clientId === "string" ? payload.clientId.trim() : "";
  if (!textbookId || !/^[a-zA-Z0-9._:-]{3,120}$/.test(textbookId)) {
    return makeStructuredUploadError("INVALID_PAYLOAD", "textbookId is required and must be a stable identifier.", 422, { field: "textbookId" });
  }
  if (!uploadSessionId || uploadSessionId.length < 6) {
    return makeStructuredUploadError("INVALID_PAYLOAD", "uploadSessionId is required.", 422, { field: "uploadSessionId" });
  }
  if (!clientId || clientId.length < 3) {
    return makeStructuredUploadError("INVALID_PAYLOAD", "clientId is required.", 422, { field: "clientId" });
  }
  if (!payload.metadata || typeof payload.metadata !== "object") {
    return makeStructuredUploadError("INVALID_PAYLOAD", "metadata is required.", 422, { field: "metadata" });
  }
  if (typeof payload.metadata.title !== "string" || !payload.metadata.title.trim()) {
    return makeStructuredUploadError("INVALID_PAYLOAD", "metadata.title is required.", 422, { field: "metadata.title" });
  }
  if (!Array.isArray(payload.chunks) || payload.chunks.length === 0) {
    return makeStructuredUploadError("INVALID_PAYLOAD", "chunks must contain at least one item.", 422, { field: "chunks" });
  }
  for (let index = 0; index < payload.chunks.length; index += 1) {
    const chunk = payload.chunks[index];
    if (!chunk || typeof chunk !== "object") {
      return makeStructuredUploadError("CORRUPTED_DATA", `chunks[${index}] is not a valid chunk object.`, 422, { field: `chunks[${index}]` });
    }
    if (typeof chunk.id !== "string" || !chunk.id.trim()) {
      return makeStructuredUploadError("CORRUPTED_DATA", `chunks[${index}].id is required.`, 422, { field: `chunks[${index}].id` });
    }
    if (typeof chunk.data !== "string" || !chunk.data.trim()) {
      return makeStructuredUploadError("CORRUPTED_DATA", `chunks[${index}].data is required.`, 422, { field: `chunks[${index}].data` });
    }
    if (typeof chunk.sizeBytes !== "undefined" && !isPositiveFiniteInteger(chunk.sizeBytes)) {
      return makeStructuredUploadError("CORRUPTED_DATA", `chunks[${index}].sizeBytes must be a positive integer.`, 422, { field: `chunks[${index}].sizeBytes` });
    }
  }
  if (typeof payload.toc !== "undefined" && !Array.isArray(payload.toc)) {
    return makeStructuredUploadError("INVALID_PAYLOAD", "toc must be an array when provided.", 422, { field: "toc" });
  }
  if (typeof payload.ocrBlocks !== "undefined" && !Array.isArray(payload.ocrBlocks)) {
    return makeStructuredUploadError("INVALID_PAYLOAD", "ocrBlocks must be an array when provided.", 422, { field: "ocrBlocks" });
  }
  return null;
}

function registerCorruptedUploadAttempt(state, options) {
  const payloadHash = options.payloadHash;
  if (!payloadHash) {
    return;
  }
  const loopKey = `${options.clientId}::${payloadHash}`;
  const existing = state.loopGuards[loopKey] || { attemptCount: 0, blocked: false };
  const attemptCount = Number(existing.attemptCount || 0) + 1;
  state.loopGuards[loopKey] = {
    ...existing,
    textbookId: options.textbookId,
    payloadHash,
    lastErrorCode: options.errorCode,
    attemptCount,
    blocked: Boolean(existing.blocked) || attemptCount >= textbookUploadLoopBlockThreshold,
    updatedAt: new Date().toISOString(),
  };
}

function getCommittedTextbookRecordPath(textbookId) {
  return path.join(textbookUploadCommittedPath, `${textbookId}.json`);
}

function getActiveTextbookPath(textbookId) {
  return path.join(textbookUploadActivePath, textbookId);
}

function quarantineTextbookArtifacts(state, options) {
  const activePath = getActiveTextbookPath(options.textbookId);
  if (!fs.existsSync(activePath)) {
    return null;
  }

  const quarantineId = `${options.textbookId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const quarantinePath = path.join(textbookUploadQuarantinePath, quarantineId);
  if (!safeMovePath(activePath, quarantinePath)) {
    return null;
  }

  state.corruptedTextbookIds[options.textbookId] = {
    textbookId: options.textbookId,
    reason: options.reason,
    errorCode: options.errorCode,
    quarantinedAt: new Date().toISOString(),
    quarantineId,
    sessionId: options.uploadSessionId || null,
  };

  state.quarantineIndex.push({
    quarantineId,
    textbookId: options.textbookId,
    quarantinePath,
    reason: options.reason,
    errorCode: options.errorCode,
    createdAt: new Date().toISOString(),
  });

  writeUpdaterLog(`Quarantined corrupted textbook artifacts. textbookId=${options.textbookId} quarantineId=${quarantineId} reason=${options.reason}`);
  return quarantineId;
}

function purgeQuarantinedUploads(state, options = {}) {
  ensureTextbookUploadStorage();
  const retentionMs = Number.isFinite(options.retentionMs)
    ? Math.max(0, Number(options.retentionMs))
    : textbookUploadQuarantineRetentionMs;
  const nowMs = Date.now();
  const kept = [];
  const removed = [];

  for (const entry of state.quarantineIndex) {
    const createdAtMs = Date.parse(String(entry?.createdAt || ""));
    const hasPath = entry && typeof entry.quarantinePath === "string" && fs.existsSync(entry.quarantinePath);
    const isExpired = Number.isFinite(createdAtMs) ? (nowMs - createdAtMs) >= retentionMs : true;
    if (hasPath && !isExpired) {
      kept.push(entry);
      continue;
    }
    if (hasPath) {
      safeRemovePath(entry.quarantinePath);
    }
    removed.push(entry);
  }

  state.quarantineIndex = kept;
  for (const textbookId of Object.keys(state.corruptedTextbookIds || {})) {
    const hasEntry = kept.some((entry) => entry.textbookId === textbookId);
    if (!hasEntry) {
      delete state.corruptedTextbookIds[textbookId];
    }
  }

  return { removedCount: removed.length, keptCount: kept.length, removed };
}

function writeStructuredUploadError(res, error) {
  res.writeHead(error.statusCode || 422);
  res.end(JSON.stringify({
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      details: error.details || {},
    },
  }));
}

const STALE_UPDATER_PROGRESS_MS = 10 * 60 * 1000;

function normalizeUpdaterProgress(payload, progressPath) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  if (!isUpdaterActiveState(payload.state)) {
    return payload;
  }

  const updatedAt = Date.parse(String(payload.updatedAt || ""));
  if (!Number.isFinite(updatedAt)) {
    return payload;
  }

  const ageMs = Date.now() - updatedAt;
  if (ageMs < STALE_UPDATER_PROGRESS_MS) {
    return payload;
  }

  const recovered = {
    ...payload,
    state: "idle",
    progressPercent: null,
    bytesDownloaded: null,
    downloadSpeedBytesPerSecond: null,
    message: `Recovered stale updater state (${String(payload.state || "unknown")}) from previous session.`,
    lastError: payload.lastError || "stale-updater-state-recovered",
    updatedAt: new Date().toISOString(),
  };

  writeJsonFile(progressPath, recovered);
  writeUpdaterLog(`Recovered stale updater status on boot (previousState=${String(payload.state || "unknown")}, ageMs=${ageMs}).`);
  return recovered;
}

function readUpdaterProgress() {
  const progressPath = path.join(packageRoot, "updater-status.json");
  const manifestPath = path.join(packageRoot, "package-manifest.json");
  const manifest = readJsonFile(manifestPath);
  const manifestVersion = manifest?.version || null;

  const payload = readJsonFile(progressPath);
  if (!payload || typeof payload !== "object") {
    return {
      state: "idle",
      mode: null,
      currentVersion: manifestVersion,
      latestVersion: null,
      assetName: null,
      assetSizeBytes: null,
      bytesDownloaded: null,
      downloadSpeedBytesPerSecond: null,
      progressPercent: null,
      releaseUrl: null,
      message: "Updater idle.",
      lastError: null,
      updatedAt: null,
    };
  }

  // Always fill currentVersion from manifest when the status file doesn't have it
  if (!payload.currentVersion && manifestVersion) {
    payload.currentVersion = manifestVersion;
  }

  return normalizeUpdaterProgress(payload, progressPath);
}

function readBootStatus() {
  const statusPath = path.join(packageRoot, "boot-status.json");
  const payload = readJsonFile(statusPath);
  if (!payload || typeof payload !== "object") {
    return {
      step: "running",
      message: "CourseForge server is running.",
      progressPercent: 100,
      ready: true,
      updatedAt: new Date().toISOString(),
    };
  }

  return payload;
}

function isUpdaterActiveState(state) {
  return ["checking", "update-available", "downloading", "extracting", "staging"].includes(String(state || "").toLowerCase());
}

function getAutoUpdateScriptPath() {
  const candidates = [
    path.join(packageRoot, "AutoUpdate-CourseForge.ps1"),
    path.join(packageRoot, "autoupdate-courseforge.ps1"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function parseBooleanQueryValue(rawValue) {
  if (Array.isArray(rawValue)) {
    return parseBooleanQueryValue(rawValue[rawValue.length - 1]);
  }

  if (typeof rawValue !== "string") {
    return false;
  }

  const normalized = rawValue.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function launchManualStageUpdate(checkPayload, options = {}) {
  const { skipStage = false } = options;
  if (!checkPayload?.ok || !checkPayload?.available) {
    return {
      stageRequested: false,
      stageAccepted: false,
      stageReason: "no-update",
      stageMessage: "No update is available to stage.",
      stagePid: null,
    };
  }

  if (skipStage) {
    writeUpdaterLog("Manual update stage skipped by request parameter.");
    return {
      stageRequested: false,
      stageAccepted: false,
      stageReason: "skip-stage",
      stageMessage: "Manual check completed without background staging.",
      stagePid: null,
    };
  }

  const progress = readUpdaterProgress();
  if (isUpdaterActiveState(progress?.state)) {
    writeUpdaterLog(`Manual update stage request ignored because updater is already active (state=${progress.state}).`);
    return {
      stageRequested: true,
      stageAccepted: false,
      stageReason: "updater-active",
      stageMessage: `Updater is already running (${progress.state}).`,
      stagePid: null,
    };
  }

  if (manualStageProcess && manualStageProcess.exitCode === null && !manualStageProcess.killed) {
    writeUpdaterLog("Manual update stage request ignored because a manual stage process is already running.");
    return {
      stageRequested: true,
      stageAccepted: false,
      stageReason: "manual-stage-running",
      stageMessage: "Manual staging is already running.",
      stagePid: manualStageProcess.pid || null,
    };
  }

  const updateScriptPath = getAutoUpdateScriptPath();
  if (!updateScriptPath) {
    writeUpdaterLog("Manual update stage could not start because AutoUpdate-CourseForge.ps1 was not found.");
    return {
      stageRequested: true,
      stageAccepted: false,
      stageReason: "missing-updater-script",
      stageMessage: "Updater script is missing in this runtime package.",
      stagePid: null,
    };
  }

  const manifestPath = path.join(packageRoot, "package-manifest.json");
  const manifest = readJsonFile(manifestPath);
  const owner = manifest?.updates?.owner;
  const repo = manifest?.updates?.repo;
  const assetNameTemplate = manifest?.updates?.assetNameTemplate;

  const updaterArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    updateScriptPath,
    "-PackageRoot",
    packageRoot,
    "-CurrentVersion",
    checkPayload.currentVersion || manifest?.version || "",
    "-StageOnly",
  ];

  if (typeof owner === "string" && owner.trim().length > 0) {
    updaterArgs.push("-Owner", owner.trim());
  }

  if (typeof repo === "string" && repo.trim().length > 0) {
    updaterArgs.push("-Repo", repo.trim());
  }

  if (typeof assetNameTemplate === "string" && assetNameTemplate.trim().length > 0) {
    updaterArgs.push("-AssetNameTemplate", assetNameTemplate.trim());
  }

  try {
    const child = spawn("powershell.exe", updaterArgs, {
      cwd: packageRoot,
      detached: false,
      windowsHide: true,
      stdio: "ignore",
    });

    manualStageProcess = child;
    child.on("exit", (code, signal) => {
      writeUpdaterLog(`Manual update stage process finished with code=${code ?? "null"} signal=${signal || "none"}.`);
      manualStageProcess = null;
    });
    child.on("error", (error) => {
      writeUpdaterLog(`Manual update stage process failed to start: ${error.message}`);
      manualStageProcess = null;
    });

    writeUpdaterLog(`Manual update stage process started (pid=${child.pid || "unknown"}).`);
    return {
      stageRequested: true,
      stageAccepted: true,
      stageReason: "started",
      stageMessage: "Update download and staging started in the background.",
      stagePid: child.pid || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeUpdaterLog(`Manual update stage process launch failed: ${message}`);
    return {
      stageRequested: true,
      stageAccepted: false,
      stageReason: "spawn-failed",
      stageMessage: `Failed to start updater staging: ${message}`,
      stagePid: null,
    };
  }
}

function parseSemver(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function deriveReleasesListEndpoint(latestEndpoint) {
  if (!latestEndpoint || typeof latestEndpoint !== "string") {
    return null;
  }

  if (latestEndpoint.includes("/releases/latest")) {
    const [base] = latestEndpoint.split("?");
    return `${base.replace(/\/releases\/latest$/, "/releases")}?per_page=10`;
  }

  return null;
}

function addCacheBustParameter(endpoint) {
  if (!endpoint || typeof endpoint !== "string") {
    return endpoint;
  }

  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}cache_bust=${Date.now()}`;
}

function selectBestStableRelease(releases, currentSemver) {
  if (!Array.isArray(releases) || !releases.length) {
    return null;
  }

  let best = null;
  for (const release of releases) {
    if (!release || typeof release !== "object") {
      continue;
    }

    if (release.draft || release.prerelease) {
      continue;
    }

    const candidateVersion = String(release.tag_name || release.name || "").replace(/^v/, "");
    const candidateSemver = parseSemver(candidateVersion);
    if (!candidateSemver) {
      continue;
    }

    if (currentSemver && compareSemver(candidateSemver, currentSemver) <= 0) {
      continue;
    }

    if (!best || compareSemver(candidateSemver, best.semver) > 0) {
      best = {
        version: candidateVersion,
        semver: candidateSemver,
        releaseUrl: release.html_url || null,
      };
    }
  }

  return best;
}

async function fetchJsonWithRetries(endpoint, headers) {
  let response;
  let lastRequestError = null;
  for (let attempt = 1; attempt <= latestReleaseMaxAttempts; attempt += 1) {
    try {
      response = await fetch(endpoint, {
        headers,
        signal: AbortSignal.timeout(latestReleaseRequestTimeoutMs),
      });
      break;
    } catch (error) {
      lastRequestError = error;
      if (attempt < latestReleaseMaxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  if (!response) {
    return {
      ok: false,
      response: null,
      body: null,
      error: lastRequestError,
    };
  }

  if (!response.ok) {
    let responseBody = "";
    try {
      responseBody = (await response.text()).trim();
    } catch {
      responseBody = "";
    }

    return {
      ok: false,
      response,
      body: responseBody,
      error: null,
    };
  }

  try {
    const body = await response.json();
    return {
      ok: true,
      response,
      body,
      error: null,
    };
  } catch {
    return {
      ok: false,
      response,
      body: null,
      error: new Error("invalid-json"),
    };
  }
}

async function fetchLatestReleaseStatus() {
  const manifestPath = path.join(packageRoot, "package-manifest.json");
  const manifest = readJsonFile(manifestPath);
  const currentVersion = manifest?.version || null;
  const latestEndpoint = manifest?.updates?.latestEndpoint || defaultLatestReleaseEndpoint;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CourseForge-Local-Server",
    "Cache-Control": "no-cache, no-store, must-revalidate",
  };

  const token = process.env.COURSEFORGE_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const checkedAt = new Date().toISOString();
  const releasesListEndpoint = manifest?.updates?.releasesListEndpoint || deriveReleasesListEndpoint(latestEndpoint);
  const diagnostics = {
    checkedAt,
    latestEndpoint,
    releasesListEndpoint: releasesListEndpoint || null,
    tokenConfigured: Boolean(token),
  };

  // Add cache-bust parameters to force fresh API responses
  const cacheBustedLatestEndpoint = addCacheBustParameter(latestEndpoint);
  const cacheBustedReleasesEndpoint = releasesListEndpoint ? addCacheBustParameter(releasesListEndpoint) : null;

  const latestResult = await fetchJsonWithRetries(cacheBustedLatestEndpoint, headers);
  const currentSemver = parseSemver(currentVersion);

  if (!latestResult.response) {
    if (cacheBustedReleasesEndpoint) {
      const fallbackResult = await fetchJsonWithRetries(cacheBustedReleasesEndpoint, headers);
      if (fallbackResult.ok) {
        const bestRelease = selectBestStableRelease(fallbackResult.body, currentSemver);
        if (bestRelease) {
          return {
            ok: true,
            available: true,
            currentVersion,
            latestVersion: bestRelease.version,
            releaseUrl: bestRelease.releaseUrl,
            checkedAt,
            error: null,
            diagnostics: {
              ...diagnostics,
              source: "releases-list-fallback",
              requestAttempts: latestReleaseMaxAttempts,
              requestTimeoutMs: latestReleaseRequestTimeoutMs,
            },
          };
        }
      }
    }

    const message = latestResult.error instanceof Error ? latestResult.error.message : String(latestResult.error);
    return {
      ok: false,
      available: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      checkedAt,
      error: `Latest release request failed before receiving a response: ${message}`,
      diagnostics: {
        ...diagnostics,
        requestAttempts: latestReleaseMaxAttempts,
        requestTimeoutMs: latestReleaseRequestTimeoutMs,
      },
    };
  }

  if (!latestResult.ok) {
    if (latestResult.error && latestResult.error.message === "invalid-json") {
      return {
        ok: false,
        available: false,
        currentVersion,
        latestVersion: null,
        releaseUrl: null,
        checkedAt,
        error: "Latest release response was not valid JSON.",
        diagnostics,
      };
    }

    const responseBodySnippet = latestResult.body ? String(latestResult.body).slice(0, 220) : null;
    return {
      ok: false,
      available: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      checkedAt,
      error: `Latest release request failed with status ${latestResult.response.status}.`,
      diagnostics: {
        ...diagnostics,
        responseStatus: latestResult.response.status,
        responseStatusText: latestResult.response.statusText,
        responseBodySnippet,
      },
    };
  }

  const release = latestResult.body;

  const latestVersion = String(release.tag_name || release.name || "").replace(/^v/, "");
  const latestSemver = parseSemver(latestVersion);
  let available = Boolean(latestSemver && currentSemver && compareSemver(latestSemver, currentSemver) > 0);
  let resolvedLatestVersion = latestSemver ? latestVersion : null;
  let resolvedReleaseUrl = release.html_url || null;
  let source = "latest";

  if (cacheBustedReleasesEndpoint && currentSemver && (!available || !latestSemver)) {
    const verificationResult = await fetchJsonWithRetries(cacheBustedReleasesEndpoint, headers);
    if (verificationResult.ok) {
      const bestRelease = selectBestStableRelease(verificationResult.body, currentSemver);
      if (bestRelease) {
        available = true;
        resolvedLatestVersion = bestRelease.version;
        resolvedReleaseUrl = bestRelease.releaseUrl;
        source = "releases-list-verified";
      }
    }
  }

  return {
    ok: true,
    available,
    currentVersion,
    latestVersion: resolvedLatestVersion,
    releaseUrl: resolvedReleaseUrl,
    checkedAt,
    error: resolvedLatestVersion ? null : "Unable to parse latest release version.",
    diagnostics: {
      ...diagnostics,
      source,
      latestVersionParsed: latestVersion,
      latestVersionSemver: latestSemver,
      currentVersionSemver: currentSemver,
      comparisonResult: latestSemver && currentSemver ? compareSemver(latestSemver, currentSemver) : null,
    },
  };
}

async function handleApiRoute(pathname, url, method, req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  if (pathname === "/api/update-status") {
    const pendingPath = path.join(packageRoot, "pending-update.json");
    const manifestPath = path.join(packageRoot, "package-manifest.json");
    const raw = readJsonFile(pendingPath);
    const manifest = readJsonFile(manifestPath);
    res.writeHead(200);
    res.end(JSON.stringify({
      available: Boolean(raw && raw.version),
      version: raw?.version || null,
      releaseUrl: raw?.releaseUrl || null,
      stagedAt: raw?.stagedAt || null,
      currentVersion: manifest?.version || null,
    }));
    return;
  }

  if (pathname === "/api/check-for-updates") {
    writeUpdaterLog("Manual update check requested via /api/check-for-updates.");
    const payload = await fetchLatestReleaseStatus();
    const skipStage = parseBooleanQueryValue(url.searchParams.get("skipStage"));
    const stage = launchManualStageUpdate(payload, { skipStage });
    const responsePayload = {
      ...payload,
      ...stage,
    };
    writeJsonFile(updaterCheckPath, responsePayload);
    if (payload.ok) {
      writeUpdaterLog(`Manual update check result: ok=true current=${payload.currentVersion || "unknown"} latest=${payload.latestVersion || "unknown"} available=${payload.available} stageAccepted=${stage.stageAccepted}`);
    } else {
      writeUpdaterLog(`Manual update check result: ok=false error=${payload.error || "unknown"}`);
    }
    res.writeHead(payload.ok ? 200 : 502);
    res.end(JSON.stringify(responsePayload));
    return;
  }

  if (pathname === "/api/updater-progress") {
    const payload = readUpdaterProgress();
    res.writeHead(200);
    res.end(JSON.stringify(payload));
    return;
  }

  if (pathname === "/api/boot-status") {
    const payload = readBootStatus();
    res.writeHead(200);
    res.end(JSON.stringify(payload));
    return;
  }

  if (pathname === "/api/updater-diagnostics") {
    const pendingPath = path.join(packageRoot, "pending-update.json");
    const manifestPath = path.join(packageRoot, "package-manifest.json");
    const integrityPath = path.join(packageRoot, "integrity-status.json");
    const lastCheck = readJsonFile(updaterCheckPath);
    const manifest = readJsonFile(manifestPath);
    const pending = readJsonFile(pendingPath);
    const integrity = readJsonFile(integrityPath);
    const progress = readUpdaterProgress();

    res.writeHead(200);
    res.end(JSON.stringify({
      packageRoot,
      checkedAt: new Date().toISOString(),
      currentVersion: manifest?.version || null,
      pendingUpdateVersion: pending?.version || null,
      pendingUpdateStagedAt: pending?.stagedAt || null,
      integrity,
      progress,
      lastCheck,
      updaterLogTail: tailFileLines(updaterLogPath, 80),
      ocrDebugLogTail: tailFileLines(ocrDebugLogPath, 120),
    }));
    return;
  }

  if (pathname === "/api/ocr-debug-log") {
    if (method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    let body;
    try {
      body = await readJsonRequestBody(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "request-body-too-large" ? 413 : 400;
      res.writeHead(status);
      res.end(JSON.stringify({ error: message }));
      return;
    }

    const payload = typeof body === "object" && body !== null ? body : {};
    const event = typeof payload.event === "string" ? payload.event.trim() : "unknown";
    const level = typeof payload.level === "string" ? payload.level.trim().toLowerCase() : "info";
    const traceId = typeof payload.traceId === "string" ? payload.traceId.trim() : "";
    const context = typeof payload.context === "object" && payload.context !== null ? payload.context : {};

    appendOcrDebugLog({ event, level, traceId: traceId || null, context });
    res.writeHead(202);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/api/ocr-debug-log-tail") {
    const requestedLines = Number(url.searchParams.get("lines"));
    const lineCount = Number.isFinite(requestedLines)
      ? Math.max(1, Math.min(500, Math.trunc(requestedLines)))
      : 150;

    res.writeHead(200);
    res.end(JSON.stringify({
      path: ocrDebugLogPath,
      tail: tailFileLines(ocrDebugLogPath, lineCount),
    }));
    return;
  }

  if (pathname === "/api/session-heartbeat") {
    if (method !== "GET" && method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    hasActiveHeartbeat = true;
    lastHeartbeatAt = Date.now();
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, timeoutMs: heartbeatTimeoutMs, serverTime: new Date().toISOString() }));
    return;
  }

  if (pathname === "/api/textbook-upload") {
    if (method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    let body;
    try {
      body = await readJsonRequestBody(req, 1024 * 1024);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(message === "request-body-too-large" ? 413 : 400);
      res.end(JSON.stringify({ ok: false, error: { code: "INVALID_PAYLOAD", message } }));
      return;
    }

    ensureTextbookUploadStorage();
    const state = readTextbookUploadState();
    purgeQuarantinedUploads(state);

    const payloadHash = computePayloadHash(body);
    const textbookId = typeof body?.textbookId === "string" ? body.textbookId.trim() : "";
    const uploadSessionId = typeof body?.uploadSessionId === "string" ? body.uploadSessionId.trim() : "";
    const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "unknown-client";

    const loopKey = payloadHash ? `${clientId}::${payloadHash}` : null;
    if (loopKey && state.loopGuards[loopKey]?.blocked) {
      writeTextbookUploadState(state);
      writeStructuredUploadError(res, makeStructuredUploadError(
        "CORRUPTED_UPLOAD_LOOP_BLOCKED",
        "Repeated corrupted upload attempts detected. Sanitize payload before retrying.",
        429,
        { textbookId, uploadSessionId, loopKey }
      ));
      return;
    }

    const validationError = validateTextbookUploadPayload(body);
    if (validationError) {
      registerCorruptedUploadAttempt(state, { payloadHash, clientId, textbookId, errorCode: validationError.code });
      writeTextbookUploadState(state);
      writeStructuredUploadError(res, validationError);
      return;
    }

    if (state.corruptedTextbookIds[textbookId]) {
      registerCorruptedUploadAttempt(state, { payloadHash, clientId, textbookId, errorCode: "CORRUPTED_EXISTING_RECORD" });
      writeTextbookUploadState(state);
      writeStructuredUploadError(res, makeStructuredUploadError(
        "CORRUPTED_EXISTING_RECORD",
        "Existing textbook UUID is marked corrupted. Re-upload with a new textbookId and uploadSessionId.",
        409,
        { textbookId }
      ));
      return;
    }

    const committedRecordPath = getCommittedTextbookRecordPath(textbookId);
    if (fs.existsSync(committedRecordPath)) {
      writeStructuredUploadError(res, makeStructuredUploadError(
        "DUPLICATE_TEXTBOOK_ID",
        "A textbook with this UUID already exists. Use a new textbookId.",
        409,
        { textbookId }
      ));
      return;
    }

    const activeTextbookPath = getActiveTextbookPath(textbookId);
    if (fs.existsSync(activeTextbookPath)) {
      quarantineTextbookArtifacts(state, {
        textbookId,
        uploadSessionId,
        reason: "Detected legacy partial upload artifacts before accepting new upload.",
        errorCode: "CORRUPTED_EXISTING_RECORD",
      });
      registerCorruptedUploadAttempt(state, { payloadHash, clientId, textbookId, errorCode: "CORRUPTED_EXISTING_RECORD" });
      writeTextbookUploadState(state);
      writeStructuredUploadError(res, makeStructuredUploadError(
        "CORRUPTED_EXISTING_RECORD",
        "Legacy partial upload artifacts were quarantined. Retry with a new textbookId and session.",
        409,
        { textbookId }
      ));
      return;
    }

    try {
      ensureDirectory(activeTextbookPath);
      writeJsonFile(path.join(activeTextbookPath, "metadata.json"), body.metadata || {});
      writeJsonFile(path.join(activeTextbookPath, "chunks.json"), body.chunks || []);
      writeJsonFile(path.join(activeTextbookPath, "toc.json"), body.toc || []);
      writeJsonFile(path.join(activeTextbookPath, "ocr-blocks.json"), body.ocrBlocks || []);
      writeJsonFile(path.join(activeTextbookPath, "upload.json"), {
        textbookId,
        uploadSessionId,
        clientId,
        payloadHash,
        uploadedAt: new Date().toISOString(),
      });

      if (body.simulateFailureAfterPartialWrite === true) {
        throw new Error("simulated-partial-write-failure");
      }

      writeJsonFile(committedRecordPath, {
        textbookId,
        uploadSessionId,
        clientId,
        payloadHash,
        metadata: body.metadata,
        chunkCount: Array.isArray(body.chunks) ? body.chunks.length : 0,
        tocCount: Array.isArray(body.toc) ? body.toc.length : 0,
        ocrBlockCount: Array.isArray(body.ocrBlocks) ? body.ocrBlocks.length : 0,
        committedAt: new Date().toISOString(),
      });
      safeRemovePath(activeTextbookPath);
      if (loopKey && state.loopGuards[loopKey]) {
        delete state.loopGuards[loopKey];
      }
      writeTextbookUploadState(state);

      res.writeHead(201);
      res.end(JSON.stringify({
        ok: true,
        textbookId,
        uploadSessionId,
      }));
      return;
    } catch (error) {
      quarantineTextbookArtifacts(state, {
        textbookId,
        uploadSessionId,
        reason: `Upload write failed after partial persistence: ${error instanceof Error ? error.message : String(error)}`,
        errorCode: "CORRUPTED_DATA",
      });
      registerCorruptedUploadAttempt(state, { payloadHash, clientId, textbookId, errorCode: "CORRUPTED_DATA" });
      writeTextbookUploadState(state);
      writeStructuredUploadError(res, makeStructuredUploadError(
        "CORRUPTED_DATA",
        "Partial upload was quarantined after write failure.",
        500,
        { textbookId, uploadSessionId }
      ));
      return;
    }
  }

  if (pathname === "/api/textbook-upload/resume") {
    if (method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    let body;
    try {
      body = await readJsonRequestBody(req, 64 * 1024);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(message === "request-body-too-large" ? 413 : 400);
      res.end(JSON.stringify({ error: message }));
      return;
    }

    const textbookId = typeof body?.textbookId === "string" ? body.textbookId.trim() : "";
    const uploadSessionId = typeof body?.uploadSessionId === "string" ? body.uploadSessionId.trim() : "";
    const state = readTextbookUploadState();
    purgeQuarantinedUploads(state);

    if (!textbookId || !uploadSessionId) {
      writeStructuredUploadError(res, makeStructuredUploadError(
        "INVALID_PAYLOAD",
        "textbookId and uploadSessionId are required to resume uploads.",
        422
      ));
      return;
    }

    if (state.corruptedTextbookIds[textbookId]) {
      writeTextbookUploadState(state);
      writeStructuredUploadError(res, makeStructuredUploadError(
        "RESUME_BLOCKED_CORRUPTED",
        "Resume is blocked for corrupted textbook uploads. Start a sanitized upload with new identifiers.",
        409,
        { textbookId, uploadSessionId }
      ));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, textbookId, uploadSessionId }));
    return;
  }

  if (pathname === "/api/textbook-upload/purge") {
    if (method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }

    let body;
    try {
      body = await readJsonRequestBody(req, 64 * 1024);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(message === "request-body-too-large" ? 413 : 400);
      res.end(JSON.stringify({ error: message }));
      return;
    }

    const retentionMs = Number(body?.retentionMs);
    const state = readTextbookUploadState();
    const purgeResult = purgeQuarantinedUploads(state, {
      retentionMs: Number.isFinite(retentionMs) ? retentionMs : textbookUploadQuarantineRetentionMs,
    });
    writeTextbookUploadState(state);

    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      ...purgeResult,
      remainingCorruptedTextbookIds: Object.keys(state.corruptedTextbookIds || {}),
    }));
    return;
  }

  if (pathname === "/api/textbook-upload-state") {
    const state = readTextbookUploadState();
    const purgeResult = purgeQuarantinedUploads(state);
    writeTextbookUploadState(state);
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      purge: purgeResult,
      corruptedTextbookIds: state.corruptedTextbookIds,
      quarantineCount: state.quarantineIndex.length,
      loopGuardCount: Object.keys(state.loopGuards || {}).length,
    }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
}

let port = defaultPort;
if (portArg && !isNaN(portArg)) {
  port = parseInt(portArg, 10);
}

// Ensure webapp path exists
if (!fs.existsSync(webappPath)) {
  console.error(`Error: Webapp path does not exist: ${webappPath}`);
  process.exit(1);
}

// MIME types
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

// Start server
function startServer(finalPort) {
  let shutdownRequested = false;

  const requestShutdown = (reason) => {
    if (shutdownRequested) {
      return;
    }
    shutdownRequested = true;
    console.log(`Shutting down server: ${reason}`);
    server.close(() => process.exit(0));
  };

  const idleWatchdog = setInterval(() => {
    if (!hasActiveHeartbeat) {
      return;
    }

    if ((Date.now() - lastHeartbeatAt) > heartbeatTimeoutMs) {
      requestShutdown(`no browser heartbeat for ${heartbeatTimeoutMs}ms`);
    }
  }, 5000);

  if (typeof idleWatchdog.unref === "function") {
    idleWatchdog.unref();
  }

  const server = http.createServer((req, res) => {
    try {
      if (enforceLoopbackClients && !isLoopbackClientAddress(req.socket?.remoteAddress)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "loopback-only" }));
        return;
      }

      applyResponseSecurityHeaders(req, res, finalPort);

      const url = new URL(req.url, `http://localhost:${finalPort}`);
      let pathname = url.pathname;

      // ── /api/* routes ──
      if (pathname.startsWith("/api/")) {
        void handleApiRoute(pathname, url, req.method || "GET", req, res).catch((error) => {
          console.error("API route error:", error);
          if (pathname === "/api/check-for-updates") {
            const message = error instanceof Error ? error.message : String(error);
            writeUpdaterLog(`Manual update check failed with internal error: ${message}`);
            writeJsonFile(updaterCheckPath, {
              ok: false,
              available: false,
              error: `Internal error while checking for updates: ${message}`,
              checkedAt: new Date().toISOString(),
            });
          }
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        });
        return;
      }

      // Remove leading slash for file path
      if (pathname.startsWith("/")) {
        pathname = pathname.slice(1);
      }

      // Security: prevent directory traversal
      if (pathname.includes("..")) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
        return;
      }

      let filePath = path.join(webappPath, pathname);

      // Check if it's a directory, serve index.html
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
      } else if (!filePath.includes(".")) {
        // No file extension, try serving as a route (SPA)
        filePath = path.join(webappPath, "index.html");
      }

      // Read and serve file
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || "application/octet-stream";

        // Set cache headers for better performance
        if (ext === ".html") {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year
        }

        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
          "Content-Type": contentType,
        });
        res.end(content);
      } else {
        // File not found, serve index.html for SPA routing
        const indexPath = path.join(webappPath, "index.html");
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath);
          res.writeHead(200, {
            "Content-Type": mimeTypes[".html"],
            "Cache-Control": "no-cache, no-store, must-revalidate",
          });
          res.end(content);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("404 Not Found");
        }
      }
    } catch (err) {
      console.error("Request handler error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("500 Internal Server Error");
    }
  });

  server.listen(finalPort, host, () => {
    console.log(`CourseForge server running at http://${host}:${finalPort}`);
    console.log(`Serving from: ${webappPath}`);
    console.log(`Package root: ${packageRoot}`);
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Port ${finalPort} is already in use.`);
    } else {
      console.error("Server error:", err);
    }
    clearInterval(idleWatchdog);
    process.exit(1);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    clearInterval(idleWatchdog);
    requestShutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    clearInterval(idleWatchdog);
    requestShutdown("SIGINT");
  });
}

// Start the server on the requested fixed port.
startServer(port);

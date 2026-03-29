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

// Get webapp path from argument or default
const webappPath = process.argv[2] || process.cwd();
const portArg = process.argv[3];
const defaultPort = 3000;
const host = process.argv[4] || "localhost";
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
let manualStageProcess = null;
let hasActiveHeartbeat = false;
let lastHeartbeatAt = 0;

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

  return payload;
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
          "Access-Control-Allow-Origin": "*",
        });
        res.end(content);
      } else {
        // File not found, serve index.html for SPA routing
        const indexPath = path.join(webappPath, "index.html");
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath);
          res.writeHead(200, {
            "Content-Type": mimeTypes[".html"],
            "Access-Control-Allow-Origin": "*",
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

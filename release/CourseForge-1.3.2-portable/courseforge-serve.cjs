/**
 * CourseForge Local Server
 * Simple HTTP server to serve the CourseForge webapp locally
 * 
 * Usage: node courseforge-serve.js [webapp_path] [port]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// Get webapp path from argument or default
const webappPath = process.argv[2] || process.cwd();
const portArg = process.argv[3];
const defaultPort = 3000;
const host = process.argv[4] || "localhost";
const defaultLatestReleaseEndpoint = "https://api.github.com/repos/ronaldarroyowatson/CourseForge/releases/latest";
const heartbeatTimeoutMs = Math.max(15000, Number(process.env.COURSEFORGE_HEARTBEAT_TIMEOUT_MS || 45000));

// Package root is one level above the webapp folder.
// pending-update.json is written here by the updater.
const packageRoot = path.dirname(webappPath);
const updaterLogPath = path.join(packageRoot, "updater.log");
const updaterCheckPath = path.join(packageRoot, "updater-check.json");
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
  const payload = readJsonFile(progressPath);
  if (!payload || typeof payload !== "object") {
    return {
      state: "idle",
      mode: null,
      currentVersion: null,
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

async function fetchLatestReleaseStatus() {
  const manifestPath = path.join(packageRoot, "package-manifest.json");
  const manifest = readJsonFile(manifestPath);
  const currentVersion = manifest?.version || null;
  const latestEndpoint = manifest?.updates?.latestEndpoint || defaultLatestReleaseEndpoint;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CourseForge-Local-Server",
  };

  const token = process.env.COURSEFORGE_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const checkedAt = new Date().toISOString();
  const diagnostics = {
    checkedAt,
    latestEndpoint,
    tokenConfigured: Boolean(token),
  };

  let response;
  try {
    response = await fetch(latestEndpoint, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      available: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      checkedAt,
      error: `Latest release request failed before receiving a response: ${message}`,
      diagnostics,
    };
  }

  if (!response.ok) {
    let responseBody = "";
    try {
      responseBody = (await response.text()).trim();
    } catch {
      responseBody = "";
    }

    const responseBodySnippet = responseBody ? responseBody.slice(0, 220) : null;
    return {
      ok: false,
      available: false,
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      checkedAt,
      error: `Latest release request failed with status ${response.status}.`,
      diagnostics: {
        ...diagnostics,
        responseStatus: response.status,
        responseStatusText: response.statusText,
        responseBodySnippet,
      },
    };
  }

  let release;
  try {
    release = await response.json();
  } catch {
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

  const latestVersion = String(release.tag_name || release.name || "").replace(/^v/, "");
  const latestSemver = parseSemver(latestVersion);
  const currentSemver = parseSemver(currentVersion);
  const available = Boolean(latestSemver && currentSemver && compareSemver(latestSemver, currentSemver) > 0);

  return {
    ok: true,
    available,
    currentVersion,
    latestVersion: latestSemver ? latestVersion : null,
    releaseUrl: release.html_url || null,
    checkedAt,
    error: latestSemver ? null : "Unable to parse latest release version.",
    diagnostics,
  };
}

async function handleApiRoute(pathname, url, method, res) {
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
    writeJsonFile(updaterCheckPath, payload);
    if (payload.ok) {
      writeUpdaterLog(`Manual update check result: ok=true current=${payload.currentVersion || "unknown"} latest=${payload.latestVersion || "unknown"} available=${payload.available}`);
    } else {
      writeUpdaterLog(`Manual update check result: ok=false error=${payload.error || "unknown"}`);
    }
    res.writeHead(payload.ok ? 200 : 502);
    res.end(JSON.stringify(payload));
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
        void handleApiRoute(pathname, url, req.method || "GET", res).catch((error) => {
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

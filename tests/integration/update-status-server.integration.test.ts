// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import http from "node:http";

const repoRoot = join(__dirname, "..", "..");
const serverScriptSource = readFileSync(
  join(repoRoot, "scripts", "installer", "courseforge-serve.js"),
  "utf8"
);

async function getAvailablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

async function startStatusServer(
  root: string,
  port: number,
  options: { extraArgs?: string[]; env?: NodeJS.ProcessEnv } = {}
) {
  const child = spawn("node", [
    join(root, "courseforge-serve.js"),
    join(root, "webapp"),
    String(port),
    "127.0.0.1",
    ...(options.extraArgs ?? []),
  ], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for server startup")), 10000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("CourseForge server running at")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });

  return child;
}

async function startBlockingListener(port: number) {
  const script = [
    "const http = require('http');",
    "const server = http.createServer((req, res) => {",
    "  res.writeHead(200, { 'Content-Type': 'text/plain' });",
    "  res.end('busy');",
    "});",
    `server.listen(${port}, '127.0.0.1', () => console.log('blocking-listener-ready'));`,
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join("\n");

  const child = spawn("node", ["-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for blocking listener startup")), 10000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("blocking-listener-ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Blocking listener exited early with code ${code}`));
    });
  });

  return child;
}

async function stopServer(child: ChildProcess) {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await once(child, "exit");
}

async function waitForServerExit(child: ChildProcess, timeoutMs = 10000) {
  if (child.exitCode !== null) {
    return;
  }

  await Promise.race([
    once(child, "exit").then(() => undefined),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for process exit")), timeoutMs)),
  ]);
}

async function startReleaseServer(payload: unknown) {
  const port = await getAvailablePort();
  const server = http.createServer((_, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });

  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  return {
    url: `http://127.0.0.1:${port}/releases/latest`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

async function startReleaseServerWithStatus(status: number, body: string, contentType = "text/plain") {
  const requests: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders }> = [];
  const port = await getAvailablePort();
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method || "GET",
      path: req.url || "",
      headers: req.headers,
    });
    res.writeHead(status, { "Content-Type": contentType });
    res.end(body);
  });

  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  return {
    url: `http://127.0.0.1:${port}/releases/latest`,
    requests,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

async function startReleaseServerWithRecorder(payload: unknown) {
  const requests: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders }> = [];
  const port = await getAvailablePort();
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method || "GET",
      path: req.url || "",
      headers: req.headers,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });

  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  return {
    url: `http://127.0.0.1:${port}/releases/latest`,
    requests,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

async function startReleaseServerLatestAndList(latestPayload: unknown, listPayload: unknown) {
  const requests: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders }> = [];
  const port = await getAvailablePort();
  const server = http.createServer((req, res) => {
    const requestPath = req.url || "";
    requests.push({
      method: req.method || "GET",
      path: requestPath,
      headers: req.headers,
    });

    if (requestPath.startsWith("/releases/latest")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(latestPayload));
      return;
    }

    if (requestPath.startsWith("/releases?")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(listPayload));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  return {
    latestUrl: `http://127.0.0.1:${port}/releases/latest`,
    requests,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

async function fetchUpdateStatusWithRetry(url: string, timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError ?? new Error("Timed out waiting for update-status endpoint");
}

function createTextbookUploadPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    textbookId: "tb-upload-1",
    uploadSessionId: "session-upload-1",
    clientId: "client-alpha",
    metadata: {
      title: "Foundations of Algebra",
      publisher: "CourseForge Press",
    },
    chunks: [
      {
        id: "chunk-1",
        data: "base64-part-1",
        sizeBytes: 128,
      },
    ],
    toc: [{ chapter: "1", title: "Integers" }],
    ocrBlocks: [{ page: 1, text: "Chapter 1" }],
    ...overrides,
  };
}

describe("local update status endpoint", () => {
  let child: ChildProcess | null = null;

  afterEach(async () => {
    if (child) {
      await stopServer(child);
      child = null;
    }
  });

  it("reports staged update metadata and current app version", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(
      join(root, "package-manifest.json"),
      JSON.stringify({ version: "1.2.6" }, null, 2),
      "utf8"
    );
    writeFileSync(
      join(root, "pending-update.json"),
      JSON.stringify(
        {
          version: "1.2.7",
          releaseUrl: "https://example.invalid/release",
          stagedAt: "2026-03-19T00:00:00.000Z",
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/update-status`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        available: true,
        version: "1.2.7",
        releaseUrl: "https://example.invalid/release",
        stagedAt: "2026-03-19T00:00:00.000Z",
        currentVersion: "1.2.6",
      });
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks latest release metadata through the local server endpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");
    let releaseServer: Awaited<ReturnType<typeof startReleaseServer>> | null = null;

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");

    try {
      releaseServer = await startReleaseServer({
        tag_name: "v1.2.71",
        html_url: "https://example.invalid/releases/tag/v1.2.71",
      });

      writeFileSync(
        join(root, "package-manifest.json"),
        JSON.stringify({
          version: "1.2.7",
          updates: {
            latestEndpoint: releaseServer.url,
          },
        }, null, 2),
        "utf8"
      );

      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/check-for-updates`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        ok: true,
        available: true,
        currentVersion: "1.2.7",
        latestVersion: "1.2.71",
        releaseUrl: "https://example.invalid/releases/tag/v1.2.71",
        stageRequested: true,
        stageAccepted: false,
        stageReason: "missing-updater-script",
        stageMessage: "Updater script is missing in this runtime package.",
        checkedAt: expect.any(String),
        error: null,
        diagnostics: {
          checkedAt: expect.any(String),
          latestEndpoint: releaseServer.url,
          tokenConfigured: false,
        },
      });

      const diagnosticsResponse = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/updater-diagnostics`);
      const diagnosticsPayload = await diagnosticsResponse.json();
      expect(diagnosticsResponse.status).toBe(200);
      expect(diagnosticsPayload.lastCheck).toMatchObject({
        ok: true,
        latestVersion: "1.2.71",
      });
    } finally {
      if (releaseServer) {
        await releaseServer.close();
      }
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies end-to-end manual check communication and records diagnostics payload", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");
    let releaseServer: Awaited<ReturnType<typeof startReleaseServerWithRecorder>> | null = null;

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");

    try {
      releaseServer = await startReleaseServerWithRecorder({
        tag_name: "v1.2.77",
        html_url: "https://example.invalid/releases/tag/v1.2.77",
      });

      writeFileSync(
        join(root, "package-manifest.json"),
        JSON.stringify(
          {
            version: "1.2.76",
            updates: {
              latestEndpoint: releaseServer.url,
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/check-for-updates`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        ok: true,
        available: true,
        currentVersion: "1.2.76",
        latestVersion: "1.2.77",
        releaseUrl: "https://example.invalid/releases/tag/v1.2.77",
        stageRequested: true,
        stageAccepted: false,
        stageReason: "missing-updater-script",
        diagnostics: {
          latestEndpoint: releaseServer.url,
          tokenConfigured: false,
        },
      });

      expect(releaseServer.requests).toHaveLength(1);
      expect(releaseServer.requests[0]?.method).toBe("GET");
      expect(releaseServer.requests[0]?.path?.startsWith("/releases/latest")).toBe(true);
      expect(releaseServer.requests[0]?.headers.accept).toContain("application/vnd.github+json");
      expect(releaseServer.requests[0]?.headers["user-agent"]).toContain("CourseForge-Local-Server");

      const diagnosticsResponse = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/updater-diagnostics`);
      const diagnosticsPayload = await diagnosticsResponse.json();

      expect(diagnosticsResponse.status).toBe(200);
      expect(diagnosticsPayload.lastCheck).toMatchObject({
        ok: true,
        available: true,
        latestVersion: "1.2.77",
        stageRequested: true,
        stageAccepted: false,
      });

      const updaterLog = readFileSync(join(root, "updater.log"), "utf8");
      expect(updaterLog).toContain("Manual update check requested via /api/check-for-updates.");
      expect(updaterLog).toContain("Manual update check result: ok=true current=1.2.76 latest=1.2.77 available=true");
    } finally {
      if (releaseServer) {
        await releaseServer.close();
      }
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prevents false positives by rejecting non-semver latest versions", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");
    let releaseServer: Awaited<ReturnType<typeof startReleaseServer>> | null = null;

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");

    try {
      releaseServer = await startReleaseServer({
        tag_name: "latest",
        html_url: "https://example.invalid/releases/tag/latest",
      });

      writeFileSync(
        join(root, "package-manifest.json"),
        JSON.stringify(
          {
            version: "1.2.76",
            updates: {
              latestEndpoint: releaseServer.url,
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/check-for-updates`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        ok: true,
        available: false,
        currentVersion: "1.2.76",
        latestVersion: null,
        error: "Unable to parse latest release version.",
      });

      const diagnosticsResponse = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/updater-diagnostics`);
      const diagnosticsPayload = await diagnosticsResponse.json();
      expect(diagnosticsResponse.status).toBe(200);
      expect(diagnosticsPayload.lastCheck).toMatchObject({
        ok: true,
        available: false,
        latestVersion: null,
        error: "Unable to parse latest release version.",
      });
    } finally {
      if (releaseServer) {
        await releaseServer.close();
      }
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records manual-check failure codes in diagnostics and updater log", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");
    let releaseServer: Awaited<ReturnType<typeof startReleaseServerWithStatus>> | null = null;

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");

    try {
      releaseServer = await startReleaseServerWithStatus(404, "not found");

      writeFileSync(
        join(root, "package-manifest.json"),
        JSON.stringify(
          {
            version: "1.2.76",
            updates: {
              latestEndpoint: releaseServer.url,
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/check-for-updates`);
      const payload = await response.json();

      expect(response.status).toBe(502);
      expect(payload).toMatchObject({
        ok: false,
        available: false,
        currentVersion: "1.2.76",
        latestVersion: null,
        error: "Latest release request failed with status 404.",
        diagnostics: {
          latestEndpoint: releaseServer.url,
          responseStatus: 404,
          responseStatusText: "Not Found",
          responseBodySnippet: "not found",
        },
      });

      expect(releaseServer.requests).toHaveLength(1);

      const diagnosticsResponse = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/updater-diagnostics`);
      const diagnosticsPayload = await diagnosticsResponse.json();
      expect(diagnosticsResponse.status).toBe(200);
      expect(diagnosticsPayload.lastCheck).toMatchObject({
        ok: false,
        error: "Latest release request failed with status 404.",
        diagnostics: {
          responseStatus: 404,
          responseStatusText: "Not Found",
        },
      });

      const updaterLog = readFileSync(join(root, "updater.log"), "utf8");
      expect(updaterLog).toContain("Manual update check requested via /api/check-for-updates.");
      expect(updaterLog).toContain("Manual update check result: ok=false error=Latest release request failed with status 404.");
    } finally {
      if (releaseServer) {
        await releaseServer.close();
      }
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers when /releases/latest is stale by verifying the releases list", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");
    let releaseServer: Awaited<ReturnType<typeof startReleaseServerLatestAndList>> | null = null;

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");

    try {
      releaseServer = await startReleaseServerLatestAndList(
        {
          tag_name: "v1.4.3",
          html_url: "https://example.invalid/releases/tag/v1.4.3",
        },
        [
          {
            tag_name: "v1.4.4",
            html_url: "https://example.invalid/releases/tag/v1.4.4",
            draft: false,
            prerelease: false,
          },
          {
            tag_name: "v1.4.3",
            html_url: "https://example.invalid/releases/tag/v1.4.3",
            draft: false,
            prerelease: false,
          },
        ]
      );

      writeFileSync(
        join(root, "package-manifest.json"),
        JSON.stringify(
          {
            version: "1.4.3",
            updates: {
              latestEndpoint: releaseServer.latestUrl,
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/check-for-updates?skipStage=1`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        ok: true,
        available: true,
        currentVersion: "1.4.3",
        latestVersion: "1.4.4",
        releaseUrl: "https://example.invalid/releases/tag/v1.4.4",
        diagnostics: {
          source: "releases-list-verified",
        },
      });

      expect(releaseServer.requests.some((entry) => entry.path.startsWith("/releases/latest"))).toBe(true);
      expect(releaseServer.requests.some((entry) => entry.path.startsWith("/releases?"))).toBe(true);
    } finally {
      if (releaseServer) {
        await releaseServer.close();
      }
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns updater progress payload from local status file", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");
    writeFileSync(
      join(root, "updater-status.json"),
      JSON.stringify({
        state: "downloading",
        currentVersion: "1.2.72",
        latestVersion: "1.2.73",
        assetName: "CourseForge-1.2.73-portable.zip",
        assetSizeBytes: 1024,
        bytesDownloaded: 512,
        downloadSpeedBytesPerSecond: 256,
        progressPercent: 50,
        message: "Downloading update package",
        updatedAt: new Date().toISOString(),
      }, null, 2),
      "utf8"
    );

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/updater-progress`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        state: "downloading",
        currentVersion: "1.2.72",
        latestVersion: "1.2.73",
        downloadSpeedBytesPerSecond: 256,
        progressPercent: 50,
      });

      const bootStatusResponse = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/boot-status`);
      const bootStatusPayload = await bootStatusResponse.json();
      expect(bootStatusResponse.status).toBe(200);
      expect(bootStatusPayload).toMatchObject({ ready: true });
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers stale updater progress to idle so startup UI cannot remain stuck", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");
    writeFileSync(
      join(root, "updater-status.json"),
      JSON.stringify({
        state: "downloading",
        currentVersion: "1.2.72",
        latestVersion: "1.2.73",
        assetName: "CourseForge-1.2.73-portable.zip",
        assetSizeBytes: 1024,
        bytesDownloaded: 512,
        downloadSpeedBytesPerSecond: 256,
        progressPercent: 50,
        message: "Downloading update package",
        updatedAt: "2026-03-20T00:00:00.000Z",
      }, null, 2),
      "utf8"
    );

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/updater-progress`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        state: "idle",
        currentVersion: "1.2.72",
        latestVersion: "1.2.73",
        progressPercent: null,
        downloadSpeedBytesPerSecond: null,
      });
      expect(String(payload.message || "")).toContain("Recovered stale updater state");
      expect(payload.lastError).toBeTruthy();

      const persisted = JSON.parse(readFileSync(join(root, "updater-status.json"), "utf8"));
      expect(persisted.state).toBe("idle");
      expect(persisted.progressPercent).toBeNull();
      expect(persisted.downloadSpeedBytesPerSecond).toBeNull();
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports upload control API for cancel and rejects invalid actions", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const cancelResponse = await fetch(`http://127.0.0.1:${port}/api/upload-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", sessionId: "session-1", reason: "timeout" }),
      });
      expect(cancelResponse.status).toBe(202);

      const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/upload-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "not-valid" }),
      });
      expect(invalidResponse.status).toBe(422);
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid textbook payloads before any server-side write", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      // Ensure the HTTP listener is ready to accept requests before this test POSTs payload data.
      await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/update-status`);

      const invalidPayload = createTextbookUploadPayload({ metadata: { title: "" } });
      const response = await fetch(`http://127.0.0.1:${port}/api/textbook-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidPayload),
      });
      const payload = await response.json();

      expect(response.status).toBe(422);
      expect(payload.error.code).toBe("INVALID_PAYLOAD");

      const committedPath = join(root, "textbook-upload-store", "committed", "tb-upload-1.json");
      const activePath = join(root, "textbook-upload-store", "active", "tb-upload-1");
      expect(existsSync(committedPath)).toBe(false);
      expect(existsSync(activePath)).toBe(false);
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("quarantines partial failed uploads, blocks resume, and requires a new textbook UUID", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const failedPayload = createTextbookUploadPayload({
        textbookId: "tb-corrupt-1",
        uploadSessionId: "session-corrupt-1",
        simulateFailureAfterPartialWrite: true,
      });

      const failedResponse = await fetch(`http://127.0.0.1:${port}/api/textbook-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(failedPayload),
      });
      const failedResult = await failedResponse.json();
      expect(failedResponse.status).toBe(500);
      expect(failedResult.error.code).toBe("CORRUPTED_DATA");

      const stateResponse = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/textbook-upload-state`);
      const statePayload = await stateResponse.json();
      expect(statePayload.corruptedTextbookIds["tb-corrupt-1"]).toBeTruthy();
      expect(statePayload.quarantineCount).toBeGreaterThanOrEqual(1);

      const resumeResponse = await fetch(`http://127.0.0.1:${port}/api/textbook-upload/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textbookId: "tb-corrupt-1", uploadSessionId: "session-corrupt-1" }),
      });
      const resumePayload = await resumeResponse.json();
      expect(resumeResponse.status).toBe(409);
      expect(resumePayload.error.code).toBe("RESUME_BLOCKED_CORRUPTED");

      const sameIdRetry = await fetch(`http://127.0.0.1:${port}/api/textbook-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createTextbookUploadPayload({
          textbookId: "tb-corrupt-1",
          uploadSessionId: "session-clean-retry",
        })),
      });
      const sameIdRetryPayload = await sameIdRetry.json();
      expect(sameIdRetry.status).toBe(409);
      expect(sameIdRetryPayload.error.code).toBe("CORRUPTED_EXISTING_RECORD");

      const newIdUpload = await fetch(`http://127.0.0.1:${port}/api/textbook-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createTextbookUploadPayload({
          textbookId: "tb-sanitized-new",
          uploadSessionId: "session-sanitized-new",
        })),
      });
      expect(newIdUpload.status).toBe(201);
      const committedPath = join(root, "textbook-upload-store", "committed", "tb-sanitized-new.json");
      expect(existsSync(committedPath)).toBe(true);
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("purges quarantined textbook artifacts and leaves valid committed records untouched", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      await fetch(`http://127.0.0.1:${port}/api/textbook-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createTextbookUploadPayload({
          textbookId: "tb-purge-corrupt",
          uploadSessionId: "session-purge-corrupt",
          simulateFailureAfterPartialWrite: true,
        })),
      });

      const validResponse = await fetch(`http://127.0.0.1:${port}/api/textbook-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createTextbookUploadPayload({
          textbookId: "tb-purge-valid",
          uploadSessionId: "session-purge-valid",
        })),
      });
      expect(validResponse.status).toBe(201);

      const purgeResponse = await fetch(`http://127.0.0.1:${port}/api/textbook-upload/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionMs: 0 }),
      });
      const purgePayload = await purgeResponse.json();

      expect(purgeResponse.status).toBe(200);
      expect(purgePayload.removedCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(purgePayload.remainingCorruptedTextbookIds)).toBe(true);
      expect(purgePayload.remainingCorruptedTextbookIds).not.toContain("tb-purge-corrupt");

      const quarantineDir = join(root, "textbook-upload-store", "quarantine");
      const quarantineEntries = existsSync(quarantineDir) ? readdirSync(quarantineDir) : [];
      expect(quarantineEntries).toHaveLength(0);

      const committedValidPath = join(root, "textbook-upload-store", "committed", "tb-purge-valid.json");
      expect(existsSync(committedValidPath)).toBe(true);
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks repeated corrupted payload attempts to prevent server-side upload loops", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const badPayload = createTextbookUploadPayload({
        textbookId: "tb-loop-1",
        uploadSessionId: "session-loop-1",
        metadata: { title: "" },
      });

      for (let index = 0; index < 3; index += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/api/textbook-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(badPayload),
        });
        expect(response.status).toBe(422);
      }

      const blockedResponse = await fetch(`http://127.0.0.1:${port}/api/textbook-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(badPayload),
      });
      const blockedPayload = await blockedResponse.json();
      expect(blockedResponse.status).toBe(429);
      expect(blockedPayload.error.code).toBe("CORRUPTED_UPLOAD_LOOP_BLOCKED");

      const committedPath = join(root, "textbook-upload-store", "committed", "tb-loop-1.json");
      expect(existsSync(committedPath)).toBe(false);
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns port health map and cleanup diagnostics for occupied ports", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");

    let blocker: ChildProcess | null = null;
    try {
      const statusPort = await getAvailablePort();
      const busyPort = await getAvailablePort();
      child = await startStatusServer(root, statusPort, {
        env: {
          COURSEFORGE_MANAGED_PORTS: `${statusPort},9090`,
        },
      });

      blocker = await startBlockingListener(busyPort);

      const healthResponse = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${statusPort}/api/port-health?port=${busyPort}`);
      const healthPayload = await healthResponse.json();

      expect(healthResponse.status).toBe(200);
      expect(healthPayload.ok).toBe(true);
      expect(healthPayload.requestedPort).toBe(busyPort);
      expect(Array.isArray(healthPayload.records)).toBe(true);
      expect(healthPayload.records.some((entry: { port: number; state: string }) => entry.port === busyPort && entry.state === "occupied")).toBe(true);

      const cleanupResponse = await fetch(`http://127.0.0.1:${statusPort}/api/port-cleanup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port: busyPort,
          force: true,
          includeAllManagedPorts: false,
        }),
      });
      const cleanupPayload = await cleanupResponse.json();

      expect(cleanupResponse.status).toBe(200);
      expect(cleanupPayload.ok).toBe(true);
      expect(cleanupPayload.cleanup.unresolvedPorts).toEqual([]);
      await waitForServerExit(blocker);
      blocker = null;
    } finally {
      if (blocker && blocker.exitCode === null) {
        blocker.kill("SIGTERM");
        await waitForServerExit(blocker).catch(() => undefined);
      }
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("switches to the running instance when a second launch requests switch", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-single-instance-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(join(root, "package-manifest.json"), JSON.stringify({ version: "1.2.72" }, null, 2), "utf8");

    let first: ChildProcess | null = null;
    try {
      const port = await getAvailablePort();
      first = await startStatusServer(root, port);

      const second = spawn("node", [join(root, "courseforge-serve.js"), join(root, "webapp"), String(port), "127.0.0.1", "switch"], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const [exitCode] = await once(second, "exit");
      expect(exitCode).toBe(0);

      const response = await fetchUpdateStatusWithRetry(`http://127.0.0.1:${port}/api/update-status`);
      expect(response.status).toBe(200);
    } finally {
      if (first) {
        await stopServer(first);
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});
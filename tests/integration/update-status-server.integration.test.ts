// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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

async function startStatusServer(root: string, port: number) {
  const child = spawn("node", [join(root, "courseforge-serve.js"), join(root, "webapp"), String(port), "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
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

async function stopServer(child: ChildProcess) {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await once(child, "exit");
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
      expect(releaseServer.requests[0]?.path).toBe("/releases/latest");
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
});
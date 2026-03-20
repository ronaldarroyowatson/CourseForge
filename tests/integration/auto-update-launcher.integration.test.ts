// @vitest-environment node

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";

const repoRoot = join(__dirname, "..", "..");
const launcherScriptSource = readFileSync(
  join(repoRoot, "scripts", "installer", "Start-CourseForge.ps1"),
  "utf8"
);

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createRobocopyShim(binDir: string) {
  writeFileSync(
    join(binDir, "robocopy.cmd"),
    [
      "@echo off",
      "set \"RC_SOURCE=%~1\"",
      "set \"RC_DEST=%~2\"",
      "if /I \"%ROBOCOPY_MODE%\"==\"fail\" exit /b 12",
      "if not exist \"%RC_DEST%\" mkdir \"%RC_DEST%\"",
      "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"$src=$env:RC_SOURCE; $dst=$env:RC_DEST; Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force\" >nul",
      "exit /b 1",
      "",
    ].join("\r\n"),
    "utf8"
  );
}

async function getAvailablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await new Promise<void>((resolve) => server.once("close", () => resolve()));
  return port;
}

function createTestInstallRoot(port = 3000) {
  const root = mkdtempSync(join(tmpdir(), "courseforge-launcher-"));
  const webappDir = join(root, "webapp");
  const pendingDir = join(root, "_pending_update");
  const binDir = join(root, "bin");

  mkdirSync(webappDir, { recursive: true });
  mkdirSync(join(pendingDir, "webapp"), { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(join(root, "Start-CourseForge.ps1"), launcherScriptSource.replace('$port       = 3000', `$port       = ${port}`), "utf8");
  writeFileSync(
    join(root, "courseforge-serve.js"),
    [
      "const fs = require('fs');",
      "const http = require('http');",
      "const path = require('path');",
      "const webappDir = process.argv[2];",
      "const port = Number(process.argv[3]);",
      "const host = process.argv[4];",
      "const packageRoot = path.dirname(webappDir);",
      "const server = http.createServer((req, res) => {",
      "  if (req.url === '/api/update-status') {",
      "    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });",
      "    res.end(JSON.stringify({ available: false, currentVersion: 'test' }));",
      "    return;",
      "  }",
      "  res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });",
      "  res.end(fs.readFileSync(path.join(webappDir, 'index.html'), 'utf8'));",
      "});",
      "server.listen(port, host, () => {",
      "  fs.writeFileSync(path.join(packageRoot, 'server-started.json'), JSON.stringify({ args: process.argv.slice(2) }, null, 2));",
      "  setTimeout(() => {",
      "    if (typeof server.closeAllConnections === 'function') {",
      "      server.closeAllConnections();",
      "    }",
      "    server.close(() => process.exit(0));",
      "  }, 1000);",
      "});",
      "",
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    join(root, "AutoUpdate-CourseForge.ps1"),
    [
      "param(",
      "  [string]$PackageRoot,",
      "  [string]$CurrentVersion,",
      "  [string]$AssetNameTemplate,",
      "  [switch]$StageOnly",
      ")",
      "$payload = [ordered]@{",
      "  packageRoot = $PackageRoot",
      "  currentVersion = $CurrentVersion",
      "  assetTemplate = $AssetNameTemplate",
      "  stageOnly = $StageOnly.IsPresent",
      "} | ConvertTo-Json -Depth 2",
      "Set-Content -Path (Join-Path $PackageRoot 'background-updater.json') -Value $payload -Encoding ASCII",
      "",
    ].join("\r\n"),
    "utf8"
  );

  writeFileSync(join(webappDir, "index.html"), "<html><body>old version</body></html>", "utf8");
  writeFileSync(join(pendingDir, "webapp", "index.html"), "<html><body>new version</body></html>", "utf8");

  writeJson(join(root, "package-manifest.json"), {
    version: "1.2.6",
    updates: { assetTemplate: "CourseForge-{version}-portable.zip" },
  });
  writeJson(join(pendingDir, "package-manifest.json"), {
    version: "1.2.7",
    updates: { assetTemplate: "CourseForge-{version}-portable.zip" },
  });
  writeJson(join(root, "pending-update.json"), {
    version: "1.2.7",
    assetName: "CourseForge-1.2.7-portable.zip",
    stagedAt: "2026-03-19T00:00:00.000Z",
  });

  createRobocopyShim(binDir);

  return { root, binDir, pendingDir, port };
}

type LauncherRunOptions = {
  robocopyMode: "success" | "fail";
  localAppDataOverride?: string;
};

function runLauncher(root: string, binDir: string, options: LauncherRunOptions) {
  const tempDir = join(root, "temp");
  mkdirSync(tempDir, { recursive: true });
  const localAppData = options.localAppDataOverride ?? join(root, "appdata");

  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "Start-CourseForge.ps1")],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        LOCALAPPDATA: localAppData,
        TEMP: tempDir,
        TMP: tempDir,
        PATH: `${binDir};${process.env.PATH ?? ""}`,
        ROBOCOPY_MODE: options.robocopyMode,
      },
    }
  );
}

function readLauncherLog(root: string) {
  const primary = join(root, "appdata", "CourseForge", "logs", "launcher.log");
  const primaryExists = existsSync(primary);

  const fallback = join(root, "temp", "CourseForge-launcher", "launcher.log");
  const fallbackExists = existsSync(fallback);

  if (primaryExists) {
    return {
      content: readFileSync(primary, "utf8"),
      used: "primary" as const,
      primaryPath: primary,
      fallbackPath: fallback,
      primaryExists,
      fallbackExists,
    };
  }

  if (fallbackExists) {
    return {
      content: readFileSync(fallback, "utf8"),
      used: "fallback" as const,
      primaryPath: primary,
      fallbackPath: fallback,
      primaryExists,
      fallbackExists,
    };
  }

  throw new Error(
    [
      "launcher log not found in expected locations",
      `primary=${primary} exists=${primaryExists}`,
      `fallback=${fallback} exists=${fallbackExists}`,
    ].join(" | ")
  );
}

async function waitForCondition(check: () => boolean, timeoutMs = 5000, pollMs = 50) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

async function waitForFile(filePath: string, timeoutMs = 5000) {
  await waitForCondition(() => existsSync(filePath), timeoutMs);
}

async function waitForLogEntry(logContentProvider: () => string, snippet: string, timeoutMs = 5000) {
  await waitForCondition(() => logContentProvider().includes(snippet), timeoutMs);
}

async function removeDirWithRetries(root: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY") {
        throw error;
      }

      if (attempt === 7) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function stopChildProcess(child: ChildProcess | null) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
}

async function startExistingCourseForgeServer(port: number) {
  const serverScript = [
    "const http = require('http');",
    "const server = http.createServer((req, res) => {",
    "  if (req.url === '/api/update-status') {",
    "    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });",
    "    res.end(JSON.stringify({ available: false, currentVersion: '1.2.71' }));",
    "    return;",
    "  }",
    "  res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });",
    "  res.end('<html><body>existing server</body></html>');",
    "});",
    `server.listen(${port}, () => { console.log('existing-courseforge-ready'); });`,
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join("\n");

  const child = spawn("node", ["-e", serverScript], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for existing CourseForge server")), 10000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("existing-courseforge-ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Existing CourseForge server exited early with code ${code}`));
    });
  });

  return child;
}

async function startBlockingServer(port: number) {
  const blockerScript = [
    "const http = require('http');",
    "const server = http.createServer((req, res) => {",
    "  res.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' });",
    "  res.end('busy');",
    "});",
    `server.listen(${port}, () => { console.log('blocking-ready'); });`,
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join("\n");

  const child = spawn("node", ["-e", blockerScript], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for blocking server")), 10000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("blocking-ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Blocking server exited early with code ${code}`));
    });
  });

  return child;
}

function expectLogPathDiagnostics(logDetails: ReturnType<typeof readLauncherLog>) {
  if (logDetails.used === "primary") {
    expect(logDetails.primaryExists).toBe(true);
  } else {
    expect(logDetails.primaryExists).toBe(false);
    expect(logDetails.fallbackExists).toBe(true);
  }
}

describe("portable launcher staged-update flow", () => {
  it.skipIf(process.platform !== "win32")("applies a staged update before startup and refreshes runtime version", async () => {
    const { root, binDir, pendingDir } = createTestInstallRoot();

    try {
      const result = runLauncher(root, binDir, { robocopyMode: "success" });
      await waitForFile(join(root, "background-updater.json"), 8000);
      await waitForLogEntry(() => readLauncherLog(root).content, "Active version after apply: 1.2.7", 8000);
      const logDetails = readLauncherLog(root);
      const manifest = JSON.parse(readFileSync(join(root, "package-manifest.json"), "utf8"));
      const updaterMarker = JSON.parse(readFileSync(join(root, "background-updater.json"), "utf8"));

      expect(result.status).toBe(0);
      expectLogPathDiagnostics(logDetails);
      expect(readFileSync(join(root, "webapp", "index.html"), "utf8")).toContain("new version");
      expect(manifest.version).toBe("1.2.7");
      expect(existsSync(pendingDir)).toBe(false);
      expect(existsSync(join(root, "pending-update.json"))).toBe(false);
      expect(logDetails.content).toContain("Applying staged update from _pending_update/");
      expect(logDetails.content).toContain("Active version after apply: 1.2.7");
      expect(updaterMarker.currentVersion).toBe("1.2.7");
      expect(updaterMarker.stageOnly).toBe(true);
    } finally {
      await removeDirWithRetries(root);
    }
  }, 25000);

  it.skipIf(process.platform !== "win32")("keeps staged artifacts when apply fails so the failure can be retried and diagnosed", async () => {
    const { root, binDir, pendingDir } = createTestInstallRoot();

    try {
      const result = runLauncher(root, binDir, { robocopyMode: "fail" });
      const logDetails = readLauncherLog(root);
      expectLogPathDiagnostics(logDetails);
      const manifest = JSON.parse(readFileSync(join(root, "package-manifest.json"), "utf8"));

      expect(result.status).toBe(0);
      expect(manifest.version).toBe("1.2.6");
      expect(existsSync(pendingDir)).toBe(true);
      expect(existsSync(join(root, "pending-update.json"))).toBe(true);
      expect(logDetails.content).toContain("WARNING: Apply robocopy exited with code 12. Keeping staged update for retry and investigation.");
      expect(readFileSync(join(root, "webapp", "index.html"), "utf8")).toContain("old version");
    } finally {
      await removeDirWithRetries(root);
    }
  }, 25000);

  it.skipIf(process.platform !== "win32")("falls back to temp logging when LOCALAPPDATA is unavailable and reports path outcome", async () => {
    const { root, binDir } = createTestInstallRoot();

    try {
      const result = runLauncher(root, binDir, {
        robocopyMode: "success",
        localAppDataOverride: "",
      });
      const logDetails = readLauncherLog(root);

      expect(result.status).toBe(0);
      expect(logDetails.used).toBe("fallback");
      expect(logDetails.primaryExists).toBe(false);
      expect(logDetails.fallbackExists).toBe(true);
      expect(logDetails.content).toContain("Launcher initialized.");
    } finally {
      await removeDirWithRetries(root);
    }
  }, 25000);

  it.skipIf(process.platform !== "win32")("reuses an already running CourseForge server on the fixed port", async () => {
    const port = await getAvailablePort();
    const { root, binDir } = createTestInstallRoot(port);
    let existingServer: ChildProcess | null = null;

    try {
      existingServer = await startExistingCourseForgeServer(port);
      const result = runLauncher(root, binDir, { robocopyMode: "success" });
      const logDetails = readLauncherLog(root);

      expect(result.status).toBe(0);
      expect(logDetails.content).toContain(`Existing CourseForge server detected at http://localhost:${port}`);
      expect(logDetails.content).toContain("Reusing running server.");
    } finally {
      await stopChildProcess(existingServer);
      await removeDirWithRetries(root);
    }
  }, 25000);

  it.skipIf(process.platform !== "win32")("falls back to another local port when preferred port is occupied by non-CourseForge process", async () => {
    const preferredPort = await getAvailablePort();
    const { root, binDir } = createTestInstallRoot(preferredPort);
    let blocker: ChildProcess | null = null;

    try {
      blocker = await startBlockingServer(preferredPort);
      const result = runLauncher(root, binDir, { robocopyMode: "success" });
      const logDetails = readLauncherLog(root);
      const started = JSON.parse(readFileSync(join(root, "server-started.json"), "utf8")) as { args: string[] };
      const actualPort = Number(started.args[1]);

      expect(result.status).toBe(0);
      expect(actualPort).not.toBe(preferredPort);
      expect(logDetails.content).toContain(`Preferred port ${preferredPort} is busy. Falling back to available local port`);
    } finally {
      await stopChildProcess(blocker);
      await removeDirWithRetries(root);
    }
  }, 25000);
});

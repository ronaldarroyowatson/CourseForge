// @vitest-environment node

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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

function createTestInstallRoot() {
  const root = mkdtempSync(join(tmpdir(), "courseforge-launcher-"));
  const webappDir = join(root, "webapp");
  const pendingDir = join(root, "_pending_update");
  const binDir = join(root, "bin");

  mkdirSync(webappDir, { recursive: true });
  mkdirSync(join(pendingDir, "webapp"), { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(join(root, "Start-CourseForge.ps1"), launcherScriptSource, "utf8");
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

  return { root, binDir, pendingDir };
}

function runLauncher(root: string, binDir: string, robocopyMode: "success" | "fail") {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "Start-CourseForge.ps1")],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        LOCALAPPDATA: join(root, "appdata"),
        PATH: `${binDir};${process.env.PATH ?? ""}`,
        ROBOCOPY_MODE: robocopyMode,
      },
    }
  );
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

describe("portable launcher staged-update flow", () => {
  it.skipIf(process.platform !== "win32")("applies a staged update before startup and refreshes runtime version", async () => {
    const { root, binDir, pendingDir } = createTestInstallRoot();

    try {
      const result = runLauncher(root, binDir, "success");
      const launcherLog = readFileSync(join(root, "appdata", "CourseForge", "logs", "launcher.log"), "utf8");
      const manifest = JSON.parse(readFileSync(join(root, "package-manifest.json"), "utf8"));
      const updaterMarker = JSON.parse(readFileSync(join(root, "background-updater.json"), "utf8"));

      expect(result.status).toBe(0);
      expect(readFileSync(join(root, "webapp", "index.html"), "utf8")).toContain("new version");
      expect(manifest.version).toBe("1.2.7");
      expect(existsSync(pendingDir)).toBe(false);
      expect(existsSync(join(root, "pending-update.json"))).toBe(false);
      expect(launcherLog).toContain("Applying staged update from _pending_update/");
      expect(launcherLog).toContain("Active version after apply: 1.2.7");
      expect(updaterMarker.currentVersion).toBe("1.2.7");
      expect(updaterMarker.stageOnly).toBe(true);
    } finally {
      await removeDirWithRetries(root);
    }
  }, 25000);

  it.skipIf(process.platform !== "win32")("keeps staged artifacts when apply fails so the failure can be retried and diagnosed", async () => {
    const { root, binDir, pendingDir } = createTestInstallRoot();

    try {
      const result = runLauncher(root, binDir, "fail");
      const launcherLog = readFileSync(join(root, "appdata", "CourseForge", "logs", "launcher.log"), "utf8");
      const manifest = JSON.parse(readFileSync(join(root, "package-manifest.json"), "utf8"));

      expect(result.status).toBe(0);
      expect(manifest.version).toBe("1.2.6");
      expect(existsSync(pendingDir)).toBe(true);
      expect(existsSync(join(root, "pending-update.json"))).toBe(true);
      expect(launcherLog).toContain("WARNING: Apply robocopy exited with code 12. Keeping staged update for retry and investigation.");
      expect(readFileSync(join(root, "webapp", "index.html"), "utf8")).toContain("old version");
    } finally {
      await removeDirWithRetries(root);
    }
  }, 25000);
});
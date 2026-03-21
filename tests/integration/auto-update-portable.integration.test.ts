// @vitest-environment node

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import JSZip from "jszip";

const repoRoot = join(__dirname, "..", "..");
const updaterScriptPath = join(repoRoot, "scripts", "auto-update-portable.ps1");

async function createPortableZip(zipPath: string, files: Record<string, string>) {
  const zip = new JSZip();

  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(zipPath, buffer);
}

async function startAssetServer(assetPath: string) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "const fs = require('fs');",
        "const http = require('http');",
        "const assetPath = process.argv[1];",
        "const server = http.createServer((req, res) => {",
        "  const payload = fs.readFileSync(assetPath);",
        "  res.writeHead(200, {",
        "    'Content-Type': 'application/zip',",
        "    'Content-Length': payload.length,",
        "    Connection: 'close'",
        "  });",
        "  res.end(payload);",
        "});",
        "server.listen(0, '127.0.0.1', () => {",
        "  const address = server.address();",
        "  process.stdout.write(JSON.stringify({ port: address.port }) + '\\n');",
        "});",
        "const shutdown = () => server.close(() => process.exit(0));",
        "process.on('SIGTERM', shutdown);",
        "process.on('SIGINT', shutdown);",
      ].join(" "),
      assetPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const port = await new Promise<number>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const cleanup = () => {
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newlineIndex = stdout.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      cleanup();
      const firstLine = stdout.slice(0, newlineIndex).trim();
      resolve(JSON.parse(firstLine).port);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      cleanup();
      reject(error);
    });

    child.on("exit", (code) => {
      cleanup();
      reject(new Error(`Asset server exited early with code ${code}. ${stderr}`.trim()));
    });
  });

  return {
    server: child,
    url: `http://127.0.0.1:${port}/asset.zip`,
  };
}

async function closeServer(server: ChildProcess | null) {
  if (!server) {
    return;
  }

  if (server.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill();
  });
}

function runUpdater(args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", updaterScriptPath, ...args],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

describe("portable updater script", () => {
  it.skipIf(process.platform !== "win32")("returns 0 when latest release is not newer", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-updater-"));

    try {
      const releasePath = join(root, "latest.json");
      writeFileSync(
        releasePath,
        JSON.stringify({ tag_name: "v1.2.1", assets: [] }, null, 2),
        "utf8"
      );

      const result = await runUpdater([
        "-PackageRoot",
        root,
        "-CurrentVersion",
        "1.2.1",
        "-LatestReleaseJsonPath",
        releasePath,
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")("returns 2 in check-only mode when update is available", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-updater-"));

    try {
      const releasePath = join(root, "latest.json");
      writeFileSync(
        releasePath,
        JSON.stringify(
          {
            tag_name: "v1.2.2",
            assets: [{ name: "CourseForge-1.2.2-portable.zip", browser_download_url: "https://example.invalid/file.zip" }],
          },
          null,
          2
        ),
        "utf8"
      );

      const result = await runUpdater([
        "-PackageRoot",
        root,
        "-CurrentVersion",
        "1.2.1",
        "-LatestReleaseJsonPath",
        releasePath,
        "-CheckOnly",
      ]);

      expect(result.status).toBe(2);
      expect(result.stdout).toContain("Update available");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")("stages the downloaded package and writes pending metadata for the next launch", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-updater-"));
    let server: ChildProcess | null = null;

    try {
      const zipPath = join(root, "portable.zip");
      await createPortableZip(zipPath, {
        "webapp/index.html": "<html><body>updated</body></html>",
        "package-manifest.json": JSON.stringify({ version: "1.2.7" }, null, 2),
      });

      const assetServer = await startAssetServer(zipPath);
      server = assetServer.server;

      const releasePath = join(root, "latest.json");
      writeFileSync(
        releasePath,
        JSON.stringify(
          {
            tag_name: "v1.2.7",
            html_url: "https://example.invalid/releases/tag/v1.2.7",
            assets: [
              {
                name: "CourseForge-1.2.7-portable.zip",
                browser_download_url: assetServer.url,
              },
            ],
          },
          null,
          2
        ),
        "utf8"
      );

      const result = await runUpdater([
        "-PackageRoot",
        root,
        "-CurrentVersion",
        "1.2.6",
        "-LatestReleaseJsonPath",
        releasePath,
        "-StageOnly",
      ]);

      const pendingInfo = JSON.parse(readFileSync(join(root, "pending-update.json"), "utf8"));
      const stagedIndex = readFileSync(join(root, "_pending_update", "webapp", "index.html"), "utf8");
      const updaterLog = readFileSync(join(root, "updater.log"), "utf8");

      expect(result.status).toBe(0);
      expect(pendingInfo.version).toBe("1.2.7");
      expect(pendingInfo.currentVersion).toBe("1.2.6");
      expect(stagedIndex).toContain("updated");
      expect(updaterLog).toContain("Staged update 1.2.6 -> 1.2.7 in _pending_update/");
    } finally {
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  }, 15000);

  it.skipIf(process.platform !== "win32")("logs a useful diagnostic when the downloaded package is missing the webapp payload", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-updater-"));
    let server: ChildProcess | null = null;

    try {
      const zipPath = join(root, "portable.zip");
      await createPortableZip(zipPath, {
        "package-manifest.json": JSON.stringify({ version: "1.2.7" }, null, 2),
      });

      const assetServer = await startAssetServer(zipPath);
      server = assetServer.server;

      const releasePath = join(root, "latest.json");
      writeFileSync(
        releasePath,
        JSON.stringify(
          {
            tag_name: "v1.2.7",
            assets: [
              {
                name: "CourseForge-1.2.7-portable.zip",
                browser_download_url: assetServer.url,
              },
            ],
          },
          null,
          2
        ),
        "utf8"
      );

      const result = await runUpdater([
        "-PackageRoot",
        root,
        "-CurrentVersion",
        "1.2.6",
        "-LatestReleaseJsonPath",
        releasePath,
        "-StageOnly",
      ]);

      const updaterLog = readFileSync(join(root, "updater.log"), "utf8");

      expect(result.status).toBe(0);
      expect(existsSync(join(root, "pending-update.json"))).toBe(false);
      expect(updaterLog).toContain("Downloaded update is missing webapp/index.html.");
    } finally {
      await closeServer(server);
      rmSync(root, { recursive: true, force: true });
    }
  }, 15000);

  it.skipIf(process.platform !== "win32")("writes updater error diagnostics when latest release metadata is invalid", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-updater-"));

    try {
      const releasePath = join(root, "latest.json");
      writeFileSync(releasePath, "{ invalid-json", "utf8");

      const result = await runUpdater([
        "-PackageRoot",
        root,
        "-CurrentVersion",
        "1.2.76",
        "-LatestReleaseJsonPath",
        releasePath,
        "-CheckOnly",
      ]);

      const updaterLog = readFileSync(join(root, "updater.log"), "utf8");
      const statusPayload = JSON.parse(
        readFileSync(join(root, "updater-status.json"), "utf8")
      ) as {
        state?: string;
        lastError?: string;
      };

      // Updater errors are reported through diagnostics payload + log, not process exit code.
      expect(result.status).toBe(0);
      expect(statusPayload.state).toBe("error");
      expect(statusPayload.lastError).toMatch(
        /(Unexpected character encountered|Invalid object passed in)/
      );
      expect(updaterLog).toContain("Updater start. Mode=check-only");
      expect(updaterLog).toContain("updater error:");
      expect(updaterLog).toContain("auto-update-portable.ps1: line");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

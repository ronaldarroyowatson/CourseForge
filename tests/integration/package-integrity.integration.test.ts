// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..");
const integrityScriptPath = join(repoRoot, "scripts", "installer", "Test-CourseForge-Integrity.ps1");

function buildManifest(version: string, files: Record<string, string>) {
  return JSON.stringify(
    {
      name: "CourseForge",
      version,
      generatedAtUtc: "2026-03-20T00:00:00.000Z",
      dependencyVersions: { node: ">=20 <25" },
      requiredNodeVersion: ">=20 <25",
      requiredConfigSchemaVersion: "1",
      requiredDatabaseSchemaVersion: "1",
      requiredExtensionSchemaVersion: "1",
      files: Object.entries(files)
        .filter(([filePath]) => filePath !== "manifest.json")
        .map(([filePath, content]) => ({
          path: filePath,
          sizeBytes: Buffer.byteLength(content),
          sha256: createHash("sha256").update(content).digest("hex"),
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    },
    null,
    2
  );
}

function writePackageFiles(root: string, files: Record<string, string>) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = join(root, ...relativePath.split("/"));
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
  }
}

function runIntegrityCheck(packageRoot: string, outputPath: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        integrityScriptPath,
        "-PackageRoot",
        packageRoot,
        "-OutputPath",
        outputPath,
        "-Quiet",
      ],
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
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("portable package integrity script", () => {
  it.skipIf(process.platform !== "win32")("passes for a healthy portable package manifest and reports schema metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-integrity-"));

    try {
      const files = {
        "webapp/index.html": "<html><body>healthy</body></html>",
        "package-manifest.json": JSON.stringify({ version: "1.2.77" }, null, 2),
      } satisfies Record<string, string>;
      files["manifest.json"] = buildManifest("1.2.77", files);
      writePackageFiles(root, files);

      const outputPath = join(root, "integrity-status.json");
      const result = await runIntegrityCheck(root, outputPath);
      const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
        ok: boolean;
        packageVersion?: string;
        requiredNodeVersion?: string;
        requiredConfigSchemaVersion?: string;
        summary?: { trackedFiles?: number; missing?: number; corrupted?: number; extras?: number };
      };

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(payload.ok).toBe(true);
      expect(payload.packageVersion).toBe("1.2.77");
      expect(payload.requiredNodeVersion).toBe(">=20 <25");
      expect(payload.requiredConfigSchemaVersion).toBe("1");
      expect(payload.summary).toMatchObject({ trackedFiles: 2, missing: 0, corrupted: 0, extras: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")("flags missing, corrupted, and unexpected files while ignoring preserved runtime caches", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-integrity-"));

    try {
      const files = {
        "webapp/index.html": "<html><body>healthy</body></html>",
        "package-manifest.json": JSON.stringify({ version: "1.2.77" }, null, 2),
      } satisfies Record<string, string>;
      files["manifest.json"] = buildManifest("1.2.77", files);
      writePackageFiles(root, files);

      rmSync(join(root, "package-manifest.json"), { force: true });
      writeFileSync(join(root, "webapp", "index.html"), "<html><body>damaged</body></html>", "utf8");
      writeFileSync(join(root, "unexpected.txt"), "surprise", "utf8");
      mkdirSync(join(root, "ocr-cache"), { recursive: true });
      writeFileSync(join(root, "ocr-cache", "cached.json"), "{}", "utf8");

      const outputPath = join(root, "integrity-status.json");
      const result = await runIntegrityCheck(root, outputPath);
      const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
        ok: boolean;
        missing: string[];
        corrupted: string[];
        extras: string[];
        summary?: { missing?: number; corrupted?: number; extras?: number };
      };

      expect(result.status).toBe(3);
      expect(payload.ok).toBe(false);
      expect(payload.missing).toContain("package-manifest.json");
      expect(payload.corrupted).toContain("webapp/index.html");
      expect(payload.extras).toContain("unexpected.txt");
      expect(payload.extras).not.toContain("ocr-cache/cached.json");
      expect(payload.summary).toMatchObject({ missing: 1, corrupted: 1, extras: 1 });
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
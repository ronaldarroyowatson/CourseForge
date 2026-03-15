import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(__dirname, "..", "..");
const updaterScriptPath = join(repoRoot, "scripts", "auto-update-portable.ps1");

function runUpdater(args: string[]) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", updaterScriptPath, ...args],
    { encoding: "utf8" }
  );
}

describe("portable updater script", () => {
  it.skipIf(process.platform !== "win32")("returns 0 when latest release is not newer", () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-updater-"));

    try {
      const releasePath = join(root, "latest.json");
      writeFileSync(
        releasePath,
        JSON.stringify({ tag_name: "v1.2.1", assets: [] }, null, 2),
        "utf8"
      );

      const result = runUpdater([
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

  it.skipIf(process.platform !== "win32")("returns 2 in check-only mode when update is available", () => {
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

      const result = runUpdater([
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
});

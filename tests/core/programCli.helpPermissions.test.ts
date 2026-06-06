import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("program CLI help and permissions workflow", () => {
  let tempLocalAppData = "";

  beforeEach(() => {
    tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-help-perms-"));
  });

  afterEach(() => {
    fs.rmSync(tempLocalAppData, { recursive: true, force: true });
  });

  it("supports courseforge help and help examples", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    const rootHelp = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "help"], {
      cwd: process.cwd(),
      env,
    });

    expect(rootHelp.stdout).toContain("courseforge help");
    expect(rootHelp.stdout).toContain("Command groups:");
    expect(rootHelp.stdout).toContain("permissions");

    const permissionsExamples = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "help", "permissions", "--examples"], {
      cwd: process.cwd(),
      env,
    });

    expect(permissionsExamples.stdout).toContain("Examples:");
    expect(permissionsExamples.stdout).toContain("courseforge permissions audit --json");

    const ocrExamples = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "help", "ocr", "--examples"], {
      cwd: process.cwd(),
      env,
    });

    expect(ocrExamples.stdout).toContain("courseforge ocr run --image-file");
    expect(ocrExamples.stdout).toContain("courseforge ocr iterate --image-file");
    expect(ocrExamples.stdout).toContain("courseforge ocr debug rate-limits --json");
  });

  it("supports permissions audit in json mode", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    const result = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "permissions", "audit", "--json"], {
      cwd: process.cwd(),
      env,
    });

    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual(expect.objectContaining({
      platform: expect.any(String),
      checks: expect.objectContaining({
        fileSystem: expect.objectContaining({ status: expect.any(String) }),
        localOcr: expect.objectContaining({ status: expect.any(String) }),
      }),
    }));
  });

  it("supports permissions repair and reset dry-run in json mode", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    const repairResult = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "permissions", "repair", "--json"], {
      cwd: process.cwd(),
      env,
    });
    const repair = JSON.parse(repairResult.stdout);
    expect(repair).toEqual(expect.objectContaining({
      action: "repair",
      dryRun: true,
      applied: false,
    }));

    const resetResult = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "permissions", "reset", "--json"], {
      cwd: process.cwd(),
      env,
    });
    const reset = JSON.parse(resetResult.stdout);
    expect(reset).toEqual(expect.objectContaining({
      action: "reset",
      dryRun: true,
      applied: false,
    }));
  });
});

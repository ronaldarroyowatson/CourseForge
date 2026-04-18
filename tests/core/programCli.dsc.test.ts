import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("program CLI DSC workflow", () => {
  let tempLocalAppData = "";

  beforeEach(() => {
    tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-dsc-"));
  });

  afterEach(() => {
    fs.rmSync(tempLocalAppData, { recursive: true, force: true });
  });

  it("supports dsc enable, report, disable, and clear through the existing debug entry", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "debug", "dsc", "enable"], {
      cwd: process.cwd(),
      env,
    });

    const reportRun = await execFileAsync(
      process.execPath,
      ["scripts/program-cli.mjs", "debug", "dsc", "report", "--page", "settings", "--card", "Debug Log"],
      {
        cwd: process.cwd(),
        env,
      }
    );

    const report = JSON.parse(reportRun.stdout);
    expect(report.enabled).toBe(true);
    expect(report.page.id).toBe("settings");
    expect(report.card.id).toBe("debug-log");
    expect(report.card.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "debug-toggle" }),
        expect.objectContaining({ id: "debug-clear" }),
        expect.objectContaining({ id: "debug-send" }),
      ])
    );
    expect(report.tokens.MAJOR.resolvedValue).toBe("#2563EB");

    await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "debug", "dsc", "disable"], {
      cwd: process.cwd(),
      env,
    });

    const disabledReportRun = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "debug", "dsc", "report"], {
      cwd: process.cwd(),
      env,
    });
    expect(JSON.parse(disabledReportRun.stdout).enabled).toBe(false);

    const reportPath = path.join(tempLocalAppData, "report.json");
    await execFileAsync(
      process.execPath,
      ["scripts/program-cli.mjs", "debug", "dsc", "report", "--report", reportPath],
      {
        cwd: process.cwd(),
        env,
      }
    );
    expect(fs.existsSync(reportPath)).toBe(true);

    await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "debug", "dsc", "clear"], {
      cwd: process.cwd(),
      env,
    });

    const cachePath = path.join(tempLocalAppData, "CourseForge", "debug", "dsc-debug-report.json");
    expect(fs.existsSync(cachePath)).toBe(false);
  });
});
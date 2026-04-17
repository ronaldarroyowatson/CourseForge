import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("program CLI unified debug report", () => {
  it("generates unified debug report with locked semantic palette", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-cli-debug-"));
    const env = { ...process.env, LOCALAPPDATA: tempRoot };
    const outputPath = path.join(tempRoot, "debug-report.json");

    execFileSync("node", ["scripts/program-cli.mjs", "debug", "--enable", "--report", outputPath], {
      cwd: process.cwd(),
      env,
      stdio: "pipe",
    });

    expect(fs.existsSync(outputPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
      palette: Record<string, string>;
      semanticTokens: { roles: Record<string, string> };
      componentTokenMaps: Record<string, Record<string, string>>;
      fallbackRecords: Array<unknown>;
      uiIntrospection: {
        pages: Array<{
          pageId: string;
          cards: Array<{ cardId: string }>;
        }>;
      };
    };

    expect(report.palette.major).toBe("#2563EB");
    expect(report.palette.minor).toBe("#73A2F5");
    expect(report.palette.accent).toBe("#FFFFFF");
    expect(report.palette.success).toBe("#22C55E");
    expect(report.palette.warning).toBe("#FACC15");
    expect(report.palette.error).toBe("#EF4444");
    expect(report.palette.info).toBe("#06B6D4");
    expect(report.semanticTokens.roles.major).toBe("#2563EB");
    expect(report.componentTokenMaps.buttonPrimary.default).toBe("#2563EB");
    expect(report.fallbackRecords.length).toBeGreaterThan(0);
    expect(report.uiIntrospection.pages.length).toBeGreaterThan(0);
    expect(report.uiIntrospection.pages[0].cards.length).toBeGreaterThan(0);
  });

  it("supports page/card scoped debug reports", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-cli-debug-scope-"));
    const env = { ...process.env, LOCALAPPDATA: tempRoot };
    const outputPath = path.join(tempRoot, "debug-report-scope.json");

    execFileSync("node", [
      "scripts/program-cli.mjs",
      "debug",
      "--report",
      outputPath,
      "--page",
      "settings",
      "--card",
      "design-system-controls",
    ], {
      cwd: process.cwd(),
      env,
      stdio: "pipe",
    });

    const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
      uiIntrospection: {
        pages: Array<{
          pageId: string;
          cards: Array<{ cardId: string }>;
        }>;
      };
    };

    expect(report.uiIntrospection.pages).toHaveLength(1);
    expect(report.uiIntrospection.pages[0]?.pageId).toBe("settings");
    expect(report.uiIntrospection.pages[0]?.cards).toHaveLength(1);
    expect(report.uiIntrospection.pages[0]?.cards[0]?.cardId).toBe("design-system-controls");
  });

  it("supports clearing logs through unified debug flags", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-cli-debug-clear-"));
    const env = { ...process.env, LOCALAPPDATA: tempRoot };

    execFileSync("node", ["scripts/program-cli.mjs", "debug", "sample-feature"], {
      cwd: process.cwd(),
      env,
      stdio: "pipe",
    });

    execFileSync("node", ["scripts/program-cli.mjs", "debug", "--clear"], {
      cwd: process.cwd(),
      env,
      stdio: "pipe",
    });

    const logPath = path.join(tempRoot, "CourseForge", "debug", "debug-log.jsonl");
    const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    expect(content.trim()).toBe("");
  });
});

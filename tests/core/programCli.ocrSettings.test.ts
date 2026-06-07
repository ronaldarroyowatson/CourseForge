import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("program CLI OCR settings", () => {
  let tempLocalAppData = "";

  beforeEach(() => {
    tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-ocr-settings-"));
  });

  afterEach(() => {
    fs.rmSync(tempLocalAppData, { recursive: true, force: true });
  });

  async function login(env: NodeJS.ProcessEnv): Promise<void> {
    await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "login",
      "--role",
      "teacher",
      "--uid",
      "ocr-settings-test",
      "--email",
      "ocr-settings-test@courseforge.test",
    ], {
      cwd: process.cwd(),
      env,
    });
  }

  it("supports get/set/reset lifecycle with JSON output", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    await login(env);

    const setResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "ocr",
      "settings",
      "set",
      "--auto-retries",
      "false",
      "--max-retries",
      "4",
      "--shots",
      "2",
      "--crop-strategy",
      "bw",
      "--dynamic-limits",
      "true",
      "--limit-buffer",
      "7",
      "--primary-provider",
      "github",
      "--fallback",
      "backup",
      "--debug-level",
      "trace",
      "--json",
    ], {
      cwd: process.cwd(),
      env,
    });

    const setParsed = JSON.parse(setResult.stdout) as { ok: boolean; action: string; settings: Record<string, unknown> };
    expect(setParsed.ok).toBe(true);
    expect(setParsed.action).toBe("set");
    expect(setParsed.settings).toEqual(expect.objectContaining({
      autoRetriesEnabled: false,
      maxRetryAttempts: 4,
      shots: 2,
      cropStrategy: "bw",
      dynamicRateLimitAdaptation: true,
      dynamicLimitBufferSeconds: 7,
      primaryProvider: "cloud_github_models_vision",
      fallbackBehavior: "backup",
      debugLevel: "trace",
    }));

    const getResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "ocr",
      "settings",
      "get",
      "--json",
    ], {
      cwd: process.cwd(),
      env,
    });

    const getParsed = JSON.parse(getResult.stdout) as { ok: boolean; action: string; settings: Record<string, unknown> };
    expect(getParsed.ok).toBe(true);
    expect(getParsed.action).toBe("get");
    expect(getParsed.settings).toEqual(expect.objectContaining({
      shots: 2,
      cropStrategy: "bw",
      primaryProvider: "cloud_github_models_vision",
    }));

    const resetResult = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "ocr",
      "settings",
      "reset",
      "--json",
    ], {
      cwd: process.cwd(),
      env,
    });

    const resetParsed = JSON.parse(resetResult.stdout) as { ok: boolean; action: string; settings: Record<string, unknown> };
    expect(resetParsed.ok).toBe(true);
    expect(resetParsed.action).toBe("reset");
    expect(resetParsed.settings).toEqual(expect.objectContaining({
      primaryProvider: "cloud_openai_vision",
      shots: 3,
      cropStrategy: "both",
    }));
  });

  it("exports and imports OCR settings", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    await login(env);

    const exportPath = path.join(tempLocalAppData, "ocr-settings-export.json");

    await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "ocr",
      "settings",
      "set",
      "--primary-provider",
      "github",
      "--debug-level",
      "verbose",
      "--shots",
      "1",
      "--json",
    ], {
      cwd: process.cwd(),
      env,
    });

    await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "ocr",
      "settings",
      "export",
      "--output",
      exportPath,
      "--json",
    ], {
      cwd: process.cwd(),
      env,
    });

    const exported = JSON.parse(fs.readFileSync(exportPath, "utf8")) as Record<string, unknown>;
    expect(exported).toEqual(expect.objectContaining({
      primaryProvider: "cloud_github_models_vision",
      debugLevel: "verbose",
      shots: 1,
    }));

    await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "ocr",
      "settings",
      "reset",
      "--json",
    ], {
      cwd: process.cwd(),
      env,
    });

    await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "ocr",
      "settings",
      "import",
      "--input",
      exportPath,
      "--json",
    ], {
      cwd: process.cwd(),
      env,
    });

    const afterImport = await execFileAsync(process.execPath, [
      "scripts/program-cli.mjs",
      "ocr",
      "settings",
      "show",
      "--json",
    ], {
      cwd: process.cwd(),
      env,
    });

    const imported = JSON.parse(afterImport.stdout) as { settings: Record<string, unknown> };
    expect(imported.settings).toEqual(expect.objectContaining({
      primaryProvider: "cloud_github_models_vision",
      debugLevel: "verbose",
      shots: 1,
    }));
  });
});

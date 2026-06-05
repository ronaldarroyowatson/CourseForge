import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function loginAsTeacher(env: NodeJS.ProcessEnv) {
  await execFileAsync(process.execPath, [
    "scripts/program-cli.mjs",
    "login",
    "--role",
    "teacher",
    "--uid",
    "teacher-test-uid",
    "--email",
    "teacher@courseforge.test",
  ], {
    cwd: process.cwd(),
    env,
  });
}

describe("program CLI OCR debug workflow", () => {
  let tempLocalAppData = "";

  beforeEach(() => {
    tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-ocr-cli-"));

    const debugDir = path.join(tempLocalAppData, "CourseForge", "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const logPath = path.join(debugDir, "debug-log.jsonl");
    fs.writeFileSync(logPath, [
      JSON.stringify({ timestamp: "2026-06-05T10:00:00.000Z", subsystem: "ocr", severity: "info", message: "OCR fallback_started", context: { traceId: "ocr-1" } }),
      JSON.stringify({ timestamp: "2026-06-05T10:00:02.000Z", subsystem: "ocr", severity: "warning", message: "OCR provider_extract_empty_text", context: { traceId: "ocr-1" } }),
      JSON.stringify({ timestamp: "2026-06-05T10:00:03.000Z", subsystem: "ocr", severity: "info", message: "OCR provider_extract_succeeded", context: { traceId: "ocr-1" } }),
      "",
    ].join("\n"), "utf8");
  });

  afterEach(() => {
    fs.rmSync(tempLocalAppData, { recursive: true, force: true });
  });

  it("returns OCR debug trace and fallback views", async () => {
    const env = { ...process.env, LOCALAPPDATA: tempLocalAppData };

    await loginAsTeacher(env);

    const trace = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "ocr", "debug", "trace", "--json"], {
      cwd: process.cwd(),
      env,
    });
    const tracePayload = JSON.parse(trace.stdout);
    expect(tracePayload.view).toBe("trace");
    expect(tracePayload.totalEvents).toBeGreaterThan(0);

    const fallback = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "ocr", "debug", "fallback", "--json"], {
      cwd: process.cwd(),
      env,
    });
    const fallbackPayload = JSON.parse(fallback.stdout);
    expect(fallbackPayload.view).toBe("fallback");
    expect(fallbackPayload.totalEvents).toBeGreaterThan(0);
  });

  it("supports OCR debug export html output", async () => {
    const env = { ...process.env, LOCALAPPDATA: tempLocalAppData };
    await loginAsTeacher(env);
    const outPath = path.join(tempLocalAppData, "ocr-debug.html");

    await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "ocr", "debug", "export", "--html", "--output", outPath], {
      cwd: process.cwd(),
      env,
    });

    expect(fs.existsSync(outPath)).toBe(true);
    const html = fs.readFileSync(outPath, "utf8");
    expect(html).toContain("CourseForge OCR Debug Export");
  });
});

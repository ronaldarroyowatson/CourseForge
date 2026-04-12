import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("program CLI design token recovery", () => {
  it("writes recovery payload and debug trace entry", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-cli-"));
    const env = { ...process.env, LOCALAPPDATA: tempRoot };

    execFileSync("node", ["scripts/program-cli.mjs", "settings", "reset-design-tokens"], {
      cwd: process.cwd(),
      env,
      stdio: "pipe",
    });

    const debugDir = path.join(tempRoot, "CourseForge", "debug");
    const payloadPath = path.join(debugDir, "design-token-recovery.json");
    const logPath = path.join(debugDir, "debug-log.jsonl");

    expect(fs.existsSync(payloadPath)).toBe(true);
    expect(fs.existsSync(logPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8")) as { resetToDefaults: boolean };
    expect(payload.resetToDefaults).toBe(true);

    const logText = fs.readFileSync(logPath, "utf8");
    expect(logText).toContain("reset design tokens");
  });
});

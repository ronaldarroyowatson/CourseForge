import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

function readJson<T = Record<string, unknown>>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8")) as T;
}

describe("MemPalace startup isolation", () => {
  it("keeps app dev startup independent from MemPalace watchdog", () => {
    const packageJson = readJson<{ scripts?: Record<string, string> }>("package.json");
    const devCommand = packageJson.scripts?.dev ?? "";

    expect(devCommand).toContain("vite");
    expect(devCommand.toLowerCase()).not.toContain("mempalace");
    expect(devCommand.toLowerCase()).not.toContain("watchdog");
    expect(devCommand.toLowerCase()).not.toContain("preflight");
  });

  it("starts MemPalace from workspace task with at most one retry", () => {
    const tasksJson = readJson<{ tasks?: Array<{ label?: string; command?: string }> }>(".vscode/tasks.json");
    const task = tasksJson.tasks?.find((entry) => entry.label === "Start MemPalace MCP Server");

    expect(task).toBeDefined();
    const command = task?.command ?? "";

    expect(command.toLowerCase()).toContain("mempalace_watchdog.js --once");

    const onceCount = (command.match(/mempalace_watchdog\.js --once/g) ?? []).length;
    expect(onceCount).toBeLessThanOrEqual(2);
  });
});

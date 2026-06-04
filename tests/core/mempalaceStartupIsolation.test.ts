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

  it("lets VS Code own MemPalace MCP startup without a watchdog task on folder open", () => {
    const settingsJson = readJson<{
      tasks?: { runOnFolderOpen?: string };
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
    }>(".vscode/settings.json");
    const tasksJson = readJson<{ tasks?: Array<{ label?: string; command?: string }> }>(".vscode/tasks.json");
    const task = tasksJson.tasks?.find((entry) => entry.label === "Start MemPalace MCP Server");

    expect(settingsJson["tasks.runOnFolderOpen" as keyof typeof settingsJson]).toBe("noop");
    expect(settingsJson.mcpServers?.mempalace?.command).toBe("mempalace");
    expect(settingsJson.mcpServers?.mempalace?.args).toEqual(["mcp"]);
    expect(task).toBeDefined();
    const command = task?.command ?? "";

    expect(command).toContain("mempalace mcp");
    expect(command).toContain("mempalace-startup-check.mjs");
    expect(command.toLowerCase()).not.toContain("watchdog");
  });
});

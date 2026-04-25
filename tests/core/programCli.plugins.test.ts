import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("program CLI plugin workflow", () => {
  let tempLocalAppData = "";

  beforeEach(() => {
    tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "courseforge-plugins-"));
    fs.rmSync(path.join(process.cwd(), ".debug", "plugins", "dsc"), { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(tempLocalAppData, { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), ".debug", "plugins", "dsc"), { recursive: true, force: true });
  });

  it("supports plugin install, uninstall, and status", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    const initialStatus = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "plugins", "status"], {
      cwd: process.cwd(),
      env,
    });

    const initial = JSON.parse(initialStatus.stdout);
    expect(initial.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ id: "dsc", installed: false })]));

    const installed = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "plugins", "install", "dsc"], {
      cwd: process.cwd(),
      env,
    });
    expect(JSON.parse(installed.stdout)).toEqual(expect.objectContaining({ plugin: "dsc", installed: true, ok: true }));

    const postInstallStatus = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "plugins", "status"], {
      cwd: process.cwd(),
      env,
    });
    const postInstall = JSON.parse(postInstallStatus.stdout);
    expect(postInstall.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ id: "dsc", installed: true })]));

    const uninstalled = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "plugins", "uninstall", "dsc"], {
      cwd: process.cwd(),
      env,
    });
    expect(JSON.parse(uninstalled.stdout)).toEqual(expect.objectContaining({ plugin: "dsc", installed: false, ok: true }));

    const postUninstallStatus = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "plugins", "status"], {
      cwd: process.cwd(),
      env,
    });
    const postUninstall = JSON.parse(postUninstallStatus.stdout);
    expect(postUninstall.plugins).toEqual(expect.arrayContaining([expect.objectContaining({ id: "dsc", installed: false })]));

    const artifactDir = path.join(process.cwd(), ".debug", "plugins", "dsc");
    expect(fs.existsSync(artifactDir)).toBe(true);
    const artifactFiles = fs.readdirSync(artifactDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    expect(artifactFiles.some((name) => name.includes("_detect.json"))).toBe(true);
    expect(artifactFiles.some((name) => name.includes("_install.json"))).toBe(true);
    expect(artifactFiles.some((name) => name.includes("_uninstall.json"))).toBe(true);
    expect(artifactFiles.some((name) => name.includes("_refresh.json"))).toBe(true);

    const pluginStatePath = path.join(tempLocalAppData, "CourseForge", "plugins", "plugins-state.json");
    const persistedState = JSON.parse(fs.readFileSync(pluginStatePath, "utf8"));
    expect(persistedState.installed.dsc).toBeUndefined();
  });

  it("handles missing plugins gracefully", async () => {
    const env = {
      ...process.env,
      LOCALAPPDATA: tempLocalAppData,
    };

    const result = await execFileAsync(process.execPath, ["scripts/program-cli.mjs", "plugins", "install", "missing-plugin"], {
      cwd: process.cwd(),
      env,
    });

    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
      plugin: "missing-plugin",
      ok: true,
      message: "Plugin manifest not found. No action applied.",
    }));
  });
});

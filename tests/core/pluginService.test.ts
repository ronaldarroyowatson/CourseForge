import { beforeEach, describe, expect, it } from "vitest";

import {
  getPluginStatus,
  getPluginStatuses,
  installPlugin,
  loadPlugin,
  refreshPluginStatus,
  uninstallPlugin,
  unloadPlugin,
} from "../../src/core/services/pluginService";

describe("pluginService", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("detects plugin presence and default uninstalled status", async () => {
    const statuses = await getPluginStatuses();
    expect(statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        manifest: expect.objectContaining({ id: "dsc" }),
        installed: false,
      }),
    ]));
  });

  it("installs and loads dsc plugin dynamically", async () => {
    const installed = await installPlugin("dsc");
    expect(installed.installed).toBe(true);

    const loaded = await loadPlugin("dsc");
    expect(loaded.loaded).toBe(true);

    const status = await getPluginStatus("dsc");
    expect(status?.installed).toBe(true);
  });

  it("unloads and uninstalls dsc plugin dynamically", async () => {
    await installPlugin("dsc");
    await loadPlugin("dsc");

    const unloaded = await unloadPlugin("dsc");
    expect(unloaded.loaded).toBe(false);

    const uninstalled = await uninstallPlugin("dsc");
    expect(uninstalled.installed).toBe(false);
  });

  it("returns error state for missing plugin", async () => {
    const missing = await installPlugin("missing-plugin");
    expect(missing.error).toBe("missing-plugin");
    expect(missing.installed).toBe(false);
  });

  it("refreshes DSC status and clears persisted install keys on uninstall", async () => {
    window.localStorage.setItem("courseforge.plugins.dsc.installed", "true");

    await installPlugin("dsc");
    const refreshedInstalled = await refreshPluginStatus("dsc");
    expect(refreshedInstalled.installed).toBe(true);
    expect(refreshedInstalled.loaded).toBe(true);

    await uninstallPlugin("dsc");
    const refreshedUninstalled = await refreshPluginStatus("dsc");
    expect(refreshedUninstalled.installed).toBe(false);
    expect(refreshedUninstalled.loaded).toBe(false);

    expect(window.localStorage.getItem("courseforge.plugins.dsc.installed")).toBeNull();
    const rawState = window.localStorage.getItem("courseforge.plugins.state") || "{}";
    const parsed = JSON.parse(rawState) as Record<string, unknown>;
    expect(parsed.dsc).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  createLifecyclePlan,
  getDefaultComponentSelection,
  resolveComponentSelection,
  resolveIconOptions,
  resolveUninstallSelection,
  resolveMode,
  validateComponentSelection,
} from "../../src/core/services/installer";

const detectionFresh = { isInstalled: false, metadataExists: false, installPath: "C:/Users/test/AppData/Local/Programs/CourseForge" };
const detectionInstalled = { isInstalled: true, metadataExists: true, installPath: "C:/Users/test/AppData/Local/Programs/CourseForge" };

describe("installer lifecycle matrix", () => {
  it("install webapp only", () => {
    const selection = resolveComponentSelection({ installWebapp: true });
    expect(selection).toEqual({ webapp: true, extension: false });
  });

  it("install extension only", () => {
    const selection = resolveComponentSelection({ installExtension: true });
    expect(selection).toEqual({ webapp: false, extension: true });
  });

  it("install both", () => {
    const selection = resolveComponentSelection({ installBoth: true });
    expect(selection).toEqual({ webapp: true, extension: true });
  });

  it("install with desktop icon disabled", () => {
    const icons = resolveIconOptions({ noDesktopIcon: true });
    expect(icons).toEqual({ desktop: false, startMenu: true });
  });

  it("install with start menu icon disabled", () => {
    const icons = resolveIconOptions({ noStartMenuIcon: true });
    expect(icons).toEqual({ desktop: true, startMenu: false });
  });

  it("install with both icons disabled", () => {
    const icons = resolveIconOptions({ noDesktopIcon: true, noStartMenuIcon: true });
    expect(icons).toEqual({ desktop: false, startMenu: false });
  });

  it("full auto install forces both components and silent mode", () => {
    const plan = createLifecyclePlan({ fullAuto: true }, detectionFresh);
    expect(plan.selection).toEqual({ webapp: true, extension: true });
    expect(plan.silent).toBe(true);
    expect(plan.logFileName).toBe("auto-install.log");
  });

  it("silent install emits silent install log", () => {
    const plan = createLifecyclePlan({ mode: "install", silent: true }, detectionFresh);
    expect(plan.logFileName).toBe("silent-install.log");
  });

  it("modify mode preserves existing component state", () => {
    const plan = createLifecyclePlan(
      { mode: "modify" },
      detectionInstalled,
      { webapp: true, extension: false },
      { desktop: false, startMenu: true }
    );

    expect(plan.selection).toEqual({ webapp: true, extension: false });
    expect(plan.installPath).toBe(detectionInstalled.installPath);
  });

  it("repair mode resolves from explicit flag", () => {
    const mode = resolveMode({ repair: true }, detectionInstalled);
    expect(mode).toBe("repair");
  });

  it("uninstall mode resolves from explicit flag", () => {
    const mode = resolveMode({ uninstall: true }, detectionInstalled);
    expect(mode).toBe("uninstall");
  });

  it("uninstall keeps detected installed components and preserves local data by default", () => {
    const selection = resolveUninstallSelection({ webapp: true, extension: true }, {});
    expect(selection).toEqual({ webapp: true, extension: true, removeUserData: false });
  });

  it("blocks no-component selection", () => {
    const validation = validateComponentSelection({ webapp: false, extension: false });
    expect(validation).toContain("At least one component");
  });

  it("keeps default selection as both components", () => {
    expect(getDefaultComponentSelection()).toEqual({ webapp: true, extension: true });
  });
});

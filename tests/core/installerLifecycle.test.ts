import { describe, expect, it } from "vitest";
import {
  buildVerificationResult,
  createLifecyclePlan,
  getDetectionActions,
  getInstallerLogPathForPlatform,
  getLogFileNameForPlan,
  resolveComponentSelection,
  resolveIconOptions,
  resolveRequestedInstallPath,
  resolveMode,
  validateComponentSelection,
} from "../../src/core/services/installer";

describe("installer lifecycle planning", () => {
  it("defaults to install mode for a fresh machine", () => {
    const mode = resolveMode({}, { isInstalled: false, metadataExists: false, installPath: "C:/CF" });
    expect(mode).toBe("install");
  });

  it("returns detect mode when existing install is present", () => {
    const mode = resolveMode({}, { isInstalled: true, metadataExists: true, installPath: "C:/CF" });
    expect(mode).toBe("detect");
  });

  it("supports explicit repair and uninstall flags", () => {
    const repair = resolveMode({ repair: true }, { isInstalled: true, metadataExists: true, installPath: "C:/CF" });
    const uninstall = resolveMode(
      { uninstall: true },
      { isInstalled: true, metadataExists: true, installPath: "C:/CF" }
    );

    expect(repair).toBe("repair");
    expect(uninstall).toBe("uninstall");
  });

  it("full auto enforces install mode with both components", () => {
    const plan = createLifecyclePlan(
      { fullAuto: true },
      { isInstalled: false, metadataExists: false, installPath: "C:/CF" }
    );

    expect(plan.mode).toBe("install");
    expect(plan.fullAuto).toBe(true);
    expect(plan.silent).toBe(true);
    expect(plan.selection).toEqual({ webapp: true, extension: true });
    expect(plan.icons).toEqual({ desktop: true, startMenu: true });
    expect(plan.installPath).toBe("C:/CF");
    expect(plan.logFileName).toBe("auto-install.log");
  });

  it("modify defaults to existing component selection", () => {
    const plan = createLifecyclePlan(
      { mode: "modify" },
      { isInstalled: true, metadataExists: true, installPath: "C:/CF" },
      { webapp: true, extension: false },
      { desktop: false, startMenu: true }
    );

    expect(plan.selection).toEqual({ webapp: true, extension: false });
    expect(plan.icons).toEqual({ desktop: true, startMenu: true });
    expect(plan.installPath).toBe("C:/CF");
    expect(plan.logFileName).toBe("installer.log");
  });

  it("uses explicit install path when provided", () => {
    const plan = createLifecyclePlan(
      { mode: "install", installPath: "D:/Apps/CourseForge" },
      { isInstalled: false, metadataExists: false, installPath: "C:/CF" }
    );

    expect(plan.installPath).toBe("D:/Apps/CourseForge");
  });

  it("allows install with both icons disabled", () => {
    const icons = resolveIconOptions({ noDesktopIcon: true, noStartMenuIcon: true });
    expect(icons).toEqual({ desktop: false, startMenu: false });
  });

  it("blocks install when no components are selected", () => {
    const selection = { webapp: false, extension: false };
    const validation = validateComponentSelection(selection);
    expect(validation).toContain("At least one component");
  });

  it("supports explicit webapp-only and extension-only selection", () => {
    const webappOnly = resolveComponentSelection({ installWebapp: true });
    const extensionOnly = resolveComponentSelection({ installExtension: true });

    expect(webappOnly).toEqual({ webapp: true, extension: false });
    expect(extensionOnly).toEqual({ webapp: false, extension: true });
  });

  it("returns launch actions for initial detection screen", () => {
    const fresh = getDetectionActions({ isInstalled: false, metadataExists: false, installPath: "C:/CF" });
    const existing = getDetectionActions({ isInstalled: true, metadataExists: true, installPath: "C:/CF" });

    expect(fresh).toEqual(["install", "full-auto-install"]);
    expect(existing).toEqual(["modify", "repair", "uninstall", "exit"]);
  });

  it("maps lifecycle mode to expected installer log file", () => {
    expect(getLogFileNameForPlan({ mode: "install", silent: false, fullAuto: false })).toBe("installer.log");
    expect(getLogFileNameForPlan({ mode: "install", silent: true, fullAuto: false })).toBe("silent-install.log");
    expect(getLogFileNameForPlan({ mode: "install", silent: true, fullAuto: true })).toBe("auto-install.log");
    expect(getLogFileNameForPlan({ mode: "repair", silent: true, fullAuto: false })).toBe("repair.log");
    expect(getLogFileNameForPlan({ mode: "uninstall", silent: true, fullAuto: false })).toBe("uninstaller.log");
  });
});

describe("installer verification", () => {
  it("passes when selected components and requested shortcuts exist", () => {
    const result = buildVerificationResult({
      selection: { webapp: true, extension: true },
      icons: { desktop: true, startMenu: true },
      hasWebapp: true,
      hasExtension: true,
      hasPackageManifest: true,
      hasInstallerMetadata: true,
      hasDesktopShortcut: true,
      hasStartMenuShortcut: true,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports missing shortcuts only when icons are enabled", () => {
    const result = buildVerificationResult({
      selection: { webapp: true, extension: true },
      icons: { desktop: false, startMenu: false },
      hasWebapp: true,
      hasExtension: true,
      hasPackageManifest: true,
      hasInstallerMetadata: true,
      hasDesktopShortcut: false,
      hasStartMenuShortcut: false,
    });

    expect(result.ok).toBe(true);
  });

  it("reports missing files and manifests", () => {
    const result = buildVerificationResult({
      selection: { webapp: true, extension: true },
      icons: { desktop: true, startMenu: true },
      hasWebapp: false,
      hasExtension: false,
      hasPackageManifest: false,
      hasInstallerMetadata: false,
      hasDesktopShortcut: false,
      hasStartMenuShortcut: false,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "missing-webapp",
      "missing-extension",
      "missing-package-manifest",
      "missing-installer-metadata",
      "missing-desktop-shortcut",
      "missing-startmenu-shortcut",
    ]);
  });
});

describe("installer log path", () => {
  it("uses LOCALAPPDATA on windows", () => {
    const logPath = getInstallerLogPathForPlatform({
      isWindows: true,
      localAppData: "C:/Users/test/AppData/Local",
    });

    expect(logPath).toBe("C:/Users/test/AppData/Local\\CourseForge\\logs\\installer.log");
  });

  it("uses ~/.courseforge on non-windows", () => {
    const logPath = getInstallerLogPathForPlatform({
      isWindows: false,
      homeDir: "/home/test",
    });

    expect(logPath).toBe("/home/test/.courseforge/logs/installer.log");
  });

  it("supports mode-specific log files", () => {
    const logPath = getInstallerLogPathForPlatform({
      isWindows: true,
      localAppData: "C:/Users/test/AppData/Local",
      logFileName: "rollback.log",
    });

    expect(logPath).toBe("C:/Users/test/AppData/Local\\CourseForge\\logs\\rollback.log");
  });
});

describe("installer path resolution", () => {
  it("falls back to default path when installPath is empty", () => {
    const installPath = resolveRequestedInstallPath({ installPath: "   " }, "C:/CF");
    expect(installPath).toBe("C:/CF");
  });
});

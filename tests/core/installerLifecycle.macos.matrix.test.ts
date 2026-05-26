import { describe, expect, it } from "vitest";
import {
  createLifecyclePlan,
  getInstallerPathConventionsForPlatform,
  getInstallerLogPathForPlatform,
  resolveMode,
} from "../../src/core/services/installer";

const freshDetection = {
  isInstalled: false,
  metadataExists: false,
  installPath: "/Users/test/Applications/CourseForge.app",
};

const existingDetection = {
  isInstalled: true,
  metadataExists: true,
  installPath: "/Users/test/Applications/CourseForge.app",
};

describe("installer lifecycle macOS matrix", () => {
  it("resolves detect mode for existing mac installation", () => {
    const mode = resolveMode({}, existingDetection);
    expect(mode).toBe("detect");
  });

  it("uses explicit app bundle install path for install mode", () => {
    const plan = createLifecyclePlan(
      { mode: "install", installPath: "/Applications/CourseForge.app" },
      freshDetection
    );

    expect(plan.installPath).toBe("/Applications/CourseForge.app");
  });

  it("preserves existing install path in modify mode", () => {
    const plan = createLifecyclePlan({ mode: "modify" }, existingDetection);
    expect(plan.installPath).toBe("/Users/test/Applications/CourseForge.app");
  });

  it("emits expected defaults for mac path conventions", () => {
    const conventions = getInstallerPathConventionsForPlatform({
      platform: "macos",
      homeDir: "/Users/test",
    });

    expect(conventions.installRoot).toBe("/Users/test/Applications/CourseForge.app");
    expect(conventions.logsDir).toBe("/Users/test/Library/Logs/CourseForge");
    expect(conventions.localDataPath).toBe("/Users/test/Library/Application Support/CourseForge/data");
  });

  it("uses macOS log path shape for repair logs", () => {
    const logPath = getInstallerLogPathForPlatform({
      platform: "macos",
      homeDir: "/Users/test",
      logFileName: "repair.log",
    });

    expect(logPath).toBe("/Users/test/Library/Logs/CourseForge/repair.log");
  });
});

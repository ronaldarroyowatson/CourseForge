import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("macOS installer template guardrails", () => {
  it("exposes macOS packaging and quality scripts", () => {
    const packageJson = readWorkspaceFile("package.json");

    expect(packageJson).toContain('"package:macos"');
    expect(packageJson).toContain('"verify:macos"');
    expect(packageJson).toContain('"test:installer:macos"');
    expect(packageJson).toContain('"test:installer:cross-platform"');
    expect(packageJson).toContain('"quality:installer:all"');
  });

  it("keeps macOS installer lifecycle scripts in installer package", () => {
    const packagerScript = readWorkspaceFile("scripts/create-macos-package.sh");

    expect(packagerScript).toContain("Start-CourseForge-macos.sh");
    expect(packagerScript).toContain("AutoUpdate-CourseForge.sh");
    expect(packagerScript).toContain("Install-CourseForge-macos.sh");
    expect(packagerScript).toContain("Uninstall-CourseForge-macos.sh");
    expect(packagerScript).toContain("courseforge-serve.js");
    expect(packagerScript).toContain("package-manifest.json");
  });

  it("includes detect, repair, uninstall, and reinstall macOS lifecycle modes", () => {
    const installerScript = readWorkspaceFile("scripts/installer/Install-CourseForge-macos.sh");

    expect(installerScript).toContain("MODE=\"detect\"");
    expect(installerScript).toContain("detect:fresh");
    expect(installerScript).toContain("repair_mode");
    expect(installerScript).toContain("restore_critical_file");
    expect(installerScript).toContain("is_install_healthy");
    expect(installerScript).toContain("Repair validation failed; running reinstall fallback.");
    expect(installerScript).toContain("uninstall_mode");
    expect(installerScript).toContain("reinstall");
    expect(installerScript).toContain("installer-metadata.json");
    expect(installerScript).toContain("com.ronaldarroyowatson.CourseForge");
  });
});

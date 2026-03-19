import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("windows installer template guardrails", () => {
  it("generates installer from the shared windows template", () => {
    const generatorScript = readWorkspaceFile("scripts/create-windows-package.ps1");

    expect(generatorScript).toContain("windows-installer-template.ps1");
    expect(generatorScript).toContain("__COURSEFORGE_VERSION__");
    expect(generatorScript).toContain("Uninstall-CourseForge-Windows.cmd");
    expect(generatorScript).toContain("installer-integrity.json");
    expect(generatorScript).toContain("iexpress.exe");
    expect(generatorScript).toContain("CourseForge-windows-payload.zip");
    expect(generatorScript).toContain("Launch-CourseForge-Installer.cmd");
    expect(generatorScript).toContain("AppLaunched=cmd.exe /c $bootstrapLauncherName");
    expect(generatorScript).toContain("AdminQuietInstCmd=cmd.exe /c $bootstrapLauncherName -FullAuto");
  });

  it("keeps advanced installer lifecycle features in the template", () => {
    const template = readWorkspaceFile("scripts/installer/windows-installer-template.ps1");

    expect(template).toContain("function Show-InitialDetectionMenu");
    expect(template).toContain("function Invoke-WithRollback");
    expect(template).toContain("function Repair-Installation");
    expect(template).toContain("function Uninstall-CourseForge");
    expect(template).toContain("HKCU:\\Software\\CourseForge");
    expect(template).toContain("/SILENT");
    expect(template).toContain("/FULLAUTO");
    expect(template).toContain("/REPAIR");
    expect(template).toContain("/UNINSTALL");
    expect(template).toContain("installer-metadata.json");
    expect(template).toContain("installer-integrity.json");
    expect(template).toContain("rollback.log");
  });
});

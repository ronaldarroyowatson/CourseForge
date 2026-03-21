import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("windows installer template guardrails", () => {
  it("exposes GUI-required packaging scripts for release builds", () => {
    const packageJson = readWorkspaceFile("package.json");

    expect(packageJson).toContain('"package:windows:gui"');
    expect(packageJson).toContain('"check:installer:gui"');
    expect(packageJson).toContain('"quality:installer:gui"');
  });

  it("generates installer from the shared windows template", () => {
    const generatorScript = readWorkspaceFile("scripts/create-windows-package.ps1");
    const portableGeneratorScript = readWorkspaceFile("scripts/create-portable-package.ps1");

    expect(generatorScript).toContain("windows-installer-template.ps1");
    expect(generatorScript).toContain("windows-installer.iss.template");
    expect(generatorScript).toContain("[switch]$RequireGuiInstaller");
    expect(generatorScript).toContain("COURSEFORGE_REQUIRE_GUI_INSTALLER");
    expect(generatorScript).toContain("__COURSEFORGE_VERSION__");
    expect(generatorScript).toContain("Uninstall-CourseForge-Windows.cmd");
    expect(generatorScript).toContain("installer-integrity.json");
    expect(generatorScript).toContain('"Start-CourseForge.ps1"');
    expect(generatorScript).toContain('"courseforge-serve.cjs"');
    expect(generatorScript).toContain('"courseforge-serve.js"');
    expect(generatorScript).toContain('"boot-splash.html"');
    expect(generatorScript).toContain('"Test-CourseForge-Integrity.ps1"');
    expect(generatorScript).toContain("ISCC.exe");
    expect(generatorScript).toContain("Programs\\Inno Setup 6\\ISCC.exe");
    expect(generatorScript).toContain("Inno Setup compiler (ISCC.exe) not found");
    expect(generatorScript).toContain("GUI installer is required but Inno Setup compiler (ISCC.exe) was not found");
    expect(generatorScript).toContain("iexpress.exe");
    expect(generatorScript).toContain("CourseForge-windows-payload.zip");
    expect(generatorScript).toContain("Launch-CourseForge-Installer.cmd");
    expect(generatorScript).toContain('pushd "%TEMP%"');
    expect(generatorScript).toContain('-InstallPath "%INSTALLROOT%" -Uninstall %*');
    expect(generatorScript).toContain('start "" /b powershell.exe');
    expect(generatorScript).toContain("Remove-Item -LiteralPath '%INSTALLROOT%' -Recurse -Force -ErrorAction SilentlyContinue");
    expect(generatorScript).toContain("AppLaunched=cmd.exe /c \"%FILE1%\"");
    expect(generatorScript).toContain("AdminQuietInstCmd=cmd.exe /c \"%FILE1%\" -FullAuto");

    expect(portableGeneratorScript).toContain('"Start-CourseForge.ps1"');
    expect(portableGeneratorScript).toContain('"courseforge-serve.cjs"');
    expect(portableGeneratorScript).toContain('"courseforge-serve.js"');
    expect(portableGeneratorScript).toContain('"boot-splash.html"');
    expect(portableGeneratorScript).toContain('"Test-CourseForge-Integrity.ps1"');
    expect(portableGeneratorScript).toContain('Start-CourseForge.cmd');
    expect(portableGeneratorScript).toContain('start "" cmd /c powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT_DIR%Start-CourseForge.ps1"');
  });

  it("keeps advanced installer lifecycle features in the template", () => {
    const template = readWorkspaceFile("scripts/installer/windows-installer-template.ps1");

    expect(template).toContain("function Show-InitialDetectionMenu");
    expect(template).toContain("function Find-ExistingInstallations");
    expect(template).toContain("function Invoke-PreInstallCleanup");
    expect(template).toContain("function Remove-CourseForgeArtifactsFromPath");
    expect(template).toContain("function Invoke-WithRollback");
    expect(template).toContain("function Repair-Installation");
    expect(template).toContain("function Uninstall-CourseForge");
    expect(template).toContain('"boot-splash.html"');
    expect(template).toContain('"Test-CourseForge-Integrity.ps1"');
    expect(template).toContain("Using script directory as install root hint");
    expect(template).toContain("Are you sure you want to uninstall CourseForge");
    expect(template).toContain("Delete all local user data (NOT recommended)");
    expect(template).not.toContain("Remove Webapp");
    expect(template).not.toContain("Remove Browser Extension");
    expect(template).toContain("HKCU:\\Software\\CourseForge");
    expect(template).toContain("/SILENT");
    expect(template).toContain("/FULLAUTO");
    expect(template).toContain("/REPAIR");
    expect(template).toContain("/UNINSTALL");
    expect(template).toContain("installer-metadata.json");
    expect(template).toContain("installer-integrity.json");
    expect(template).toContain("rollback.log");
    expect(template).toContain("New-InstallerSupportCode");
    expect(template).toContain("Write-NodeEnvironmentDiagnostics");
    expect(template).toContain("Please contact support with this code");
  });

  it("keeps launcher runtime sanity checks teacher-friendly", () => {
    const launcher = readWorkspaceFile("scripts/installer/Start-CourseForge.ps1");

    expect(launcher).toContain("Get-NodeRuntimeHealth");
    expect(launcher).toContain("Get-OrphanedNodeFolders");
    expect(launcher).toContain("Write-RuntimeDiagnostics");
    expect(launcher).toContain("Show-RuntimeFailureAndExit");
    expect(launcher).toContain("We couldn't set up the runtime automatically. Please contact support with this code");
  });
});

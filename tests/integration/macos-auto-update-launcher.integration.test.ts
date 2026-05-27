import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("macOS launcher and updater guardrails", () => {
  it("applies staged updates before normal startup", () => {
    const launcherScript = readWorkspaceFile("scripts/installer/Start-CourseForge-macos.sh");

    expect(launcherScript).toContain("apply_staged_update");
    expect(launcherScript).toContain("../Resources/CourseForge");
    expect(launcherScript).toContain("pending-update.json");
    expect(launcherScript).toContain("_pending_update");
    expect(launcherScript).toContain("rsync -a --delete");
    expect(launcherScript).toContain("courseforge-serve.cjs");
  });

  it("checks for updates in background without blocking startup", () => {
    const launcherScript = readWorkspaceFile("scripts/installer/Start-CourseForge-macos.sh");

    expect(launcherScript).toContain("spawn_background_update_check");
    expect(launcherScript).toContain("--check-only");
    expect(launcherScript).toContain("|| true");
    expect(launcherScript).toContain('"/opt/homebrew/bin/node"');
    expect(launcherScript).toContain('"$HOME/.nvm/versions/node"/v*/bin/node');
    expect(launcherScript).toContain("server_is_reachable");
    expect(launcherScript).toContain("nohup");
    expect(launcherScript).toContain("Detected existing server");
  });

  it("guides users to move app from DMG into Applications on first launch", () => {
    const launcherScript = readWorkspaceFile("scripts/installer/Start-CourseForge-macos.sh");

    expect(launcherScript).toContain("prompt_move_to_applications");
    expect(launcherScript).toContain("/Volumes/");
    expect(launcherScript).toContain("Move to Applications");
    expect(launcherScript).toContain("open -a");
    expect(launcherScript).toContain("xattr -dr com.apple.quarantine");
  });

  it("supports release polling, staging, and pending update marker creation", () => {
    const updaterScript = readWorkspaceFile("scripts/installer/AutoUpdate-CourseForge.sh");

    expect(updaterScript).toContain("releases/latest");
    expect(updaterScript).toContain("--stage-only");
    expect(updaterScript).toContain("pending-update.json");
    expect(updaterScript).toContain("_pending_update");
    expect(updaterScript).toContain("updater-status.json");
  });

  it("uses cross-platform updater invocation in local server", () => {
    const serverScript = readWorkspaceFile("scripts/installer/courseforge-serve.js");

    expect(serverScript).toContain("AutoUpdate-CourseForge.sh");
    expect(serverScript).toContain("const command = isPowerShellScript ? \"powershell.exe\" : \"bash\"");
    expect(serverScript).toContain("--stage-only");
  });
});

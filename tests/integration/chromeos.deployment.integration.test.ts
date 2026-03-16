import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("chromeos deployment foundations", () => {
  it("contains Chrome extension packaging target and required permissions", () => {
    const packageJson = readWorkspaceFile("package.json");
    const chromeManifest = readWorkspaceFile("src/extension/manifest.chrome.json");

    expect(packageJson).toContain("build:extension:chrome");
    expect(chromeManifest).toContain('"activeTab"');
    expect(chromeManifest).toContain('"scripting"');
    expect(chromeManifest).toContain('"storage"');
    expect(chromeManifest).toContain('"tabs"');
  });

  it("has chromeos capture path and responsive breakpoints", () => {
    const autoFlow = readWorkspaceFile("src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx");
    const styles = readWorkspaceFile("src/webapp/styles/globals.css");

    expect(autoFlow).toContain("captureVisibleChromeTab");
    expect(autoFlow).toContain("isChromeOSRuntime");
    expect(styles).toContain("max-width: 1366px");
    expect(styles).toContain("max-height: 900px");
  });

  it("registers service worker and includes cache script", () => {
    const main = readWorkspaceFile("src/webapp/main.tsx");
    const sw = readWorkspaceFile("src/webapp/public/sw.js");

    expect(main).toContain("navigator.serviceWorker.register");
    expect(sw).toContain("CACHE_NAME");
    expect(sw).toContain("self.addEventListener(\"fetch\"");
  });
});

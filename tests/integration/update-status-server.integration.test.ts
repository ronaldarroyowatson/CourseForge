// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

const repoRoot = join(__dirname, "..", "..");
const serverScriptSource = readFileSync(
  join(repoRoot, "scripts", "installer", "courseforge-serve.js"),
  "utf8"
);

async function getAvailablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

async function startStatusServer(root: string, port: number) {
  const child = spawn("node", [join(root, "courseforge-serve.js"), join(root, "webapp"), String(port), "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for server startup")), 10000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("CourseForge server running at")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });

  return child;
}

async function stopServer(child: ChildProcess) {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await once(child, "exit");
}

describe("local update status endpoint", () => {
  let child: ChildProcess | null = null;

  afterEach(async () => {
    if (child) {
      await stopServer(child);
      child = null;
    }
  });

  it("reports staged update metadata and current app version", async () => {
    const root = mkdtempSync(join(tmpdir(), "courseforge-status-"));
    const webappDir = join(root, "webapp");

    mkdirSync(webappDir, { recursive: true });
    writeFileSync(join(root, "courseforge-serve.js"), serverScriptSource, "utf8");
    writeFileSync(join(webappDir, "index.html"), "<html><body>CourseForge</body></html>", "utf8");
    writeFileSync(
      join(root, "package-manifest.json"),
      JSON.stringify({ version: "1.2.6" }, null, 2),
      "utf8"
    );
    writeFileSync(
      join(root, "pending-update.json"),
      JSON.stringify(
        {
          version: "1.2.7",
          releaseUrl: "https://example.invalid/release",
          stagedAt: "2026-03-19T00:00:00.000Z",
        },
        null,
        2
      ),
      "utf8"
    );

    try {
      const port = await getAvailablePort();
      child = await startStatusServer(root, port);

      const response = await fetch(`http://127.0.0.1:${port}/api/update-status`);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({
        available: true,
        version: "1.2.7",
        releaseUrl: "https://example.invalid/release",
        stagedAt: "2026-03-19T00:00:00.000Z",
        currentVersion: "1.2.6",
      });
    } finally {
      if (child) {
        await stopServer(child);
        child = null;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});
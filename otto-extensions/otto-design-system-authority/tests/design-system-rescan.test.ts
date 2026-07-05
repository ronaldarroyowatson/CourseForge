import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { executeDesignSystemRescanCommand } from "../src/design-system-rescan.js";

it("design system rescan writes deterministic metadata to mempalace", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "otto-design-system-"));

  try {
    const result = await executeDesignSystemRescanCommand({
      memPalaceRoot: tempRoot,
      trigger: "automatic",
      source: "OttoUpdateAgent"
    });

    expect(result.rules.length > 0).toBe(true);

    const indexPath = path.join(tempRoot, "design-system-index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as { ruleCount: number };
    expect(index.ruleCount).toBe(result.rules.length);

    const eventsPath = path.join(tempRoot, "design-system-rescan-events.json");
    const events = JSON.parse(await readFile(eventsPath, "utf8")) as Array<{ source: string }>;
    expect(events.at(-1)?.source).toBe("OttoUpdateAgent");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

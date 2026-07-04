import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { executeDesignSystemRescanCommand } from "../src/design-system-rescan.js";

test("design system rescan writes deterministic metadata to mempalace", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "otto-design-system-"));

  try {
    const result = await executeDesignSystemRescanCommand({
      memPalaceRoot: tempRoot,
      trigger: "automatic",
      source: "OttoUpdateAgent"
    });

    assert.equal(result.rules.length > 0, true);

    const indexPath = path.join(tempRoot, "design-system-index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as { ruleCount: number };
    assert.equal(index.ruleCount, result.rules.length);

    const eventsPath = path.join(tempRoot, "design-system-rescan-events.json");
    const events = JSON.parse(await readFile(eventsPath, "utf8")) as Array<{ source: string }>;
    assert.equal(events.at(-1)?.source, "OttoUpdateAgent");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

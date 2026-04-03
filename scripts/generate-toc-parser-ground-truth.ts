import fs from "node:fs/promises";
import path from "node:path";

import { parseTocFromOcrText } from "../src/core/services/textbookAutoExtractionService";

const FIXTURE_DIR = path.resolve("tests/fixtures/toc-ground-truth");

async function run(): Promise<void> {
  const files = (await fs.readdir(FIXTURE_DIR))
    .filter((name) => name.endsWith(".txt"))
    .sort((a, b) => a.localeCompare(b));

  for (const name of files) {
    const inputPath = path.join(FIXTURE_DIR, name);
    const text = await fs.readFile(inputPath, "utf8");
    const parsed = parseTocFromOcrText(text);
    const outputPath = path.join(FIXTURE_DIR, name.replace(/\.txt$/i, ".parsed.json"));
    await fs.writeFile(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  }

  console.log(`Generated parser ground truth for ${files.length} OCR fixtures.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

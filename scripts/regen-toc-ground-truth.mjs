// One-time script: regenerate toc-ground-truth parsed.json fixtures from current parser output.
import { parseTocFromOcrText } from "../src/core/services/textbookAutoExtractionService.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, "../tests/fixtures/toc-ground-truth");
const files = fs.readdirSync(fixtureDir).filter((f) => f.endsWith(".txt"));

for (const file of files) {
  const text = fs.readFileSync(path.join(fixtureDir, file), "utf8");
  const result = parseTocFromOcrText(text);
  const jsonPath = path.join(fixtureDir, file.replace(/\.txt$/i, ".parsed.json"));
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2) + "\n");
  console.log("Updated:", file);
}
console.log("Done — regenerated", files.length, "fixtures.");

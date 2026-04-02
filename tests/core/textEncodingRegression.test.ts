import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(process.cwd());
const SOURCE_ROOTS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "functions", "src"),
];

const EXCLUDED_DIRS = new Set(["node_modules", "dist", "release", "tmp-smoke", "tmp-installer-extract", ".git"]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".md"]);
const MOJIBAKE_PATTERN = /â|Â©|âœ|â–|â”|â†|â€œ|â€�|â€”|â€™/;

function walkTextFiles(dir: string, results: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTextFiles(fullPath, results);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (TEXT_EXTENSIONS.has(extension)) {
      results.push(fullPath);
    }
  }
}

describe("text encoding regression guard", () => {
  it("contains no mojibake sequences in source files", () => {
    const files: string[] = [];
    SOURCE_ROOTS.forEach((rootDir) => walkTextFiles(rootDir, files));

    const offenders: string[] = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf8");
      if (MOJIBAKE_PATTERN.test(content)) {
        offenders.push(path.relative(ROOT, filePath));
      }
    }

    expect(offenders).toEqual([]);
  });
});

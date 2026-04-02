import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const testsDir = path.join(repoRoot, "tests");
const samplesDir = path.join(repoRoot, "tmp-smoke", "samples");
const outputPath = path.join(repoRoot, "docs", "test-index.md");

function listFilesRecursively(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else {
        files.push(absPath);
      }
    }
  }

  return files;
}

function toRelative(p) {
  return path.relative(repoRoot, p).replace(/\\/g, "/");
}

const testFiles = listFilesRecursively(testsDir).filter((file) => /\.test\.(ts|tsx)$/i.test(file));
const unit = testFiles.filter((file) => file.includes(`${path.sep}core${path.sep}`));
const integration = testFiles.filter((file) => file.includes(`${path.sep}integration${path.sep}`));
const rules = testFiles.filter((file) => file.includes(`${path.sep}rules${path.sep}`));

const sampleFiles = listFilesRecursively(samplesDir)
  .map(toRelative)
  .sort((left, right) => left.localeCompare(right));

const now = new Date().toISOString();
const content = [
  "# Test Index",
  "",
  `Generated: ${now}`,
  "",
  "## Summary",
  "",
  `- Total test files: ${testFiles.length}`,
  `- Unit test files: ${unit.length}`,
  `- Integration test files: ${integration.length}`,
  `- Rules test files: ${rules.length}`,
  `- Canonical sample files: ${sampleFiles.length}`,
  "",
  "## Unit Tests",
  "",
  ...unit.map((file) => `- ${toRelative(file)}`),
  "",
  "## Integration Tests",
  "",
  ...integration.map((file) => `- ${toRelative(file)}`),
  "",
  "## Rules Tests",
  "",
  ...rules.map((file) => `- ${toRelative(file)}`),
  "",
  "## Canonical Smoke Samples",
  "",
  ...sampleFiles.map((file) => `- ${file}`),
  "",
].join("\n");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, content, "utf8");
console.log(`[test-index] Wrote ${toRelative(outputPath)} with ${testFiles.length} test files and ${sampleFiles.length} samples.`);

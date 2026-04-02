import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const samplesDir = path.join(repoRoot, "tmp-smoke", "samples");
const searchRoots = [
  path.join(repoRoot, "tests"),
  path.join(repoRoot, "scripts"),
];

function listFiles(rootDir) {
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

if (!fs.existsSync(samplesDir)) {
  console.error("[test-samples] Missing tmp-smoke/samples directory.");
  process.exit(1);
}

const sampleFiles = listFiles(samplesDir);
const canonical = sampleFiles.filter((file) => {
  const base = path.basename(file);
  return base.split("__").length >= 3;
});

const missingPattern = /^.+__.+__.+\.[^.]+$/;
const badNames = canonical
  .map((file) => path.basename(file))
  .filter((name) => !missingPattern.test(name));

const scannedText = listFiles(searchRoots[0])
  .concat(listFiles(searchRoots[1]))
  .filter((file) => /\.(ts|tsx|js|mjs|ps1|md)$/i.test(file))
  .map((file) => ({ file, text: fs.readFileSync(file, "utf8") }));

const missingRefs = [];
for (const samplePath of canonical) {
  const sampleName = path.basename(samplePath);
  const used = scannedText.some((item) => item.text.includes(sampleName));
  if (!used) {
    missingRefs.push(sampleName);
  }
}

const missingMandatory = [
  "input__empty-file__expect-error.txt",
  "input__corrupted-json__expect-parse-failure.json",
].filter((name) => !canonical.some((file) => path.basename(file) === name));

if (badNames.length || missingRefs.length || missingMandatory.length) {
  if (badNames.length) {
    console.error("[test-samples] Invalid canonical sample names:");
    for (const name of badNames) {
      console.error(`  - ${name}`);
    }
  }

  if (missingRefs.length) {
    console.error("[test-samples] Unused canonical sample files:");
    for (const name of missingRefs) {
      console.error(`  - ${name}`);
    }
  }

  if (missingMandatory.length) {
    console.error("[test-samples] Missing mandatory blank/corrupt fixtures:");
    for (const name of missingMandatory) {
      console.error(`  - ${name}`);
    }
  }

  process.exit(1);
}

console.log(`[test-samples] Canonical samples validated (${canonical.length} files).`);
console.log(`[test-samples] Directory: ${toRelative(samplesDir)}`);

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { createWorker } from "tesseract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "toc-ground-truth");
const outDir = path.join(repoRoot, "tmp-smoke", "ocr-crosscheck");

function normalizeText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function tokenize(text) {
  const normalized = normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized
    .split(" ")
    .filter((token) => token.length >= 4);
}

function unique(arr) {
  return [...new Set(arr)];
}

function ratio(intersection, total) {
  return total > 0 ? intersection / total : 0;
}

function fmtPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const manifestPath = path.join(fixtureDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  const worker = await createWorker("eng");

  const rows = [];

  for (const entry of manifest) {
    const base = entry.text.replace(/\.txt$/i, "");
    const imagePath = path.join(fixtureDir, entry.image);
    const textPath = path.join(fixtureDir, entry.text);

    const expectedRaw = await fs.readFile(textPath, "utf8");
    const recognized = await worker.recognize(imagePath);
    const actualRaw = recognized.data.text ?? "";

    const expectedNorm = normalizeText(expectedRaw);
    const actualNorm = normalizeText(actualRaw);

    const expectedNormPath = path.join(outDir, `${base}.ground.norm.txt`);
    const actualNormPath = path.join(outDir, `${base}.ocr.norm.txt`);
    const actualRawPath = path.join(outDir, `${base}.ocr.raw.txt`);

    await fs.writeFile(expectedNormPath, expectedNorm + "\n", "utf8");
    await fs.writeFile(actualNormPath, actualNorm + "\n", "utf8");
    await fs.writeFile(actualRawPath, actualRaw, "utf8");

    const expectedLines = unique(expectedNorm.split("\n").filter(Boolean));
    const actualLines = unique(actualNorm.split("\n").filter(Boolean));
    const actualLineSet = new Set(actualLines);
    const expectedLineSet = new Set(expectedLines);

    const missingLines = expectedLines.filter((line) => !actualLineSet.has(line));
    const extraLines = actualLines.filter((line) => !expectedLineSet.has(line));

    const expectedTokens = unique(tokenize(expectedNorm));
    const actualTokens = unique(tokenize(actualNorm));
    const actualTokenSet = new Set(actualTokens);
    const expectedTokenSet = new Set(expectedTokens);

    const missingTokens = expectedTokens.filter((token) => !actualTokenSet.has(token));
    const extraTokens = actualTokens.filter((token) => !expectedTokenSet.has(token));

    const sharedTokenCount = expectedTokens.filter((token) => actualTokenSet.has(token)).length;
    const tokenCoverage = ratio(sharedTokenCount, expectedTokens.length);

    const diff = spawnSync(
      "git",
      ["diff", "--no-index", "--", expectedNormPath, actualNormPath],
      { cwd: repoRoot, encoding: "utf8" }
    );

    const diffPath = path.join(outDir, `${base}.norm.diff.txt`);
    await fs.writeFile(diffPath, diff.stdout || "(no diff output)\n", "utf8");

    rows.push({
      entry,
      expectedLines: expectedLines.length,
      actualLines: actualLines.length,
      missingLines,
      extraLines,
      expectedTokens: expectedTokens.length,
      actualTokens: actualTokens.length,
      missingTokens,
      extraTokens,
      tokenCoverage,
      files: {
        expectedNormPath,
        actualNormPath,
        actualRawPath,
        diffPath,
      },
    });
  }

  await worker.terminate();

  const avgCoverage = rows.reduce((sum, row) => sum + row.tokenCoverage, 0) / Math.max(1, rows.length);

  let report = "# OCR Cross-Check Report\n\n";
  report += `Generated: ${new Date().toISOString()}\n\n`;
  report += `Fixtures: ${rows.length}\n`;
  report += `Average token coverage (ground truth token -> OCR): ${fmtPct(avgCoverage)}\n\n`;

  report += "## Summary Table\n\n";
  report += "| # | Fixture | Token Coverage | Missing Lines | Extra Lines | Missing Tokens | Extra Tokens |\n";
  report += "|---|---|---:|---:|---:|---:|---:|\n";

  for (const row of rows) {
    report += `| ${row.entry.index} | ${row.entry.text} | ${fmtPct(row.tokenCoverage)} | ${row.missingLines.length} | ${row.extraLines.length} | ${row.missingTokens.length} | ${row.extraTokens.length} |\n`;
  }

  report += "\n## Details\n\n";

  for (const row of rows) {
    report += `### ${row.entry.index}. ${row.entry.text}\n\n`;
    report += `- Source image: ${row.entry.image}\n`;
    report += `- Token coverage: ${fmtPct(row.tokenCoverage)}\n`;
    report += `- Missing lines: ${row.missingLines.length}\n`;
    report += `- Extra lines: ${row.extraLines.length}\n`;
    report += `- Missing tokens: ${row.missingTokens.length}\n`;
    report += `- Extra tokens: ${row.extraTokens.length}\n`;

    const topMissingLines = row.missingLines.slice(0, 12);
    const topMissingTokens = row.missingTokens.slice(0, 30);

    report += "\nMissing lines (up to 12):\n";
    if (!topMissingLines.length) {
      report += "- (none)\n";
    } else {
      for (const line of topMissingLines) {
        report += `- ${line}\n`;
      }
    }

    report += "\nMissing tokens (up to 30):\n";
    if (!topMissingTokens.length) {
      report += "- (none)\n";
    } else {
      report += `- ${topMissingTokens.join(", ")}\n`;
    }

    report += "\nArtifacts:\n";
    report += `- OCR raw: ${path.relative(repoRoot, row.files.actualRawPath).split(path.sep).join("/")}\n`;
    report += `- Ground truth normalized: ${path.relative(repoRoot, row.files.expectedNormPath).split(path.sep).join("/")}\n`;
    report += `- OCR normalized: ${path.relative(repoRoot, row.files.actualNormPath).split(path.sep).join("/")}\n`;
    report += `- Diff: ${path.relative(repoRoot, row.files.diffPath).split(path.sep).join("/")}\n\n`;
  }

  const reportPath = path.join(outDir, "report.md");
  await fs.writeFile(reportPath, report, "utf8");

  console.log(`Cross-check report: ${reportPath}`);
  console.log(`Average token coverage: ${fmtPct(avgCoverage)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

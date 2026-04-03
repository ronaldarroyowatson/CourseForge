import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWorker } from "tesseract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "toc-ground-truth");
const outDir = path.join(repoRoot, "tmp-smoke", "ocr-layout-experiment");

function normalize(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function tokens(text) {
  return [...new Set(
    normalize(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((token) => token.length >= 4)
  )];
}

function coverage(expected, actual) {
  const exp = tokens(expected);
  const actSet = new Set(tokens(actual));
  const shared = exp.filter((token) => actSet.has(token)).length;
  return {
    score: exp.length > 0 ? shared / exp.length : 0,
    expectedTokens: exp.length,
    sharedTokens: shared,
  };
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function getPngSize(filePath) {
  const data = await fs.readFile(filePath);
  const signature = data.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`Not a PNG: ${filePath}`);
  }

  const ihdr = data.subarray(12, 16).toString("ascii");
  if (ihdr !== "IHDR") {
    throw new Error(`PNG missing IHDR: ${filePath}`);
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return { width, height };
}

function textDensity(text) {
  const compact = text.replace(/\s+/g, "");
  if (!compact.length) {
    return 0;
  }
  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  return letters / compact.length;
}

async function ocrRect(worker, imagePath, rect) {
  const recognized = await worker.recognize(imagePath, { rectangle: rect });
  return recognized.data.text ?? "";
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const manifest = JSON.parse(
    await fs.readFile(path.join(fixtureDir, "manifest.json"), "utf8")
  );

  const worker = await createWorker("eng");

  const rows = [];

  for (const entry of manifest) {
    const imagePath = path.join(fixtureDir, entry.image);
    const textPath = path.join(fixtureDir, entry.text);
    const expected = await fs.readFile(textPath, "utf8");

    const baselineRaw = (await worker.recognize(imagePath)).data.text ?? "";

    const { width, height } = await getPngSize(imagePath);

    const splitX = Math.floor(width * 0.50);
    const overlap = Math.floor(width * 0.02);
    const topHeight = Math.floor(height * 0.38);

    const topLeftRect = { left: 0, top: 0, width: splitX + overlap, height: topHeight };
    const topRightRect = { left: Math.max(0, splitX - overlap), top: 0, width: width - Math.max(0, splitX - overlap), height: topHeight };

    const bottomLeftRect = {
      left: 0,
      top: topHeight,
      width: splitX + overlap,
      height: height - topHeight,
    };

    const bottomRightRect = {
      left: Math.max(0, splitX - overlap),
      top: topHeight,
      width: width - Math.max(0, splitX - overlap),
      height: height - topHeight,
    };

    const topLeftRaw = await ocrRect(worker, imagePath, topLeftRect);
    const topRightRaw = await ocrRect(worker, imagePath, topRightRect);
    const bottomLeftRaw = await ocrRect(worker, imagePath, bottomLeftRect);
    const bottomRightRaw = await ocrRect(worker, imagePath, bottomRightRect);

    // Keep the top half mostly from the denser-text side to avoid picture-caption noise.
    const topLeftDensity = textDensity(topLeftRaw);
    const topRightDensity = textDensity(topRightRaw);

    let topChosen = "";
    if (topLeftDensity > topRightDensity * 1.2) {
      topChosen = topLeftRaw;
    } else if (topRightDensity > topLeftDensity * 1.2) {
      topChosen = topRightRaw;
    } else {
      topChosen = `${topLeftRaw}\n${topRightRaw}`;
    }

    const layoutRaw = `${topChosen}\n${bottomLeftRaw}\n${bottomRightRaw}`;

    const baselineNorm = normalize(baselineRaw);
    const layoutNorm = normalize(layoutRaw);

    const baselineCoverage = coverage(expected, baselineNorm);
    const layoutCoverage = coverage(expected, layoutNorm);

    const base = entry.text.replace(/\.txt$/i, "");
    await fs.writeFile(path.join(outDir, `${base}.baseline.norm.txt`), baselineNorm + "\n", "utf8");
    await fs.writeFile(path.join(outDir, `${base}.layout.norm.txt`), layoutNorm + "\n", "utf8");

    rows.push({
      entry,
      baseline: baselineCoverage,
      layout: layoutCoverage,
      delta: layoutCoverage.score - baselineCoverage.score,
    });
  }

  await worker.terminate();

  const avgBase = rows.reduce((s, r) => s + r.baseline.score, 0) / rows.length;
  const avgLayout = rows.reduce((s, r) => s + r.layout.score, 0) / rows.length;
  const improved = rows.filter((r) => r.delta > 0.005).length;

  let md = "# OCR Layout Structure Experiment\n\n";
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Fixtures: ${rows.length}\n`;
  md += `Average baseline coverage: ${pct(avgBase)}\n`;
  md += `Average structure-aware coverage: ${pct(avgLayout)}\n`;
  md += `Average delta: ${pct(avgLayout - avgBase)}\n`;
  md += `Fixtures improved (>0.5pt): ${improved}/${rows.length}\n\n`;

  md += "## Per Fixture\n\n";
  md += "| # | Fixture | Baseline | Structure-aware | Delta |\n";
  md += "|---|---|---:|---:|---:|\n";

  for (const row of rows) {
    const sign = row.delta >= 0 ? "+" : "";
    md += `| ${row.entry.index} | ${row.entry.text} | ${pct(row.baseline.score)} | ${pct(row.layout.score)} | ${sign}${pct(row.delta)} |\n`;
  }

  const reportPath = path.join(outDir, "report.md");
  await fs.writeFile(reportPath, md, "utf8");

  console.log(`Layout experiment report: ${reportPath}`);
  console.log(`Baseline avg: ${pct(avgBase)} | Structure avg: ${pct(avgLayout)} | Delta: ${pct(avgLayout - avgBase)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

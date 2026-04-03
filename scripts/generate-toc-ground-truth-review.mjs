import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { parseTocFromOcrText } from "../src/core/services/textbookAutoExtractionService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "toc-ground-truth");
const outDir = path.join(repoRoot, "tmp-smoke", "toc-ground-truth-review");
const outHtml = path.join(outDir, "index.html");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function relForHtml(targetPath) {
  return path.relative(outDir, targetPath).split(path.sep).join("/");
}

const manifestPath = path.join(fixtureDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

await fs.mkdir(outDir, { recursive: true });

const cards = [];
let mismatchCount = 0;

for (const entry of manifest) {
  const textPath = path.join(fixtureDir, entry.text);
  const parsedPath = textPath.replace(/\.txt$/i, ".parsed.json");
  const imagePath = path.join(fixtureDir, entry.image);

  const ocrText = await fs.readFile(textPath, "utf8");
  const expected = JSON.parse(await fs.readFile(parsedPath, "utf8"));
  const actual = JSON.parse(JSON.stringify(parseTocFromOcrText(ocrText)));
  const matches = isDeepStrictEqual(actual, expected);
  if (!matches) {
    mismatchCount += 1;
  }

  const imageRel = relForHtml(imagePath);
  const status = matches ? "match" : "mismatch";
  const statusLabel = matches ? "MATCH" : "MISMATCH";

  cards.push(`
<section class="card ${status}">
  <h2>#${entry.index} - ${escapeHtml(entry.image)} <span class="badge">${statusLabel}</span></h2>
  <p><strong>Source screenshot:</strong> ${escapeHtml(entry.sourceFile)}</p>
  <div class="grid">
    <div>
      <h3>Screenshot</h3>
      <img src="${imageRel}" alt="${escapeHtml(entry.image)}" />
    </div>
    <div>
      <h3>OCR Text Fixture</h3>
      <pre>${escapeHtml(ocrText)}</pre>
    </div>
  </div>
  <div class="grid two">
    <div>
      <h3>Expected Parsed JSON</h3>
      <pre>${escapeHtml(JSON.stringify(expected, null, 2))}</pre>
    </div>
    <div>
      <h3>Actual Parsed JSON (Current Parser)</h3>
      <pre>${escapeHtml(JSON.stringify(actual, null, 2))}</pre>
    </div>
  </div>
</section>
  `);
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TOC Ground Truth Review</title>
  <style>
    :root {
      --bg: #f7f6f2;
      --ink: #102a43;
      --muted: #486581;
      --panel: #ffffff;
      --ok: #1f7a3e;
      --warn: #a33a3a;
      --border: #d9e2ec;
      --mono: "Cascadia Code", "Consolas", monospace;
      --sans: "Segoe UI", "Tahoma", sans-serif;
    }
    body {
      margin: 0;
      font-family: var(--sans);
      color: var(--ink);
      background: radial-gradient(circle at top right, #e4f2ff, transparent 45%), var(--bg);
      line-height: 1.4;
    }
    main {
      max-width: 1400px;
      margin: 0 auto;
      padding: 28px;
    }
    h1 {
      margin: 0 0 4px;
      letter-spacing: 0.3px;
    }
    .summary {
      color: var(--muted);
      margin-bottom: 18px;
      font-size: 15px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-left: 6px solid #8da2b8;
      border-radius: 12px;
      padding: 18px;
      margin-bottom: 16px;
      box-shadow: 0 8px 20px rgba(16, 42, 67, 0.06);
    }
    .card.match { border-left-color: var(--ok); }
    .card.mismatch { border-left-color: var(--warn); }
    .badge {
      display: inline-block;
      font-size: 12px;
      margin-left: 8px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #eef4fb;
      color: #243b53;
      vertical-align: middle;
    }
    .match .badge { background: #d9f7e5; color: #0f5132; }
    .mismatch .badge { background: #fde2e2; color: #7f1d1d; }
    .grid {
      display: grid;
      gap: 14px;
      grid-template-columns: 1fr 1fr;
      align-items: start;
    }
    .grid.two {
      margin-top: 14px;
    }
    h2, h3 { margin: 0 0 8px; }
    img {
      max-width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fff;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--mono);
      font-size: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: #f8fafc;
      max-height: 560px;
      overflow: auto;
    }
    @media (max-width: 1000px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <h1>TOC Ground Truth Review Dashboard</h1>
    <div class="summary">Fixtures: ${manifest.length} | Mismatches: ${mismatchCount} | Generated: ${new Date().toISOString()}</div>
    ${cards.join("\n")}
  </main>
</body>
</html>`;

await fs.writeFile(outHtml, html, "utf8");
console.log(`Review dashboard written: ${outHtml}`);
console.log(`Fixtures: ${manifest.length}, mismatches: ${mismatchCount}`);

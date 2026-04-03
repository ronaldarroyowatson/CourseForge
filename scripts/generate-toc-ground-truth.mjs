import fs from "node:fs/promises";
import path from "node:path";
import { createWorker } from "tesseract.js";

const SOURCE_DIR = "C:/Users/ronal/Downloads/TOC Screenshots";
const OUT_DIR = "tests/fixtures/toc-ground-truth";

function sanitizeToken(value, fallback) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function normalizeOcrText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function inferNameParts(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const chapterLine = lines.find((line) => /^(module|chapter)\s+[0-9ivx]+/i.test(line)) || "unknown_chapter";
  const sectionLine = lines.find((line) => /^(lesson|section)\s+[0-9ivx.]+/i.test(line)) || "unknown_section";

  const chapterMatch = chapterLine.match(/^(module|chapter)\s+([0-9ivx]+)/i);
  const sectionMatch = sectionLine.match(/^(lesson|section)\s+([0-9ivx.]+)/i);

  const chapter = chapterMatch
    ? `${chapterMatch[1]}_${chapterMatch[2]}`
    : "unknown_chapter";

  const section = sectionMatch
    ? `${sectionMatch[1]}_${sectionMatch[2]}`
    : "unknown_section";

  let expectedFields = "text_only";
  if (/\b\d+\s*[-–]\s*\d+\b/.test(text)) {
    expectedFields = "start_end_pages";
  } else if (/\b\d+\b/.test(text)) {
    expectedFields = "start_pages";
  }

  return {
    chapter: sanitizeToken(chapter, "unknown_chapter"),
    section: sanitizeToken(section, "unknown_section"),
    expectedFields,
  };
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.readdir(SOURCE_DIR))
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    throw new Error(`No PNG files found in ${SOURCE_DIR}`);
  }

  const worker = await createWorker("eng");

  try {
    const manifest = [];

    for (let index = 0; index < files.length; index += 1) {
      const fileName = files[index];
      const sourcePath = path.join(SOURCE_DIR, fileName);
      const result = await worker.recognize(sourcePath);
      const text = normalizeOcrText(result.data.text || "");
      const parts = inferNameParts(text);
      const ordinal = String(index + 1).padStart(2, "0");
      const baseName = `${parts.chapter}_${parts.section}_${parts.expectedFields}_${ordinal}`;

      const pngOutPath = path.join(OUT_DIR, `${baseName}.png`);
      const txtOutPath = path.join(OUT_DIR, `${baseName}.txt`);

      await fs.copyFile(sourcePath, pngOutPath);
      await fs.writeFile(txtOutPath, `${text}\n`, "utf8");

      manifest.push({
        index: index + 1,
        sourceFile: fileName,
        image: `${baseName}.png`,
        text: `${baseName}.txt`,
      });
    }

    await fs.writeFile(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Generated ${manifest.length} OCR ground-truth fixture pairs in ${OUT_DIR}`);
  } finally {
    await worker.terminate();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

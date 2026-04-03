import fs from "node:fs/promises";
import path from "node:path";

import { createWorker, type Worker } from "tesseract.js";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { parseTocFromOcrText } from "../../src/core/services/textbookAutoExtractionService";

const FIXTURE_DIR = path.resolve("tests/fixtures/toc-ground-truth");

interface GroundTruthManifestEntry {
  index: number;
  sourceFile: string;
  image: string;
  text: string;
}

function normalizeOcrText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function toTokenSet(text: string): Set<string> {
  const normalized = normalizeOcrText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 4);

  return new Set(tokens);
}

function lexicalOverlapRatio(left: string, right: string): number {
  const leftSet = toTokenSet(left);
  const rightSet = toTokenSet(right);

  if (!leftSet.size || !rightSet.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  return intersection / Math.max(1, leftSet.size);
}

async function readManifest(): Promise<GroundTruthManifestEntry[]> {
  const raw = await fs.readFile(path.join(FIXTURE_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw) as GroundTruthManifestEntry[];
}

describe("TOC OCR + parser ground truth", () => {
  let worker: Worker;

  beforeAll(async () => {
    worker = await createWorker("eng");
  }, 120_000);

  afterAll(async () => {
    await worker.terminate();
  });

  it("keeps OCR output semantically aligned with fixture text for every provided screenshot", async () => {
    const manifest = await readManifest();

    for (const entry of manifest) {
      const imagePath = path.join(FIXTURE_DIR, entry.image);
      const expectedPath = path.join(FIXTURE_DIR, entry.text);
      const expectedText = normalizeOcrText(await fs.readFile(expectedPath, "utf8"));

      let actualText = "";
      let bestOverlap = 0;

      // OCR can vary on spread-style screenshots; retry once and keep the best lexical overlap.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const recognized = await worker.recognize(imagePath);
        actualText = normalizeOcrText(recognized.data.text ?? "");
        bestOverlap = Math.max(bestOverlap, lexicalOverlapRatio(expectedText, actualText));
      }

      expect(
        bestOverlap,
        `OCR lexical overlap too low for fixture ${entry.image}`
      ).toBeGreaterThanOrEqual(0.35);
    }
  }, 300_000);

  it("matches parser ground truth exactly for every OCR fixture", async () => {
    const manifest = await readManifest();

    for (const entry of manifest) {
      const textPath = path.join(FIXTURE_DIR, entry.text);
      const parsedPath = textPath.replace(/\.txt$/i, ".parsed.json");

      const text = await fs.readFile(textPath, "utf8");
      const expected = JSON.parse(await fs.readFile(parsedPath, "utf8"));
      const actual = JSON.parse(JSON.stringify(parseTocFromOcrText(text)));

      expect(actual).toStrictEqual(expected);
    }
  });
});

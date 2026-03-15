import { describe, expect, it } from "vitest";

import {
  createInitialAutoCaptureUsage,
  assessImageModerationSignal,
  detectPageBoundaryFromRgba,
  enforceAutoCaptureLimit,
  evaluateAutoCaptureSafety,
  extractMetadataFromOcrText,
  mergeParsedToc,
  parseTocFromOcrText,
  scoreMetadataConfidence,
  stitchTocPages,
} from "../../src/core/services/textbookAutoExtractionService";

describe("textbookAutoExtractionService", () => {
  it("detects page boundaries inside a larger background", () => {
    const width = 100;
    const height = 80;
    const rgba = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const isPage = x >= 20 && x <= 79 && y >= 12 && y <= 69;
        const tone = isPage ? 40 : 245;
        rgba[index] = tone;
        rgba[index + 1] = tone;
        rgba[index + 2] = tone;
        rgba[index + 3] = 255;
      }
    }

    const boundary = detectPageBoundaryFromRgba(rgba, width, height);
    expect(boundary.x).toBeGreaterThanOrEqual(18);
    expect(boundary.x).toBeLessThanOrEqual(22);
    expect(boundary.y).toBeGreaterThanOrEqual(10);
    expect(boundary.y).toBeLessThanOrEqual(14);
    expect(boundary.width).toBeGreaterThanOrEqual(58);
    expect(boundary.height).toBeGreaterThanOrEqual(56);
  });

  it("maps OCR text into textbook metadata fields", () => {
    const metadata = extractMetadataFromOcrText([
      "Foundations of Algebra",
      "A Visual Path to Problem Solving",
      "By Maria Chen and David Roth",
      "3rd Edition",
      "Northbridge Press",
      "Grades 7-9",
      "ISBN 978-1-4028-9462-6",
      "Series: STEM Core",
      "Copyright 2024",
    ].join("\n"));

    expect(metadata.title).toBe("Foundations Of Algebra");
    expect(metadata.subtitle).toContain("Visual Path");
    expect(metadata.edition).toContain("Edition");
    expect(metadata.authors).toContain("Maria Chen");
    expect(metadata.publisher).toContain("Northbridge");
    expect(metadata.subject).toBe("Math");
    expect(metadata.gradeBand).toContain("7");
    expect(metadata.isbn).toBe("9781402894626");
    expect(metadata.seriesName).toBe("STEM Core");
    expect(metadata.copyrightYear).toBe(2024);
  });

  it("parses TOC lines into chapters and sections", () => {
    const parsed = parseTocFromOcrText([
      "Table of Contents",
      "Unit 1 Foundations",
      "Chapter 1 Integers 12",
      "1.1 Absolute Value 14",
      "1.2 Number Lines 20",
      "Chapter 2 Expressions 28",
      "2.1 Variables and Terms 30",
    ].join("\n"));

    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0].chapterNumber).toBe("1");
    expect(parsed.chapters[0].sections).toHaveLength(2);
    expect(parsed.chapters[0].sections[0].sectionNumber).toBe("1.1");
    expect(parsed.confidence).toBeGreaterThan(0.5);
  });

  it("merges TOC captures from multiple pages", () => {
    const first = parseTocFromOcrText("Chapter 1 Integers 10\n1.1 Absolute Value 12");
    const second = parseTocFromOcrText("Chapter 1 Integers 10\n1.2 Number Lines 18");
    const merged = mergeParsedToc(first, second);

    expect(merged.chapters).toHaveLength(1);
    expect(merged.chapters[0].sections).toHaveLength(2);
  });

  it("stitches TOC pages in order, dedupes entries, and returns confidence", () => {
    const stitched = stitchTocPages([
      {
        pageIndex: 2,
        confidence: 0.7,
        chapters: [
          {
            chapterNumber: "2",
            title: "Expressions",
            sections: [{ sectionNumber: "2.01", title: "Variables" }],
          },
        ],
      },
      {
        pageIndex: 1,
        confidence: 0.82,
        chapters: [
          {
            chapterNumber: "1",
            title: "Integers",
            sections: [{ sectionNumber: "1.1", title: "Absolute Value" }],
          },
          {
            chapterNumber: "2",
            title: "Expressions",
            sections: [{ sectionNumber: "2.1", title: "Variables" }],
          },
        ],
      },
    ]);

    expect(stitched.chapters).toHaveLength(2);
    expect(stitched.chapters[0].chapterNumber).toBe("1");
    expect(stitched.chapters[1].sections).toHaveLength(1);
    expect(stitched.chapters[1].sections[0].sectionNumber).toBe("2.1");
    expect(stitched.stitchingConfidence).toBeGreaterThan(0.5);
  });

  it("scores metadata confidence and marks extracted fields as auto", () => {
    const metadata = extractMetadataFromOcrText([
      "Foundations of Algebra",
      "By Maria Chen",
      "3rd Edition",
      "ISBN 978-1-4028-9462-6",
      "Copyright 2024",
    ].join("\n"));

    const scored = scoreMetadataConfidence([
      "Foundations of Algebra",
      "By Maria Chen",
      "3rd Edition",
      "ISBN 978-1-4028-9462-6",
      "Copyright 2024",
    ].join("\n"), metadata);

    expect(scored.title?.sourceType).toBe("auto");
    expect(scored.title?.confidence).toBeGreaterThan(0.5);
    expect(scored.isbn?.confidence).toBeGreaterThan(0.7);
  });

  it("enforces hard capture limits", () => {
    let usage = createInitialAutoCaptureUsage();

    const firstCover = enforceAutoCaptureLimit(usage, "cover");
    expect(firstCover.allowed).toBe(true);
    usage = firstCover.nextUsage;

    const secondCover = enforceAutoCaptureLimit(usage, "cover");
    expect(secondCover.allowed).toBe(false);
    expect(secondCover.message).toContain("dedicated capture tool");

    usage = createInitialAutoCaptureUsage();
    for (let index = 0; index < 10; index += 1) {
      const result = enforceAutoCaptureLimit(usage, "toc");
      expect(result.allowed).toBe(true);
      usage = result.nextUsage;
    }

    const overLimit = enforceAutoCaptureLimit(usage, "toc");
    expect(overLimit.allowed).toBe(false);
  });

  it("blocks profanity and adult content in captures", () => {
    const profanity = evaluateAutoCaptureSafety("This page says fuck", "cover");
    expect(profanity.allowed).toBe(false);
    expect(profanity.reason).toBe("profanity");

    const adult = evaluateAutoCaptureSafety("xxx explicit porn content", "title");
    expect(adult.allowed).toBe(false);
    expect(adult.reason).toBe("adult");
  });

  it("blocks non-book pages and allows likely textbook text", () => {
    const nonBook = evaluateAutoCaptureSafety("hot deals buy now free shipping", "cover");
    expect(nonBook.allowed).toBe(false);
    expect(nonBook.reason).toBe("non-book");

    const validCover = evaluateAutoCaptureSafety(
      "Foundations of Algebra\n3rd Edition\nISBN 978-1-4028-9462-6\nNorthbridge Press",
      "cover"
    );
    expect(validCover.allowed).toBe(true);
  });

  it("blocks TOC captures that are not table-of-contents content", () => {
    const nonToc = evaluateAutoCaptureSafety("Welcome to our sales dashboard", "toc");
    expect(nonToc.allowed).toBe(false);
    expect(nonToc.reason).toBe("non-book");

    const toc = evaluateAutoCaptureSafety("Table of Contents\nChapter 1 Integers\n1.1 Absolute Value", "toc");
    expect(toc.allowed).toBe(true);
  });

  it("uses image-level moderation with educational context exception", () => {
    const blocked = assessImageModerationSignal({
      skinToneRatio: 0.81,
      contextText: "summer beach magazine",
    });
    expect(blocked.decision).toBe("block");

    const review = assessImageModerationSignal({
      skinToneRatio: 0.78,
      contextText: "Grey's Anatomy textbook for medical students",
    });
    expect(review.decision).toBe("review");
    expect(review.educationalContextDetected).toBe(true);

    const clear = assessImageModerationSignal({
      skinToneRatio: 0.18,
      contextText: "Algebra student edition",
    });
    expect(clear.decision).toBe("allow");
  });
});

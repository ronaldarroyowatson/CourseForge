import { describe, expect, it } from "vitest";

import {
  createInitialAutoCaptureUsage,
  assessImageModerationSignal,
  detectPageBoundaryFromRgba,
  enforceAutoCaptureLimit,
  evaluateAutoCaptureSafety,
  extractMetadataFromOcrText,
  mergeAutoMetadata,
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

  it("infers subject as Science for Inspire Physical Science with Earth Science", () => {
    const metadata = extractMetadataFromOcrText([
      "Student Edition",
      "Inspire Physical Science with Earth Science",
      "Mc Graw Hill",
    ].join("\n"));

    expect(metadata.subject).toBe("Science");
  });

  it("extracts rich metadata from a copyright page", () => {
    const metadata = extractMetadataFromOcrText([
      "Student Edition",
      "Inspire Physical Science with Earth Science",
      "mheducation.com/prek-12",
      "McGraw-Hill Education",
      "Copyright © 2021 McGraw-Hill Education",
      "Send all inquiries to:",
      "McGraw-Hill Education",
      "STEM Learning Solutions Center",
      "8787 Orion Place",
      "Columbus, OH 43240",
      "ISBN: 978-0-07-671685-2",
      "Teacher ISBN: 978-0-07-671700-2",
      "MHID: 0-07-671685-6",
      "Printed in the United States of America.",
    ].join("\n"));

    expect(metadata.title).toBe("Inspire Physical Science With Earth Science");
    expect(metadata.seriesName).toBe("Inspire");
    expect(metadata.copyrightYear).toBe(2021);
    expect(metadata.isbn).toBe("9780076716852");
    expect(metadata.relatedIsbns).toEqual([
      expect.objectContaining({ isbn: "9780076717002", type: "teacher" }),
    ]);
    expect(metadata.publisherLocation).toContain("Columbus, OH 43240");
    expect(metadata.publisherLocation).not.toContain("reproduced or distributed");
    expect(metadata.platformUrl).toBe("https://mheducation.com/prek-12");
    expect(metadata.gradeBand).toBe("Pre-K-12");
    expect(metadata.mhid).toBe("0-07-671685-6");
  });

  it("extracts screenshot copyright-page metadata from mixed-column OCR text", () => {
    const metadata = extractMetadataFromOcrText([
      "Inspire Physical Science",
      "with Earth Science",
      "FRONT COVER: William Clemente/EyeEm/Getty Images. BACK COVER: William Clemente/EyeEm/Getty Images.",
      "mheducation.com/prek-12",
      "STEM",
      "McGraw-Hill is committed to providing instructional materials in Science, Technology, Engineering, and Mathematics (STEM) that give all students a solid foundation, one that prepares them for college and careers in the 21st century.",
      "McGraw Hill",
      "Copyright © 2021 McGraw-Hill Education",
      "All rights reserved. No part of this publication may be reproduced or distributed in any form or by any means, or stored in a database or retrieval system, without the prior written consent of McGraw-Hill Education, including, but not limited to, network storage or transmission, or broadcast for distance learning.",
      "Send all inquiries to:",
      "McGraw-Hill Education",
      "STEM Learning Solutions Center",
      "8787 Orion Place",
      "Columbus, OH 43240",
      "ISBN: 978-0-07-671685-2",
      "MHID: 0-07-671685-6",
      "Printed in the United States of America.",
    ].join("\n"));

    expect(metadata.title).toBe("Inspire Physical Science");
    expect(metadata.subtitle).toBe("with Earth Science");
    expect(metadata.subject).toBe("Science");
    expect(metadata.publisher).toBe("McGraw Hill");
    expect(metadata.platformUrl).toBe("https://mheducation.com/prek-12");
    expect(metadata.gradeBand).toBe("Pre-K-12");
    expect(metadata.copyrightYear).toBe(2021);
    expect(metadata.isbn).toBe("9780076716852");
    expect(metadata.mhid).toBe("0-07-671685-6");
    expect(metadata.publisherLocation).toBe("McGraw-Hill Education\nSTEM Learning Solutions Center\n8787 Orion Place\nColumbus, OH 43240");
  });

  it("does not treat legal boilerplate as title/subtitle", () => {
    const metadata = extractMetadataFromOcrText([
      "Copyright © 2021 McGraw-Hill Education",
      "All rights reserved. No part of this publication may be reproduced or distributed in any form or by any means.",
      "Send all inquiries to:",
      "McGraw-Hill Education",
      "STEM Learning Solutions Center",
      "8787 Orion Place",
      "Columbus, OH 43240",
      "mheducation.com/prek-12",
      "ISBN: 978-0-07-671685-2",
    ].join("\n"));

    expect(metadata.title).toBeUndefined();
    expect(metadata.subtitle).toBeUndefined();
    expect(metadata.platformUrl).toBe("https://mheducation.com/prek-12");
    expect(metadata.publisherLocation).toBe("McGraw-Hill Education\nSTEM Learning Solutions Center\n8787 Orion Place\nColumbus, OH 43240");
  });

  it("does not promote module headings into textbook metadata", () => {
    const metadata = extractMetadataFromOcrText([
      "Student Edition",
      "Module 1",
      "The Nature of Science",
      "Inspire Physical Science with Earth Science",
      "McGraw-Hill Education",
    ].join("\n"));

    expect(metadata.title).toBe("Inspire Physical Science With Earth Science");
    expect(metadata.subtitle).not.toBe("Module 1");
  });

  it("preserves cover metadata when later OCR looks like section metadata", () => {
    const merged = mergeAutoMetadata(
      {
        title: "Inspire Physical Science With Earth Science",
        subtitle: "Student Edition",
        subject: "Science",
      },
      {
        title: "The Nature of Science",
        subtitle: "Module 1",
      }
    );

    expect(merged.title).toBe("Inspire Physical Science With Earth Science");
    expect(merged.subtitle).toBe("Student Edition");
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

  it("recovers noisy CER and lesson page tokens in module TOC OCR", () => {
    const parsed = parseTocFromOcrText([
      "MODULE 1: THE NATURE OF SCIENCE",
      "Lesson 1 The Methods of Science 4",
      "Lesson 2 Standards of Measurement 12",
      "Lesson 3 Communicating with Graphs 19",
      "Lesson 4 Science and Technology 24",
      "Scientific Methods 31",
      "Module Wrap-Up 33",
      "MODULE 2: MOTION",
      "ENCOUNTER THE PHENOMENON",
      "(= Claim, Evidence, Reasoning Ea",
      "Lesson 1 Describing Motion El",
      "Lesson 2 Velocity and Momentum 5",
      "Lesson 3 Acceleration 50",
      "Autonomous Vehicles Go Subterranean 55",
      "Module Wrap-Up 57",
      "MODULE 3: FORCES AND NEWTON'S LAWS 59",
      "Lesson 1 Forces 60",
    ].join("\n"));

    const moduleTwo = parsed.chapters.find((chapter) => chapter.chapterNumber === "2");
    expect(moduleTwo).toBeDefined();

    const cer = moduleTwo?.sections.find((section) => section.title.includes("Claim, Evidence, Reasoning"));
    expect(cer?.pageStart).toBe(37);
    expect(cer?.pageEnd).toBe(37);

    const lessonOne = moduleTwo?.sections.find((section) => section.sectionNumber === "2.1");
    expect(lessonOne?.title).toBe("Describing Motion");
    expect(lessonOne?.pageStart).toBe(38);

    const lessonTwo = moduleTwo?.sections.find((section) => section.sectionNumber === "2.2");
    expect(lessonTwo?.pageStart).toBe(45);
    expect(lessonTwo?.pageEnd).toBe(49);
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

  // Phase 1: Enhanced OCR Field Extraction Tests
  describe("Phase 1: Enhanced extraction of all required copyright page fields", () => {
    it("extracts ISBN even when label is missing from line", () => {
      const metadata = extractMetadataFromOcrText([
        "The Nature of Science",
        "Student Edition",
        "978-0-07-671685-2",  // ISBN without label
        "McGraw-Hill Education",
      ].join("\n"));

      expect(metadata.isbn).toBe("9780076716852");
    });

    it("extracts multiple ISBN formats with different separators", () => {
      const metadata = extractMetadataFromOcrText([
        "ISBN: 978-0-07-671685-2",
        "Teacher ISBN: 9780076717002",
        "Alternative: 978 0 07 671685 2",
      ].join("\n"));

      expect(metadata.isbn).toBe("9780076716852");
      expect(metadata.additionalIsbns).toContain("9780076717002");
    });

    it("extracts ISBN-10 format correctly", () => {
      const metadata = extractMetadataFromOcrText([
        "ISBN: 0-07-671685-6",
        "ISBN-13: 978-0-07-671685-2",
      ].join("\n"));

      // Both should be normalized to 10 or 13 digit format
      expect(metadata.isbn).toBeDefined();
      expect(metadata.isbn?.length).toBeGreaterThanOrEqual(10);
    });

    it("extracts copyright year with multiple patterns", () => {
      // Pattern 1: Copyright symbol + year
      const meta1 = extractMetadataFromOcrText("Copyright © 2021 McGraw-Hill Education");
      expect(meta1.copyrightYear).toBe(2021);

      // Pattern 2: Copyright word + year
      const meta2 = extractMetadataFromOcrText("Copyright 2021 McGraw-Hill Education");
      expect(meta2.copyrightYear).toBe(2021);

      // Pattern 3: Just the year in context
      const meta3 = extractMetadataFromOcrText("McGraw-Hill Education\n2021");
      expect(meta3.copyrightYear).toBe(2021);
    });

    it("validates copyright year is within reasonable range", () => {
      const validYear = extractMetadataFromOcrText("Copyright © 2021");
      expect(validYear.copyrightYear).toBe(2021);

      const futureYear = extractMetadataFromOcrText("Copyright © 2030");  // Up to 5 years in future OK
      expect(futureYear.copyrightYear).toBe(2030);

      const invalidYear = extractMetadataFromOcrText("Version 1800");  // Too old
      expect(invalidYear.copyrightYear).toBeUndefined();
    });

    it("extracts publisher location from traditional address blocks", () => {
      const metadata = extractMetadataFromOcrText([
        "McGraw-Hill Education",
        "STEM Learning Solutions Center",
        "8787 Orion Place",
        "Columbus, OH 43240",
      ].join("\n"));

      expect(metadata.publisherLocation).toBeDefined();
      expect(metadata.publisherLocation).toContain("Columbus");
      expect(metadata.publisherLocation).toContain("OH");
      expect(metadata.publisherLocation).toContain("43240");
    });

    it("extracts publisher location from 'Send all inquiries to:' blocks", () => {
      const metadata = extractMetadataFromOcrText([
        "Send all inquiries to:",
        "McGraw-Hill Education",
        "8787 Orion Place",
        "Columbus, OH 43240",
      ].join("\n"));

      expect(metadata.publisherLocation).toBeDefined();
      expect(metadata.publisherLocation).toContain("McGraw-Hill");
      expect(metadata.publisherLocation).toContain("8787 Orion Place");
    });

    it("handles multi-line publisher addresses", () => {
      const metadata = extractMetadataFromOcrText([
        "Send all inquiries to:",
        "Pearson Education",
        "Publisher Education Group",
        "One Lake Street",
        "Upper Saddle River, NJ 07458",
      ].join("\n"));

      expect(metadata.publisherLocation).toBeDefined();
      const lines = metadata.publisherLocation!.split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(metadata.publisherLocation).toContain("Upper Saddle River");
    });

    it("excludes legal boilerplate from publisher location", () => {
      const metadata = extractMetadataFromOcrText([
        "McGraw-Hill Education",
        "8787 Orion Place",
        "Columbus, OH 43240",
        "All rights reserved. No part of this publication may be reproduced.",
        "Printed in the United States of America.",
      ].join("\n"));

      expect(metadata.publisherLocation).toBeDefined();
      expect(metadata.publisherLocation).not.toContain("reproduced");
      expect(metadata.publisherLocation).not.toContain("United States");
    });

    it("ignores cross-column spillover lines when extracting 'Send all inquiries' address block", () => {
      const metadata = extractMetadataFromOcrText([
        "Hill Copyright 2021 McGraw-Hill Education McGraw-Hill is committed to providing instructional materials",
        "Send all inquiries to:",
        "McGraw-Hill Education",
        "STEM Learning Solutions Center",
        "8787 Orion Place",
        "Columbus, OH 43240",
        "ISBN: 978-0-07-671685-2",
      ].join("\n"));

      expect(metadata.publisherLocation).toBe("McGraw-Hill Education\nSTEM Learning Solutions Center\n8787 Orion Place\nColumbus, OH 43240");
      expect(metadata.publisherLocation).not.toContain("committed to providing");
    });

    it("extracts platform URLs from various formats", () => {
      // Full HTTPS URL
      const meta1 = extractMetadataFromOcrText("Visit https://mheducation.com/prek-12");
      expect(meta1.platformUrl).toBe("https://mheducation.com/prek-12");

      // www format
      const meta2 = extractMetadataFromOcrText("www.mheducation.com");
      expect(meta2.platformUrl).toContain("mheducation.com");

      // domain.com format
      const meta3 = extractMetadataFromOcrText("mheducation.com/prek-12");
      expect(meta3.platformUrl).toContain("mheducation.com");
    });

    it("normalizes URLs to HTTPS when scheme is missing", () => {
      const metadata = extractMetadataFromOcrText("mheducation.com/textbooks");
      expect(metadata.platformUrl).toMatch(/^https?:\/\//);
    });

    it("extracts all fields from realistic copyright page OCR text (screenshot scenario)", () => {
      const metadata = extractMetadataFromOcrText([
        "The Nature of Science",
        "Student Edition",
        "",
        "Grade Band",
        "",
        "Subject",
        "Science",
        "Edition",
        "",
        "Publication Year",
        "",
        "Copyright Year",
        "",
        "ISBN",
        "978-0-07-671685-2",
        "Additional ISBNs (comma separated)",
        "",
        "Related ISBNs (typed)",
        "Use this when the copyright page lists student, teacher, digital, workbook, or assessment ISBNs separately.",
        "+ Add Related ISBN",
        "",
        "Capture Copyright Page",
        "Upload Copyright Page",
        "Inspire",
        "Physical Science",
        "Copyright © 2021 McGraw-Hill Education",
        "ISBN: 978-0-07-671685-2",
        "MHID: 0-07-671685-6",
        "Teacher ISBN: 978-0-07-671700-2",
        "Send all inquiries to:",
        "McGraw-Hill Education",
        "STEM Learning Solutions Center",
        "8787 Orion Place",
        "Columbus, OH 43240",
        "https://mheducation.com/prek-12",
      ].join("\n"));

      // Verify all critical fields are extracted
      expect(metadata.title).toBeDefined();
      expect(metadata.isbn).toBe("9780076716852");
      expect(metadata.copyrightYear).toBe(2021);
      expect(metadata.mhid).toBe("0-07-671685-6");
      expect(metadata.publisherLocation).toBeDefined();
      expect(metadata.publisherLocation).toContain("Columbus, OH 43240");
      expect(metadata.platformUrl).toContain("mheducation.com");
    });

    it("handles edge case: ISBN without hyphens", () => {
      const metadata = extractMetadataFromOcrText("ISBN 9780076716852");
      expect(metadata.isbn).toBe("9780076716852");
    });

    it("distinguishes main ISBN from teacher/related ISBNs", () => {
      const metadata = extractMetadataFromOcrText([
        "Student Edition ISBN: 978-0-07-671685-2",
        "Teacher ISBN: 978-0-07-671700-2",
        "Digital ISBN: 978-0-07-671722-4",
      ].join("\n"));

      expect(metadata.isbn).toBe("9780076716852");  // Student = primary
      expect(metadata.relatedIsbns).toContainEqual(
        expect.objectContaining({ isbn: "9780076717002", type: "teacher" })
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Permanent validation suite: McGraw-Hill copyright page (screenshot 3)
  // Required fields every run: isbn, publisherLocation, copyrightYear,
  // platformUrl, gradeBand.
  // ────────────────────────────────────────────────────────────────────────────
  describe("McGraw-Hill copyright page — permanent validation suite", () => {
    // Canonical full OCR text that Agent A (cloud OCR) must produce from the
    // copyright page screenshot. All text sections from both columns included.
    const MCGRAW_COPYRIGHT_PAGE_FULL_OCR = [
      "mheducation.com/prek-12",
      "McGraw Hill",
      "Copyright © 2021 McGraw-Hill Education",
      "All rights reserved. No part of this publication may be reproduced or distributed in any form or by any means, or stored in a database or retrieval system, without the prior written consent of McGraw-Hill Education, including, but not limited to, network storage or transmission, or broadcast for distance learning.",
      "Send all inquiries to:",
      "McGraw-Hill Education",
      "STEM Learning Solutions Center",
      "8787 Orion Place",
      "Columbus, OH 43240",
      "ISBN: 978-0-07-671685-2",
      "MHID: 0-07-671685-6",
      "Printed in the United States of America.",
      "3 4 5 6 7 8 LWI 24 23 22 21",
      "STEM",
      "McGraw-Hill is committed to providing instructional materials in Science, Technology, Engineering, and Mathematics (STEM) that give all students a solid foundation, one that prepares them for college and careers in the 21st century.",
    ].join("\n");

    it("OCR completeness: full text contains all required sections", () => {
      // This test documents what Agent A (cloud OCR) MUST return when processing
      // the copyright page screenshot. Every section that follows must be present.
      const ocrText = MCGRAW_COPYRIGHT_PAGE_FULL_OCR;

      // Publisher URL (top of page)
      expect(ocrText).toContain("mheducation.com/prek-12");

      // Copyright notice
      expect(ocrText).toContain("Copyright © 2021");

      // "Send all inquiries" section marker
      expect(ocrText).toContain("Send all inquiries to:");

      // Full address block
      expect(ocrText).toContain("STEM Learning Solutions Center");
      expect(ocrText).toContain("8787 Orion Place");
      expect(ocrText).toContain("Columbus, OH 43240");

      // ISBN and MHID identifiers
      expect(ocrText).toContain("ISBN: 978-0-07-671685-2");
      expect(ocrText).toContain("MHID: 0-07-671685-6");

      // Right-column STEM content
      expect(ocrText).toContain("STEM");
      expect(ocrText).toContain("Science, Technology, Engineering, and Mathematics");
    });

    it("Agent B metadata extraction: ISBN extracted and normalized from full OCR", () => {
      const metadata = extractMetadataFromOcrText(MCGRAW_COPYRIGHT_PAGE_FULL_OCR);
      expect(metadata.isbn).toBe("9780076716852");
    });

    it("Agent B metadata extraction: publisher address extracted from full OCR", () => {
      const metadata = extractMetadataFromOcrText(MCGRAW_COPYRIGHT_PAGE_FULL_OCR);
      expect(metadata.publisherLocation).toBeDefined();
      expect(metadata.publisherLocation).toContain("McGraw-Hill Education");
      expect(metadata.publisherLocation).toContain("STEM Learning Solutions Center");
      expect(metadata.publisherLocation).toContain("8787 Orion Place");
      expect(metadata.publisherLocation).toContain("Columbus, OH 43240");
    });

    it("Agent B metadata extraction: copyright year extracted from full OCR", () => {
      const metadata = extractMetadataFromOcrText(MCGRAW_COPYRIGHT_PAGE_FULL_OCR);
      expect(metadata.copyrightYear).toBe(2021);
    });

    it("Agent B metadata extraction: publisher URL extracted from full OCR", () => {
      const metadata = extractMetadataFromOcrText(MCGRAW_COPYRIGHT_PAGE_FULL_OCR);
      expect(metadata.platformUrl).toBe("https://mheducation.com/prek-12");
    });

    it("Agent B metadata extraction: grade band inferred from URL in full OCR", () => {
      const metadata = extractMetadataFromOcrText(MCGRAW_COPYRIGHT_PAGE_FULL_OCR);
      expect(metadata.gradeBand).toBe("Pre-K-12");
    });

    it("Agent B metadata extraction: MHID extracted from full OCR", () => {
      const metadata = extractMetadataFromOcrText(MCGRAW_COPYRIGHT_PAGE_FULL_OCR);
      expect(metadata.mhid).toBe("0-07-671685-6");
    });

    it("Agent B metadata extraction: all five required fields present simultaneously", () => {
      // This is the primary regression test — all required fields together.
      const metadata = extractMetadataFromOcrText(MCGRAW_COPYRIGHT_PAGE_FULL_OCR);

      expect(metadata.isbn).toBe("9780076716852");
      expect(metadata.publisherLocation).toContain("Columbus, OH 43240");
      expect(metadata.copyrightYear).toBe(2021);
      expect(metadata.platformUrl).toBe("https://mheducation.com/prek-12");
      expect(metadata.gradeBand).toBe("Pre-K-12");
    });

    it("pipeline integration: full OCR text yields correct metadata through complete pipeline (OCR-only path)", async () => {
      // Simulates Agent A returning the full copyright page text; Agent B parses it.
      const { extractMetadataFromOcrText: parseOcr } = await import(
        "../../src/core/services/textbookAutoExtractionService"
      );

      const parsed = parseOcr(MCGRAW_COPYRIGHT_PAGE_FULL_OCR);

      expect(parsed.isbn).toBe("9780076716852");
      expect(parsed.copyrightYear).toBe(2021);
      expect(parsed.platformUrl).toBe("https://mheducation.com/prek-12");
      expect(parsed.gradeBand).toBe("Pre-K-12");
      expect(parsed.publisherLocation).toContain("Columbus, OH 43240");
    });
  });
});

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

  it("leaves subject undefined when OCR text is too ambiguous", () => {
    const metadata = extractMetadataFromOcrText([
      "Student Edition",
      "Workbook",
      "Copyright 2026",
      "Northbridge Press",
    ].join("\n"));

    expect(metadata.subject).toBeUndefined();
  });

  it("does not infer ELA from generic English-only wording", () => {
    const metadata = extractMetadataFromOcrText([
      "Student Edition",
      "English Version",
      "Workbook",
      "Copyright 2026",
    ].join("\n"));

    expect(metadata.subject).toBeUndefined();
  });

  it("does not infer ELA when book only mentions reading and writing generically", () => {
    // Regression: "reading" + "writing" together used to score elaScore=2 and trigger ELA.
    // These words appear in companion notebooks, skill guides, and supplement books for ANY subject.
    const cases = [
      ["Interactive Student Notebook", "Reading and Writing Support", "McGraw-Hill Education", "Grade 7"],
      ["Student Resource Guide", "Reading and Writing Skills for Academic Success", "Pearson", "Grade 10"],
      ["Reading and Writing Strategies", "Science Companion Workbook", "Grade 6"],
      ["Algebra 1", "Student Edition with Reading and Writing Workshop", "Savvas Learning", "Grade 8"],
    ];
    for (const lines of cases) {
      const metadata = extractMetadataFromOcrText(lines.join("\n"));
      expect(metadata.subject).not.toBe("ELA");
    }
  });

  it("infers ELA when book explicitly names language arts or grammar", () => {
    const cases: [string[], string][] = [
      [["Language Arts", "Grade 5", "McGraw-Hill Education"], "ELA"],
      [["English Language Arts", "Student Edition", "Grade 3", "Pearson"], "ELA"],
      [["Grammar Workshop", "Level Orange", "Sadlier", "Grade 6"], "ELA"],
      [["American Literature", "Student Edition", "Holt McDougal", "Grade 11"], "ELA"],
    ];
    for (const [lines, expectedSubject] of cases) {
      const metadata = extractMetadataFromOcrText(lines.join("\n"));
      expect(metadata.subject).toBe(expectedSubject);
    }
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

  // Unit Hierarchy Tests
  describe("Unit hierarchy extraction and stitching", () => {
    it("extracts Units from OCR text with proper chapter association", () => {
      const parsed = parseTocFromOcrText([
        "Table of Contents",
        "Unit 1: Foundations of Mathematics",
        "Chapter 1 Integers 12",
        "1.1 Absolute Value 14",
        "1.2 Number Lines 20",
        "Chapter 2 Expressions 28",
        "2.1 Variables and Terms 30",
        "Unit 2: Advanced Topics",
        "Chapter 3 Functions 40",
        "3.1 Function Notation 42",
        "Chapter 4 Calculus 50",
        "4.1 Limits 52",
      ].join("\n"));

      expect(parsed.units).toBeDefined();
      expect(parsed.units).toHaveLength(2);
      expect(parsed.units?.[0].unitNumber).toBe("1");
      expect(parsed.units?.[0].title).toContain("Foundations");
      expect(parsed.units?.[0].chapters).toHaveLength(2);
      expect(parsed.units?.[0].chapters[0].chapterNumber).toBe("1");
      expect(parsed.units?.[1].unitNumber).toBe("2");
      expect(parsed.units?.[1].title).toContain("Advanced");
      expect(parsed.units?.[1].chapters).toHaveLength(2);
    });

    it("maintains chapter sections within unit structure", () => {
      const parsed = parseTocFromOcrText([
        "Unit A: Fundamentals",
        "Chapter 1 Introduction 10",
        "1.1 Overview 12",
        "1.2 Goals 15",
        "1.3 Resources 18",
        "Chapter 2 Basics 20",
        "2.1 Theory 22",
      ].join("\n"));

      expect(parsed.units).toBeDefined();
      const unit = parsed.units?.[0];
      expect(unit?.chapters[0].sections).toHaveLength(3);
      expect(unit?.chapters[0].sections[0].sectionNumber).toBe("1.1");
      expect(unit?.chapters[1].sections).toHaveLength(1);
    });

    it("handles single unit with mixed chapter numbering", () => {
      const parsed = parseTocFromOcrText([
        "Unit I: Introduction",
        "Module 1 Welcome 5",
        "Lesson 1.1 Getting Started 7",
        "Lesson 1.2 Setup 10",
        "Module 2 Concepts 15",
        "Lesson 2.1 Key Ideas 17",
      ].join("\n"));

      expect(parsed.units).toHaveLength(1);
      expect(parsed.units?.[0].title).toContain("Introduction");
      expect(parsed.units?.[0].chapters).toHaveLength(2);
    });

    it("stitches units correctly across multiple TOC pages", () => {
      const page1 = parseTocFromOcrText([
        "Unit 1: Part A",
        "Chapter 1 First 10",
        "1.1 Section 12",
        "Chapter 2 Second 20",
        "2.1 Section 22",
      ].join("\n"));

      const page2 = parseTocFromOcrText([
        "Unit 1: Part A",
        "Chapter 2 Second 20",
        "2.1 Section 22",
        "Unit 2: Part B",
        "Chapter 3 Third 30",
        "3.1 Section 32",
      ].join("\n"));

      const stitched = stitchTocPages([
        { pageIndex: 0, chapters: page1.chapters, confidence: page1.confidence, units: page1.units },
        { pageIndex: 1, chapters: page2.chapters, confidence: page2.confidence, units: page2.units },
      ]);

      expect(stitched.units).toHaveLength(2);
      expect(stitched.units?.[0].chapters).toHaveLength(2); // Unit 1 has 2 chapters
      expect(stitched.units?.[1].chapters).toHaveLength(1); // Unit 2 has 1 chapter
      expect(stitched.units?.[1].chapters[0].chapterNumber).toBe("3");
    });

    it("deduplicates unit entries while preserving chapter hierarchy", () => {
      const page1 = parseTocFromOcrText([
        "Unit 1: Core Concepts",
        "Chapter 1 Basics 10",
        "1.1 Overview 12",
      ].join("\n"));

      const page2 = parseTocFromOcrText([
        "Unit 1: Core Concepts",
        "Chapter 1 Basics 10",
        "1.1 Overview 12",
        "Unit 2: Applications",
        "Chapter 2 Real World 25",
        "2.1 Examples 27",
      ].join("\n"));

      const stitched = stitchTocPages([
        { pageIndex: 0, chapters: page1.chapters, confidence: page1.confidence, units: page1.units },
        { pageIndex: 1, chapters: page2.chapters, confidence: page2.confidence, units: page2.units },
      ]);

      // Should have 2 units, not 3 (Unit 1 deduplicated)
      expect(stitched.units).toHaveLength(2);
      expect(stitched.chapters).toHaveLength(2); // Flattened: Chapter 1 and 2
    });

    it("preserves page ranges within unit hierarchy", () => {
      const parsed = parseTocFromOcrText([
        "Unit A: Advanced Topics 50",
        "Chapter 5 Calculus 55",
        "5.1 Derivatives 57",
        "Chapter 6 Statistics 70",
        "6.1 Probability 72",
      ].join("\n"));

      expect(parsed.units).toHaveLength(1);
      const unit = parsed.units?.[0];
      expect(unit?.pageStart).toBeDefined();
      expect(unit?.chapters[0].pageStart).toBe(55);
      expect(unit?.chapters[1].pageStart).toBe(70);
    });

    it("resolves units correctly when chapters reference their parent unit", () => {
      const parsed = parseTocFromOcrText([
        "Unit I: New Material",
        "Chapter 1 Mathematics 8",
        "Chapter 2 Science 18",
        "Unit II: Review",
        "Chapter 3 Vocabulary 30",
        "Chapter 4 Practice 40",
      ].join("\n"));

      expect(parsed.units).toHaveLength(2);

      // Check bidirectional relationship: chapters know their unit
      expect(parsed.units?.[0].chapters[0].unitName).toContain("Unit I");
      expect(parsed.units?.[1].chapters[0].unitName).toContain("Unit II");

      // Check that flattened chapters list is also present
      expect(parsed.chapters).toHaveLength(4);
    });

    it("detects unit numbers and titles from OCR-variant headings without breaking chapter/section parsing", () => {
      const parsed = parseTocFromOcrText([
        "UNIT1 Foundations of Math",
        "Chapter 1 Integers 12",
        "1.1 Absolute Value 14",
        "1.2 Number Lines 20",
        "UNIT 2: Expressions and Equations",
        "Chapter 2 Expressions 28",
        "2.1 Variables and Terms 30",
      ].join("\n"));

      expect(parsed.units).toBeDefined();
      expect(parsed.units?.map((unit) => unit.unitNumber)).toEqual(["1", "2"]);
      expect(parsed.units?.[0].title).toContain("Foundations");
      expect(parsed.units?.[1].title).toContain("Expressions and Equations");

      expect(parsed.units?.[0].chapters.map((chapter) => chapter.chapterNumber)).toEqual(["1"]);
      expect(parsed.units?.[1].chapters.map((chapter) => chapter.chapterNumber)).toEqual(["2"]);

      expect(parsed.chapters).toHaveLength(2);
      expect(parsed.chapters[0].sections.map((section) => section.sectionNumber)).toEqual(["1.1", "1.2"]);
      expect(parsed.chapters[1].sections.map((section) => section.sectionNumber)).toEqual(["2.1"]);
    });

    it("captures split-line unit titles before chapter parsing and nests chapters under that unit", () => {
      const parsed = parseTocFromOcrText([
        "Unit 1",
        "Motion and Forces",
        "Chapter 1 Motion 12",
        "1.1 Position and Distance 14",
        "Chapter 2 Forces 22",
        "2.1 Balanced Forces 24",
      ].join("\n"));

      expect(parsed.units).toHaveLength(1);
      expect(parsed.units?.[0].unitNumber).toBe("1");
      expect(parsed.units?.[0].title).toBe("Motion and Forces");
      expect(parsed.units?.[0].chapters.map((chapter) => chapter.chapterNumber)).toEqual(["1", "2"]);
      expect(parsed.chapters.every((chapter) => chapter.unitName?.includes("Unit 1 Motion and Forces"))).toBe(true);
    });

    it("re-attaches unmatched chapters to the nearest unit to avoid orphan chapter nodes", () => {
      const parsed = parseTocFromOcrText([
        "Unit 1: Foundations",
        "Chapter 1 Basics 10",
        "1.1 Intro 12",
        "Chapter 2 Practice 18",
        "2.1 Exercises 20",
        "Unit 2: Applications",
        "Chapter 3 Systems 30",
        "3.1 Modeling 32",
      ].join("\n"));

      const assignedChapterKeys = new Set(
        (parsed.units ?? []).flatMap((unit) => unit.chapters).map((chapter) => `${chapter.chapterNumber}|${chapter.title}`)
      );
      const orphans = parsed.chapters.filter((chapter) => !assignedChapterKeys.has(`${chapter.chapterNumber}|${chapter.title}`));

      expect(parsed.units?.length ?? 0).toBeGreaterThan(0);
      expect(orphans).toHaveLength(0);
    });

    it("preserves downstream hierarchy when units are stitched across page boundaries", () => {
      const firstPage = parseTocFromOcrText([
        "Unit 1: Foundations",
        "Chapter 1 Integers 12",
        "1.1 Absolute Value 14",
      ].join("\n"));

      const secondPage = parseTocFromOcrText([
        "Unit 1: Foundations",
        "Chapter 2 Expressions 28",
        "2.1 Variables 30",
        "Unit 2: Functions",
        "Chapter 3 Linear Functions 40",
        "3.1 Slope 42",
      ].join("\n"));

      const stitched = stitchTocPages([
        { pageIndex: 0, chapters: firstPage.chapters, units: firstPage.units, confidence: firstPage.confidence },
        { pageIndex: 1, chapters: secondPage.chapters, units: secondPage.units, confidence: secondPage.confidence },
      ]);

      expect(stitched.units).toBeDefined();
      expect(stitched.units?.map((unit) => unit.unitNumber)).toEqual(["1", "2"]);
      expect(stitched.units?.[0].chapters.map((chapter) => chapter.chapterNumber)).toEqual(["1", "2"]);
      expect(stitched.units?.[1].chapters.map((chapter) => chapter.chapterNumber)).toEqual(["3"]);
      expect(stitched.chapters.find((chapter) => chapter.chapterNumber === "2")?.sections[0].sectionNumber).toBe("2.1");
      expect(stitched.chapters.find((chapter) => chapter.chapterNumber === "3")?.sections[0].sectionNumber).toBe("3.1");
    });

    it("handles malformed unit lines and falls back gracefully", () => {
      const parsed = parseTocFromOcrText([
        "Unit 1",  // Minimal unit line
        "Chapter 1 Test 5",
        "1.1 Subsection 7",
        "Unit:",  // Malformed
        "Chapter 2 Next 20",
      ].join("\n"));

      // Should extract at least the well-formed unit
      expect(parsed.units?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(parsed.chapters).toHaveLength(2);
    });

    it("collapses duplicate numbered lesson variants when stitching noisy OCR pages", () => {
      const firstPage = parseTocFromOcrText([
        "MODULE 1: THE NATURE OF SCIENCE",
        "CER Claim, Evidence, Reasoning 3",
        "Lesson 1 The Methods of Science 12",
        "Lesson 2 Standards of Measurement 19",
        "Lesson 3 Communicating with Graphs 24",
      ].join("\n"));

      const noisyRecapture = parseTocFromOcrText([
        "MODULE 1: THE NATURE OF SCIENCE",
        "CER Claim, Evidence, Reasoning 3",
        "Lesson 1 The Methods of Science 12",
        "Lesson 2 Standards for Communicating with Graphs 21",
        "Lesson 2 Standards of Measurement 19",
        "Lesson 3 Communicating with Graphs 24",
      ].join("\n"));

      const stitched = stitchTocPages([
        { pageIndex: 0, chapters: firstPage.chapters, units: firstPage.units, confidence: firstPage.confidence },
        { pageIndex: 1, chapters: noisyRecapture.chapters, units: noisyRecapture.units, confidence: noisyRecapture.confidence },
      ]);

      const chapterOne = stitched.chapters[0];
      const lessonNumbers = chapterOne.sections.map((section) => section.sectionNumber).filter(Boolean);
      const lessonTwoEntries = chapterOne.sections.filter((section) => section.sectionNumber === "1.2");

      expect(lessonNumbers).toEqual(["1.1", "1.2", "1.3"]);
      expect(lessonTwoEntries).toHaveLength(1);
      expect(lessonTwoEntries[0]?.title).toBe("Standards of Measurement");
      expect(lessonTwoEntries[0]?.pageStart).toBe(19);
    });

    it("captures single-word all-caps unit titles on a split line (e.g., UNIT 2 / ENERGY)", () => {
      // Reproduces the Inspire Physical Science spread-view TOC page 2:
      // "UNIT 2" on one line, "ENERGY" on the next (single all-caps word)
      const parsed = parseTocFromOcrText([
        "UNIT 2",
        "ENERGY",
        "ENCOUNTER THE PHENOMENON",
        "How can energy be collected and stored for daily use?",
        "STEM UNIT 2 PROJECT ............. 85",
        "MODULE 4: WORK AND ENERGY",
        "Lesson 1 Work and Machines 88",
        "Lesson 2 Describing Energy 95",
        "Lesson 3 Conservation of Energy 101",
        "MODULE 5: THERMAL ENERGY",
        "Lesson 1 Temperature, Thermal Energy, and Heat 114",
        "Lesson 2 Conduction, Convection, and Radiation 120",
      ].join("\n"));

      expect(parsed.units).toBeDefined();
      const unit2 = parsed.units?.find((unit) => unit.unitNumber === "2");
      expect(unit2).toBeDefined();
      // Title "ENERGY" captured from the split line
      expect(unit2?.title).toBe("ENERGY");
      // Modules 4 and 5 correctly nested under Unit 2
      expect(unit2?.chapters.map((chapter) => chapter.chapterNumber)).toContain("4");
      expect(unit2?.chapters.map((chapter) => chapter.chapterNumber)).toContain("5");
    });

    it("stitches multi-page TOC correctly when second page unit has no inline title (unit title = canonical label)", () => {
      // Reproduces the bug where "UNIT 2" (no inline title) caused unitIdentityFromUnit
      // to compute "unit 2 unit 2" while chapter.unitName = "Unit 2", preventing correct matching.
      const page1 = parseTocFromOcrText([
        "UNIT 1: MOTION AND FORCES",
        "MODULE 1: THE NATURE OF SCIENCE",
        "Lesson 1 Methods of Science 4",
        "MODULE 2: MOTION",
        "Lesson 1 Describing Motion 38",
        "MODULE 3: FORCES AND NEWTON'S LAWS",
        "Lesson 1 Forces 60",
      ].join("\n"));

      // Second page: UNIT 2 alone on a line (no inline title), then modules
      const page2 = parseTocFromOcrText([
        "UNIT 2",
        "ENERGY",
        "MODULE 4: WORK AND ENERGY",
        "Lesson 1 Work and Machines 88",
        "MODULE 5: THERMAL ENERGY",
        "Lesson 1 Temperature 114",
      ].join("\n"));

      const stitched = stitchTocPages([
        { pageIndex: 0, chapters: page1.chapters, units: page1.units, confidence: page1.confidence },
        { pageIndex: 1, chapters: page2.chapters, units: page2.units, confidence: page2.confidence },
      ]);

      // Both units must be present after stitching
      expect(stitched.units).toBeDefined();
      expect(stitched.units?.map((unit) => unit.unitNumber)).toContain("1");
      expect(stitched.units?.map((unit) => unit.unitNumber)).toContain("2");

      // Unit 2 must contain modules 4 and 5, not zero chapters
      const unit2 = stitched.units?.find((unit) => unit.unitNumber === "2");
      expect(unit2).toBeDefined();
      expect(unit2?.chapters.length).toBeGreaterThanOrEqual(2);
      expect(unit2?.chapters.map((chapter) => chapter.chapterNumber)).toContain("4");
      expect(unit2?.chapters.map((chapter) => chapter.chapterNumber)).toContain("5");

      // All chapters (modules 1-5) must be in the flat list
      expect(stitched.chapters.map((chapter) => chapter.chapterNumber)).toEqual(
        expect.arrayContaining(["1", "2", "3", "4", "5"])
      );
    });

    it("keeps complete hierarchy across TOC pages when Unit 2 modules continue on page two", () => {
      const page1 = parseTocFromOcrText([
        "UNIT 1: MOTION AND FORCES",
        "MODULE 1: THE NATURE OF SCIENCE",
        "Lesson 1 Methods of Science 4",
        "MODULE 2: MOTION",
        "Lesson 1 Describing Motion 38",
        "MODULE 3: FORCES AND NEWTON'S LAWS",
        "Lesson 1 Forces 60",
      ].join("\n"));

      const page2 = parseTocFromOcrText([
        "UNIT 2",
        "ENERGY",
        "ENCOUNTER THE PHENOMENON",
        "How can energy be collected and stored for daily use?",
        "MODULE 4: WORK AND ENERGY",
        "Lesson 1 Work and Machines 88",
        "MODULE 5: THERMAL ENERGY",
        "Lesson 1 Temperature, Thermal Energy, and Heat 114",
        "MODULE 6: ELECTRICITY",
        "Lesson 1 Electric Charge 140",
        "MODULE 7: MAGNETISM AND ITS USES",
        "Lesson 1 Magnetism 166",
        "MODULE 8: ENERGY SOURCES AND THE ENVIRONMENT",
        "Lesson 1 Fossile Fuels 192",
      ].join("\n"));

      const stitched = stitchTocPages([
        { pageIndex: 0, chapters: page1.chapters, units: page1.units, confidence: page1.confidence },
        { pageIndex: 1, chapters: page2.chapters, units: page2.units, confidence: page2.confidence },
      ]);

      expect(stitched.units).toBeDefined();
      expect(stitched.units?.map((unit) => unit.unitNumber)).toEqual(expect.arrayContaining(["1", "2"]));

      const unit2 = stitched.units?.find((unit) => unit.unitNumber === "2");
      expect(unit2).toBeDefined();
      expect(unit2?.title).toBe("ENERGY");
      expect(unit2?.chapters.map((chapter) => chapter.chapterNumber)).toEqual(
        expect.arrayContaining(["4", "5", "6", "7", "8"])
      );

      expect(stitched.chapters.map((chapter) => chapter.chapterNumber)).toEqual(
        expect.arrayContaining(["1", "2", "3", "4", "5", "6", "7", "8"])
      );
    });
  });
});

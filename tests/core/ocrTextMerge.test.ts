import { describe, expect, it } from "vitest";

import { parseTocFromOcrText } from "../../src/core/services/textbookAutoExtractionService";
import { mergeOcrTextWithOverlap } from "../../src/webapp/utils/ocrTextMerge";

describe("mergeOcrTextWithOverlap", () => {
  it("returns incoming text when existing text is empty", () => {
    const result = mergeOcrTextWithOverlap("", "Line A\nLine B\nLine C");
    expect(result).toBe("Line A\nLine B\nLine C");
  });

  it("returns existing text when incoming text is empty", () => {
    const result = mergeOcrTextWithOverlap("Line A\nLine B", "");
    expect(result).toBe("Line A\nLine B");
  });

  it("trims overlapping lines from the incoming shot", () => {
    const existing = [
      "ISBN 978-0-00-000000-0",
      "Copyright 2026",
      "All rights reserved",
      "Printed in USA",
    ].join("\n");

    const incoming = [
      "All rights reserved",
      "Printed in USA",
      "Publisher: Example Press",
      "www.example.com",
    ].join("\n");

    const result = mergeOcrTextWithOverlap(existing, incoming);
    expect(result).toBe([
      "ISBN 978-0-00-000000-0",
      "Copyright 2026",
      "All rights reserved",
      "Printed in USA",
      "Publisher: Example Press",
      "www.example.com",
    ].join("\n"));
  });

  it("handles whitespace and case differences in overlap", () => {
    const existing = "McGraw Hill\nSTEM Learning Solutions Center\nColumbus, OH";
    const incoming = "  stem learning solutions center\ncolumbus, oh\nUnited States";

    const result = mergeOcrTextWithOverlap(existing, incoming);
    expect(result).toBe("McGraw Hill\nSTEM Learning Solutions Center\nColumbus, OH\nUnited States");
  });

  it("removes OCR garbage while merging overlapping TOC captures", () => {
    const topHalf = [
      "Teacher Edition: The Nature of Science C=)",
      "i= { 120f1088 > £2 « 8",
      "MODULE 1: THE NATURE OF SCIENCE",
      "CER Claim, Evidence, Reasoning 3",
      "Lesson 1 The Methods of Science 4",
      "Lesson 2 Standards of Measurement ovine 12",
      "Lesson 3 Communicating with Graphs 19",
      "Lesson 4 Science and Technology 24",
      "MODULE 2: MOTION",
      "CER Claim, Evidence, Reasoning 37",
      "Lesson 1 Describing Motion 38",
      "Lesson 2 Velocity and Momentum 45",
      "Lesson 3 ACCeleration .............oiriinriiisicinissisinsisssssvnies 50",
    ].join("\n");

    const bottomHalf = [
      "MODULE 2: MOTION",
      "CER Claim, Evidence, Reasoning 37",
      "Lesson 1 Describing Motion 38",
      "Lesson 2 Velocity and Momentum....... eo) 45 XN",
      "Lesson 3 ACCeleration 50 Ne",
      "ENGINEERING & TECHNOLOGY",
      "Autonemous Vehicles Go Subterranean... 55",
      "Module WEap-UD ........c cocoons. D7",
      "GO FURTHER Data Analysis Lab ............ccccooooiceirioi 57",
      "MODULE 3: FORCES AND NEWTON'S LAWS",
      "CER Claim, Evidence, Reasoning 59",
      "Lesson 1 Forces 60",
      "Lesson 2 Newton's Laws of Motion... 68",
      "Lesson 3 Using Newton's Laws... 74",
    ].join("\n");

    const merged = mergeOcrTextWithOverlap(topHalf, bottomHalf);

    expect(merged).toContain("MODULE 3: FORCES AND NEWTON'S LAWS");
    expect(merged).toContain("Lesson 2 Newton's Laws of Motion");
    expect(merged).toContain("Autonemous Vehicles Go Subterranean");
    expect(merged).not.toContain("120f1088");
    expect(merged).not.toContain("£2");
    expect(merged).not.toContain("oiriinriiisicinissisinsisssssvnies");
  });

  it("keeps high-confidence TOC structure after noisy overlap merge", () => {
    const existing = [
      "MODULE 1: THE NATURE OF SCIENCE",
      "CER Claim, Evidence, Reasoning 3",
      "Lesson 1 The Methods of Science 4",
      "Lesson 2 Standards of Measurement 12",
      "Lesson 3 Communicating with Graphs 19",
      "MODULE 2: MOTION",
      "CER Claim, Evidence, Reasoning 37",
      "Lesson 1 Describing Motion 38",
      "Lesson 2 Velocity and Momentum 45",
      "Lesson 3 Acceleration 50",
      "i= { 120f1088 > £2 « 8",
    ].join("\n");

    const incoming = [
      "MODULE 2: MOTION",
      "CER Claim, Evidence, Reasoning 37",
      "Lesson 1 Describing Motion 38",
      "Lesson 2 Velocity and Momentum 45",
      "Lesson 3 Acceleration 50",
      "Autonomous Vehicles Go Subterranean 55",
      "Module Wrap-Up 57",
      "SEP Go Further Data Analysis Lab 57",
      "MODULE 3: FORCES AND NEWTON'S LAWS",
      "CER Claim, Evidence, Reasoning 59",
      "Lesson 1 Forces 60",
      "Lesson 2 Newton's Laws of Motion 68",
      "Lesson 3 Using Newton's Laws 74",
    ].join("\n");

    const merged = mergeOcrTextWithOverlap(existing, incoming);
    const parsed = parseTocFromOcrText(merged);

    expect(parsed.confidence).toBeGreaterThanOrEqual(0.9);
    expect(parsed.chapters.some((chapter) => /NATURE OF SCIENCE/i.test(chapter.title))).toBe(true);
    expect(parsed.chapters.some((chapter) => /MOTION/i.test(chapter.title))).toBe(true);
    expect(parsed.chapters.some((chapter) => /FORCES AND NEWTON'S LAWS/i.test(chapter.title))).toBe(true);
    expect(parsed.chapters.flatMap((chapter) => chapter.sections).some((section) => /Using Newton's Laws/i.test(section.title))).toBe(true);
  });
});

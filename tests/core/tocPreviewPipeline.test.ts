import { describe, expect, it } from "vitest";

import { parseTocFromOcrText } from "../../src/core/services/textbookAutoExtractionService";
import { buildTocPreviewTree } from "../../src/webapp/components/textbooks/tocPreview/PageRangeCalculator";

const REALISTIC_TOC_OCR = [
  "INTRODUCTION TO PHYSICAL SCIENCE",
  "MODULE 1: THE NATURE OF SCIENCE",
  "CER Claim, Evidence, Reasoning 3",
  "Lesson 1 The Methods of Science 4",
  "Lesson 2 Standards of Measurement 12",
  "Lesson 3 Communicating with Graphs 19",
  "Lesson 4 Science and Technology 24",
  "NATURE OF SCIENCE 31",
  "Module Wrap-Up 33",
  "MODULE 2: MOTION",
  "CER Claim, Evidence, Reasoning 37",
  "Lesson 1 Describing Motion 38",
  "Lesson 2 Velocity and Momentum 45",
  "Lesson 3 Acceleration 50",
  "Module Wrap-Up 57",
  "MODULE 3: FORCES AND NEWTON'S LAWS",
  "CER Claim, Evidence, Reasoning 59",
  "Lesson 1 Forces 60",
  "Lesson 2 Newton's Laws of Motion 68",
  "Lesson 3 Using Newton's Laws 74",
].join("\n");

describe("TOC preview pipeline", () => {
  it("parses module/lesson OCR and builds hierarchical page ranges", () => {
    const parsed = parseTocFromOcrText(REALISTIC_TOC_OCR);

    expect(parsed.chapters.length).toBeGreaterThanOrEqual(3);
    expect(parsed.chapters[0].chapterNumber).toBe("1");
    expect(parsed.chapters[0].chapterLabel).toBe("Module");
    expect(parsed.chapters[0].title).toContain("NATURE OF SCIENCE");
    expect(parsed.chapters[0].pageStart).toBe(3);
    expect(parsed.chapters[1].pageStart).toBe(37);

    expect(parsed.chapters[0].sections.some((section) => section.title.includes("Methods of Science"))).toBe(true);
    expect(parsed.chapters[0].sections.some((section) => section.title.includes("Standards of Measurement"))).toBe(true);
    expect(parsed.chapters[0].sections.some((section) => section.title.includes("Communicating with Graphs"))).toBe(true);
    const ancillarySection = parsed.chapters[0].sections.find((section) => section.title.includes("Module Wrap-Up"));
    expect(ancillarySection).toBeDefined();
    expect(ancillarySection?.sectionNumber).toBe("");

    const preview = buildTocPreviewTree(parsed.chapters, parsed.confidence);
    expect(preview.chapterCount).toBeGreaterThanOrEqual(3);
    expect(preview.sectionCount).toBeGreaterThanOrEqual(8);

    const chapterOne = preview.nodes[0];
    expect(chapterOne.pageStart).toBe(3);
    expect(chapterOne.pageEnd).toBe(36);
    expect(chapterOne.pageRangeLabel).toBe("pp. 3-36");

    const lessonOne = chapterOne.children.find((child) => child.title.includes("Methods of Science"));
    expect(lessonOne).toBeDefined();
    expect(lessonOne?.pageStart).toBe(4);
    expect(lessonOne?.pageEnd).toBe(11);
    expect(lessonOne?.pageRangeLabel).toBe("pp. 4-11");

    const lessonThree = chapterOne.children.find((child) => child.title.includes("Communicating with Graphs"));
    expect(lessonThree).toBeDefined();
    expect(lessonThree?.pageStart).toBe(19);
    expect(lessonThree?.pageEnd).toBe(23);
  });

  it("treats unnumbered module sections as valid and infers same-page boundaries", () => {
    const parsed = parseTocFromOcrText([
      "MODULE 1: THE NATURE OF SCIENCE",
      "CER Claim, Evidence, Reasoning 3",
      "Lesson 1 The Methods of Science 4",
      "NATURE OF SCIENCE 31",
      "Module Wrap-Up 33",
      "SEP 33",
      "MODULE 2: MOTION 37",
    ].join("\n"));

    const preview = buildTocPreviewTree(parsed.chapters, parsed.confidence);
    const chapterOne = preview.nodes[0];
    expect(chapterOne).toBeDefined();

    const cer = chapterOne.children.find((child) => /CER Claim, Evidence, Reasoning/i.test(child.title));
    expect(cer).toBeDefined();
    expect(cer?.missingFields).not.toContain("number");
    expect(cer?.pageStart).toBe(3);
    expect(cer?.pageEnd).toBe(3);

    const scientificMethods = chapterOne.children.find((child) => /NATURE OF SCIENCE/i.test(child.title));
    expect(scientificMethods).toBeDefined();
    expect(scientificMethods?.missingFields).not.toContain("number");
    expect(scientificMethods?.pageStart).toBe(31);
    expect(scientificMethods?.pageEnd).toBe(32);

    const moduleWrapUp = chapterOne.children.find((child) => /Module Wrap-Up/i.test(child.title));
    expect(moduleWrapUp).toBeDefined();
    expect(moduleWrapUp?.missingFields).not.toContain("number");
    expect(moduleWrapUp?.pageStart).toBe(33);
    expect(moduleWrapUp?.pageEnd).toBe(33);
  });

  it("normalizes OCR-misread CER labels from C1T1 in TOC lines", () => {
    const parsed = parseTocFromOcrText([
      "MODULE 1: THE NATURE OF SCIENCE",
      "C1T1 Claim, Evidence, Reasoning 3",
      "Lesson 1 The Methods of Science 4",
      "MODULE 2: MOTION 37",
    ].join("\n"));

    const chapterOne = parsed.chapters[0];
    expect(chapterOne).toBeDefined();
    const cer = chapterOne.sections.find((section) => /Claim, Evidence, Reasoning/i.test(section.title));
    expect(cer).toBeDefined();
    expect(cer?.title).toContain("CER Claim, Evidence, Reasoning");
    expect(cer?.title).not.toContain("C1T1");
  });

  it("restores missing CER and SEP prefixes for canonical ancillary sections", () => {
    const parsed = parseTocFromOcrText([
      "MODULE 1: THE NATURE OF SCIENCE",
      "Claim, Evidence, Reasoning 3",
      "Scientific Methods 31",
      "Go Further Data Analysis Lab 37",
      "MODULE 2: MOTION 38",
    ].join("\n"));

    const chapterOne = parsed.chapters[0];
    expect(chapterOne).toBeDefined();

    const cer = chapterOne.sections.find((section) => /Claim, Evidence, Reasoning/i.test(section.title));
    expect(cer).toBeDefined();
    expect(cer?.title).toBe("CER Claim, Evidence, Reasoning");

    const sep = chapterOne.sections.find((section) => /Go Further Data Analysis Lab/i.test(section.title));
    expect(sep).toBeDefined();
    expect(sep?.title).toBe("SEP Go Further Data Analysis Lab");
  });
});

import { describe, expect, it } from "vitest";

import { inferTocPageRanges, type TocChapter } from "../../src/core/services/textbookAutoExtractionService";

describe("TOC inference rules", () => {
  it("false-positive guard: does not infer an end page when next boundary is stale or lower", () => {
    const input: TocChapter[] = [
      {
        chapterNumber: "4",
        title: "Waves",
        pageStart: 80,
        sections: [
          { sectionNumber: "4.1", title: "Intro", pageStart: 85 },
          { sectionNumber: "4.2", title: "Refraction", pageStart: 70 },
        ],
      },
    ];

    const inferred = inferTocPageRanges(input);
    expect(inferred[0].sections[0].pageEnd).toBeUndefined();
  });

  it("false-negative guard: infers end page when a valid next section boundary exists", () => {
    const input: TocChapter[] = [
      {
        chapterNumber: "5",
        title: "Electricity",
        pageStart: 100,
        sections: [
          { sectionNumber: "5.1", title: "Charge", pageStart: 101 },
          { sectionNumber: "5.2", title: "Current", pageStart: 110 },
        ],
      },
    ];

    const inferred = inferTocPageRanges(input);
    expect(inferred[0].sections[0].pageEnd).toBe(109);
  });

  it("infers section end as next section start minus one", () => {
    const input: TocChapter[] = [
      {
        chapterNumber: "1",
        title: "Motion",
        pageStart: 20,
        sections: [
          { sectionNumber: "1.1", title: "Speed", pageStart: 20 },
          { sectionNumber: "1.2", title: "Acceleration", pageStart: 31 },
        ],
      },
    ];

    const inferred = inferTocPageRanges(input);
    expect(inferred[0].sections[0].pageEnd).toBe(30);
    expect(inferred[0].sections[1].pageEnd).toBeUndefined();
  });

  it("infers last section end from next chapter start", () => {
    const input: TocChapter[] = [
      {
        chapterNumber: "1",
        title: "Matter",
        pageStart: 10,
        sections: [
          { sectionNumber: "1.1", title: "Atoms", pageStart: 10 },
          { sectionNumber: "1.2", title: "Elements", pageStart: 18 },
        ],
      },
      {
        chapterNumber: "2",
        title: "Energy",
        pageStart: 31,
        sections: [{ sectionNumber: "2.1", title: "Kinetic", pageStart: 31 }],
      },
    ];

    const inferred = inferTocPageRanges(input);
    expect(inferred[0].sections[1].pageEnd).toBe(30);
    expect(inferred[0].pageEnd).toBe(30);
  });

  it("keeps end page unknown when no later boundary exists", () => {
    const input: TocChapter[] = [
      {
        chapterNumber: "7",
        title: "Final Unit",
        pageStart: 200,
        sections: [{ sectionNumber: "7.1", title: "Capstone", pageStart: 200 }],
      },
    ];

    const inferred = inferTocPageRanges(input);
    expect(inferred[0].sections[0].pageEnd).toBeUndefined();
    expect(inferred[0].pageEnd).toBe(200);
  });

  it("infers missing section starts from neighboring section boundaries", () => {
    const input: TocChapter[] = [
      {
        chapterNumber: "3",
        title: "Forces",
        pageStart: 60,
        sections: [
          { sectionNumber: "3.1", title: "Balanced", pageStart: 60 },
          { sectionNumber: "3.2", title: "Unbalanced" },
          { sectionNumber: "3.3", title: "Friction", pageStart: 66 },
        ],
      },
    ];

    const inferred = inferTocPageRanges(input);
    expect(inferred[0].sections[1].pageStart).toBe(61);
    expect(inferred[0].sections[1].pageEnd).toBe(65);
  });

  it("treats a CER section before the first lesson as a single-page pre-chapter section (OCR order)", () => {
    const input: TocChapter[] = [
      {
        chapterNumber: "1",
        title: "THE NATURE OF SCIENCE",
        sections: [
          { sectionNumber: "", title: "CER Claim, Evidence, Reasoning", pageStart: 3 },
          { sectionNumber: "1.1", title: "The Methods of Science", pageStart: 4 },
          { sectionNumber: "1.2", title: "Standards of Measurement", pageStart: 12 },
          { sectionNumber: "1.3", title: "Communicating with Graphs", pageStart: 19 },
          { sectionNumber: "1.4", title: "Science and Technology", pageStart: 24 },
          { sectionNumber: "", title: "Scientific Methods", pageStart: 31 },
          { sectionNumber: "", title: "Module Wrap-Up", pageStart: 33 },
        ],
      },
      {
        chapterNumber: "2",
        title: "MOTION",
        pageStart: 37,
        sections: [{ sectionNumber: "2.1", title: "Describing Motion", pageStart: 38 }],
      },
    ];

    const inferred = inferTocPageRanges(input);
    const cer = inferred[0].sections[0];
    expect(cer.pageEnd).toBe(3);
    const lesson4 = inferred[0].sections.find((s) => s.sectionNumber === "1.4");
    expect(lesson4?.pageEnd).toBe(30);
    const sciMethods = inferred[0].sections.find((s) => s.title.includes("Scientific Methods"));
    expect(sciMethods?.pageEnd).toBe(32);
    const wrapUp = inferred[0].sections.find((s) => s.title.includes("Module Wrap-Up"));
    expect(wrapUp?.pageEnd).toBe(36);
  });

  it("treats a CER section before the first lesson as a single-page pre-chapter section (stitched sort order)", () => {
    // Simulates the post-stitchTocPages order where numbered sections come first
    // and unnumbered sections are sorted after, causing CER (p.3) to appear in the
    // array after Lesson 1.4 (p.24).
    const input: TocChapter[] = [
      {
        chapterNumber: "1",
        title: "THE NATURE OF SCIENCE",
        sections: [
          { sectionNumber: "1.1", title: "The Methods of Science", pageStart: 4 },
          { sectionNumber: "1.2", title: "Standards of Measurement", pageStart: 12 },
          { sectionNumber: "1.3", title: "Communicating with Graphs", pageStart: 19 },
          { sectionNumber: "1.4", title: "Science and Technology", pageStart: 24 },
          { sectionNumber: "", title: "CER Claim, Evidence, Reasoning", pageStart: 3 },
          { sectionNumber: "", title: "Scientific Methods", pageStart: 31 },
          { sectionNumber: "", title: "Module Wrap-Up", pageStart: 33 },
        ],
      },
      {
        chapterNumber: "2",
        title: "MOTION",
        pageStart: 37,
        sections: [{ sectionNumber: "2.1", title: "Describing Motion", pageStart: 38 }],
      },
    ];

    const inferred = inferTocPageRanges(input);
    // CER pre-chapter: must be single-page regardless of array position
    const cer = inferred[0].sections.find((s) => s.title.includes("CER"));
    expect(cer?.pageEnd).toBe(3);
    // Lesson 1.4 must end at 30 (Scientific Methods starts at 31)
    const lesson4 = inferred[0].sections.find((s) => s.sectionNumber === "1.4");
    expect(lesson4?.pageEnd).toBe(30);
    // Post-chapter unnumbered sections infer normally
    const sciMethods = inferred[0].sections.find((s) => s.title.includes("Scientific Methods"));
    expect(sciMethods?.pageEnd).toBe(32);
    const wrapUp = inferred[0].sections.find((s) => s.title.includes("Module Wrap-Up"));
    expect(wrapUp?.pageEnd).toBe(36);
  });

  it("ignores lower stale ancillary pages and uses the next greater additional-section boundary", () => {
    const input: TocChapter[] = [
      {
        chapterNumber: "3",
        title: "FORCES AND NEWTON'S LAWS",
        pageStart: 59,
        pageEnd: 86,
        sections: [
          { sectionNumber: "3.1", title: "Forces", pageStart: 60 },
          { sectionNumber: "3.2", title: "Newton's Laws of Motion", pageStart: 68 },
          { sectionNumber: "3.3", title: "Using Newton's Laws", pageStart: 74 },
          { sectionNumber: "", title: "STEM UNIT 1 PROJECT", pageStart: 35 },
          { sectionNumber: "", title: "CER Claim, Evidence, Reasoning", pageStart: 59 },
          { sectionNumber: "", title: "Extreme Altitudes", pageStart: 81 },
          { sectionNumber: "", title: "Module Wrap-Up", pageStart: 83 },
        ],
      },
    ];

    const inferred = inferTocPageRanges(input);
    expect(inferred[0].sections[2].pageEnd).toBe(80);
  });
});

import { describe, expect, it } from "vitest";

import { inferTocPageRanges, type TocChapter } from "../../src/core/services/textbookAutoExtractionService";

describe("TOC inference rules", () => {
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
});

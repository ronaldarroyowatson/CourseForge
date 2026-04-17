import { describe, expect, it } from "vitest";

import { buildTocPreviewTree } from "../../src/webapp/components/textbooks/tocPreview/PageRangeCalculator";

describe("PageRangeCalculator", () => {
  it("builds chapter and section ranges from sibling starts", () => {
    const result = buildTocPreviewTree([
      {
        chapterNumber: "1",
        title: "Matter",
        pageStart: 5,
        sections: [
          { sectionNumber: "1.1", title: "Atoms", pageStart: 6 },
          { sectionNumber: "1.2", title: "Molecules", pageStart: 10 },
        ],
      },
      {
        chapterNumber: "2",
        title: "Energy",
        pageStart: 20,
        sections: [{ sectionNumber: "2.1", title: "Heat", pageStart: 21 }],
      },
    ], 0.9);

    expect(result.chapterCount).toBe(2);
    expect(result.sectionCount).toBe(3);
    expect(result.nodes[0].pageRangeLabel).toBe("pp. 5-19");
    expect(result.nodes[0].children[0].pageRangeLabel).toBe("pp. 6-9");
  });

  it("creates synthetic parent section for orphan subsection", () => {
    const result = buildTocPreviewTree([
      {
        chapterNumber: "3",
        title: "Forces",
        sections: [{ sectionNumber: "3.2.1", title: "Nested", pageStart: 33 }],
      },
    ], 0.8);

    expect(result.nodes[0].children).toHaveLength(1);
    expect(result.nodes[0].children[0].title).toBe("Section title missing");
    expect(result.nodes[0].children[0].children[0].level).toBe("subsection");
  });

  it("normalizes invalid page starts and reports missing fields", () => {
    const result = buildTocPreviewTree([
      {
        chapterNumber: "",
        title: "",
        pageStart: -3,
        sections: [],
      },
    ], 0.95);

    expect(result.nodes[0].pageRangeLabel).toBe("p. ?");
    expect(result.nodes[0].missingFields).toEqual(expect.arrayContaining(["number", "title", "start page"]));
    expect(result.missingCount).toBeGreaterThan(0);
  });

  it("builds unit-based tree with nested chapter counts", () => {
    const chapters = [
      {
        chapterNumber: "1",
        title: "Intro",
        pageStart: 1,
        sections: [{ sectionNumber: "1.1", title: "Basics", pageStart: 2 }],
      },
    ];

    const units = [
      {
        unitNumber: "U1",
        title: "Unit One",
        pageStart: 1,
        chapters,
      },
    ];

    const result = buildTocPreviewTree(chapters, 0.9, units);

    expect(result.nodes[0].level).toBe("unit");
    expect(result.chapterCount).toBe(1);
    expect(result.sectionCount).toBe(1);
  });
});

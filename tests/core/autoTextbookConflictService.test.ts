import { describe, expect, it } from "vitest";

import { buildAutoConflictResolutionPlan } from "../../src/core/services/autoTextbookConflictService";
import type { TocChapter } from "../../src/core/services/textbookAutoExtractionService";

const AUTO_TOC: TocChapter[] = [
  {
    chapterNumber: "1",
    title: "Integers",
    sections: [
      { sectionNumber: "1.1", title: "Absolute Value" },
      { sectionNumber: "1.2", title: "Number Lines" },
    ],
  },
  {
    chapterNumber: "2",
    title: "Expressions",
    sections: [{ sectionNumber: "2.1", title: "Variables" }],
  },
];

describe("autoTextbookConflictService", () => {
  it("returns full delete-and-replace plan for overwrite mode", () => {
    const plan = buildAutoConflictResolutionPlan({
      mode: "overwrite_auto",
      autoTocChapters: AUTO_TOC,
      existingChapters: [
        { id: "ch-1", index: 1, name: "Integers" },
        { id: "ch-legacy", index: 9, name: "Legacy Chapter" },
      ],
      existingSectionsByChapterId: {
        "ch-1": [
          { id: "sec-1", chapterId: "ch-1", index: 1, title: "Absolute Value" },
          { id: "sec-legacy", chapterId: "ch-1", index: 7, title: "Legacy Section" },
        ],
        "ch-legacy": [{ id: "sec-2", chapterId: "ch-legacy", index: 1, title: "Old Intro" }],
      },
    });

    expect(plan.chapterIdsToDelete).toEqual(["ch-1", "ch-legacy"]);
    expect(plan.sectionIdsToDelete).toEqual(["sec-1", "sec-legacy", "sec-2"]);
    expect(plan.chapterUpserts).toHaveLength(2);
    expect(plan.chapterUpserts[0]?.existingChapterId).toBeUndefined();
    expect(plan.sectionUpserts).toHaveLength(3);
  });

  it("matches existing hierarchy and keeps unique manual differences in merge mode", () => {
    const plan = buildAutoConflictResolutionPlan({
      mode: "merge_dedupe",
      autoTocChapters: AUTO_TOC,
      existingChapters: [
        { id: "ch-1", index: 1, name: "Integers" },
        { id: "ch-manual", index: 8, name: "Teacher Appendix" },
      ],
      existingSectionsByChapterId: {
        "ch-1": [
          { id: "sec-1", chapterId: "ch-1", index: 1, title: "Absolute Value" },
          { id: "sec-manual", chapterId: "ch-1", index: 9, title: "Teacher Notes" },
        ],
        "ch-manual": [{ id: "sec-manual-2", chapterId: "ch-manual", index: 1, title: "Practice Pack" }],
      },
    });

    expect(plan.chapterIdsToDelete).toEqual([]);
    expect(plan.sectionIdsToDelete).toEqual([]);

    expect(plan.chapterUpserts).toHaveLength(2);
    expect(plan.chapterUpserts[0]?.existingChapterId).toBe("ch-1");
    expect(plan.chapterUpserts[1]?.existingChapterId).toBeUndefined();

    expect(plan.sectionUpserts).toHaveLength(3);
    expect(plan.sectionUpserts[0]?.existingSectionId).toBe("sec-1");
    expect(plan.sectionUpserts[1]?.existingSectionId).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import {
  cleanOcrTocLine,
  isTopLevelTocHeading,
  mergeTocTreeMapNodesWithStats,
  selectTocTreeMapLines,
  type TocTreeMapNode,
} from "../../src/core/services/tocTreeMapService";

function createNode(id: string, text: string): TocTreeMapNode {
  return {
    id,
    text,
    role: "ocr-line",
    level: 2,
    xRatio: 0.2,
    yRatio: 0.2,
    widthRatio: 0.5,
    heightRatio: 0.03,
  };
}

describe("tocTreeMapService", () => {
  it("reports added and duplicate counts for merged OCR lines", () => {
    const existing = [
      createNode("existing-1", "Module 1: The Nature of Science"),
      createNode("existing-2", "Module 2: Motion"),
    ];

    const incoming = [
      createNode("incoming-dup", "Module 2: Motion"),
      createNode("incoming-new", "Module 3: Forces and Newton's Laws"),
    ];

    const merged = mergeTocTreeMapNodesWithStats(existing, incoming);

    expect(merged.nodes).toHaveLength(3);
    expect(merged.incomingCount).toBe(2);
    expect(merged.addedCount).toBe(1);
    expect(merged.duplicateCount).toBe(1);
    expect(merged.totalCount).toBe(3);
  });

  it("marks addedCount as zero when all incoming nodes are already mapped", () => {
    const existing = [
      createNode("existing-1", "Module 5: Reactions"),
      createNode("existing-2", "Module 6: Applications of Chemistry"),
    ];

    const incoming = [
      createNode("incoming-1", "Module 5: Reactions"),
      createNode("incoming-2", "Module 6: Applications of Chemistry"),
    ];

    const merged = mergeTocTreeMapNodesWithStats(existing, incoming);

    expect(merged.nodes).toHaveLength(2);
    expect(merged.addedCount).toBe(0);
    expect(merged.duplicateCount).toBe(2);
    expect(merged.totalCount).toBe(2);
  });

  it("drops overflow nodes when the mapped target cap is reached", () => {
    const existing = Array.from({ length: 220 }, (_, index) =>
      createNode(`existing-${index}`, `Module ${index + 1}`)
    );
    const incoming = [
      createNode("incoming-1", "Module 221"),
      createNode("incoming-2", "Module 222"),
    ];

    const merged = mergeTocTreeMapNodesWithStats(existing, incoming);

    expect(merged.nodes).toHaveLength(220);
    expect(merged.addedCount).toBe(0);
    expect(merged.droppedByCapCount).toBeGreaterThanOrEqual(2);
  });

  it("normalizes special OCR navigation text", () => {
    expect(cleanOcrTocLine("Go To Current Location")).toBe("Table of Contents");
    expect(cleanOcrTocLine("contents x")).toBe("Contents");
  });

  it("detects top-level TOC headings", () => {
    expect(isTopLevelTocHeading("Module 21: Chemistry in Action")).toBe(true);
    expect(isTopLevelTocHeading("Chapter 9: Waves")).toBe(true);
    expect(isTopLevelTocHeading("Unit 4: Electricity")).toBe(true);
    expect(isTopLevelTocHeading("Lesson 9.1: Thermal Energy")).toBe(false);
  });

  it("prioritizes top-level headings before sub-level lines", () => {
    const ordered = selectTocTreeMapLines([
      "Lesson 20.1: Temperature",
      "Module 21: Chemistry in Action",
      "Lesson 20.2: Heat Transfer",
      "Chapter 22: Carbon and Life",
      "Section 20.3: Applications",
    ], 5);

    expect(ordered[0]).toBe("Module 21: Chemistry in Action");
    expect(ordered[1]).toBe("Chapter 22: Carbon and Life");
    expect(ordered).toHaveLength(5);
  });

  it("applies the requested cap after top-level prioritization", () => {
    const ordered = selectTocTreeMapLines([
      "Lesson 1.1: A",
      "Module 2: B",
      "Chapter 3: C",
      "Lesson 1.2: D",
    ], 2);

    expect(ordered).toEqual(["Module 2: B", "Chapter 3: C"]);
  });
});

import { describe, expect, it } from "vitest";

import { selectDscMasonryLayout } from "../../src/core/services/masonryLayoutService";

describe("masonryLayoutService", () => {
  it("uses a single-column adaptive layout on narrow widths", () => {
    const decision = selectDscMasonryLayout(640);

    expect(decision.engine).toBe("masonry");
    expect(decision.columnCount).toBe(1);
    expect(decision.placements.examples.columnSpan).toBe(1);
    expect(decision.placements.controls.columnSpan).toBe(1);
    expect(decision.adaptiveReflow).toBe(true);
  });

  it("prefers a two-panel masonry split on medium widths", () => {
    const decision = selectDscMasonryLayout(1080, { directionalFlow: "right-to-left" });

    expect(decision.columnCount).toBe(10);
    expect(decision.placements.examples.columnSpan).toBeGreaterThan(decision.placements.controls.columnSpan);
    expect(decision.directionalFlow).toBe("right-to-left");
    expect(decision.featureSet.dragAndDrop).toBe(true);
    expect(decision.featureSet.autoArrange).toBe(true);
  });

  it("scales spacing and columns up on wide layouts", () => {
    const decision = selectDscMasonryLayout(1500);

    expect(decision.columnCount).toBe(12);
    expect(decision.spacingToken).toBe(34);
    expect(decision.placements.examples.columnSpan).toBe(7);
    expect(decision.placements.controls.columnSpan).toBe(5);
    expect(decision.optionalFibonacciSpacing).toBe(true);
  });
});
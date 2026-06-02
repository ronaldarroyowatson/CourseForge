import { describe, expect, it } from "vitest";

import { computeHorizontalStitchLayout } from "../../src/webapp/utils/cueImageStitch";

describe("cueImageStitch", () => {
  it("computes horizontal stitch layout with overlap", () => {
    const layout = computeHorizontalStitchLayout(
      { width: 1200, height: 800 },
      { width: 1000, height: 800 },
      0.2,
    );

    expect(layout.targetHeight).toBe(800);
    expect(layout.firstWidth).toBe(1200);
    expect(layout.secondWidth).toBe(1000);
    expect(layout.overlapWidth).toBe(200);
    expect(layout.secondOffsetX).toBe(1000);
    expect(layout.canvasWidth).toBe(2000);
  });

  it("normalizes different image heights to a common target height", () => {
    const layout = computeHorizontalStitchLayout(
      { width: 1920, height: 1080 },
      { width: 1200, height: 1600 },
      0.1,
    );

    expect(layout.targetHeight).toBe(1080);
    expect(layout.firstWidth).toBe(1920);
    expect(layout.secondWidth).toBe(810);
    expect(layout.overlapWidth).toBe(81);
    expect(layout.secondOffsetX).toBe(1839);
    expect(layout.canvasWidth).toBe(2649);
  });

  it("clamps overlap ratio to safe bounds", () => {
    const negative = computeHorizontalStitchLayout(
      { width: 800, height: 800 },
      { width: 800, height: 800 },
      -3,
    );
    const extreme = computeHorizontalStitchLayout(
      { width: 800, height: 800 },
      { width: 800, height: 800 },
      9,
    );

    expect(negative.overlapWidth).toBe(0);
    expect(extreme.overlapWidth).toBe(360);
  });
});

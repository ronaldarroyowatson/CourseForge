import { describe, expect, it } from "vitest";

import {
  selectTwoCardLayout,
  selectThreeCardLayout,
  FIBONACCI_RATIOS,
} from "../../src/core/services/fibonacciLayoutService";

describe("fibonacciLayoutService — two-card layout selection", () => {
  it("selects 3:2 horizontal for normal width (800px)", () => {
    const decision = selectTwoCardLayout(800);
    expect(decision.ratio.name).toBe("3:2");
    expect(decision.mode).toBe("horizontal");
    expect(decision.exampleFlexGrow).toBe(3);
    expect(decision.controlsFlexGrow).toBe(2);
  });

  it("selects 5:3 horizontal for wide width (>=960px)", () => {
    const decision = selectTwoCardLayout(1024);
    expect(decision.ratio.name).toBe("5:3");
    expect(decision.mode).toBe("horizontal");
    expect(decision.exampleFlexGrow).toBe(5);
    expect(decision.controlsFlexGrow).toBe(3);
  });

  it("selects vertical mode for narrow width (<640px)", () => {
    const decision = selectTwoCardLayout(400);
    expect(decision.mode).toBe("vertical");
  });

  it("selects 3:2 at exactly the wide breakpoint boundary (960px)", () => {
    const decision = selectTwoCardLayout(960);
    expect(decision.ratio.name).toBe("5:3");
  });

  it("selects 3:2 just below the wide breakpoint (959px)", () => {
    const decision = selectTwoCardLayout(959);
    expect(decision.ratio.name).toBe("3:2");
  });

  it("example pane always gets the larger flex value", () => {
    for (const width of [400, 640, 800, 1200]) {
      const decision = selectTwoCardLayout(width);
      expect(decision.exampleFlexGrow).toBeGreaterThanOrEqual(decision.controlsFlexGrow);
    }
  });
});

describe("fibonacciLayoutService — three-card layout selection", () => {
  it("selects 5:3:2 for normal width (800px)", () => {
    const decision = selectThreeCardLayout(800);
    expect(decision.mode).toBe("horizontal");
    expect(decision.ratios[0].name).toBe("5:3");
    expect(decision.ratios[1].name).toBe("3:2");
    expect(decision.ratios[2].name).toBe("1:1");
  });

  it("selects 8:5:3 for extra-wide width (>=1200px)", () => {
    const decision = selectThreeCardLayout(1400);
    expect(decision.mode).toBe("horizontal");
    expect(decision.ratios[0].name).toBe("8:5");
    expect(decision.ratios[1].name).toBe("5:3");
    expect(decision.ratios[2].name).toBe("3:2");
  });

  it("selects vertical mode for narrow width (<640px)", () => {
    const decision = selectThreeCardLayout(500);
    expect(decision.mode).toBe("vertical");
  });

  it("ratios array always has three entries", () => {
    for (const width of [300, 700, 1000, 1500]) {
      const decision = selectThreeCardLayout(width);
      expect(decision.ratios).toHaveLength(3);
    }
  });
});

describe("fibonacciLayoutService — FIBONACCI_RATIOS constant", () => {
  it("contains all six canonical Fibonacci ratios in ascending order", () => {
    const names = FIBONACCI_RATIOS.map((r) => r.name);
    expect(names).toEqual(["1:1", "2:1", "3:2", "5:3", "8:5", "13:8"]);
  });

  it("each ratio has a > 0 and b > 0", () => {
    for (const ratio of FIBONACCI_RATIOS) {
      expect(ratio.a).toBeGreaterThan(0);
      expect(ratio.b).toBeGreaterThan(0);
    }
  });

  it("a >= b for every ratio (primary pane is always at least as large)", () => {
    for (const ratio of FIBONACCI_RATIOS) {
      expect(ratio.a).toBeGreaterThanOrEqual(ratio.b);
    }
  });
});

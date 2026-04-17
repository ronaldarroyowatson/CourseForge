import { describe, expect, it } from "vitest";

import { getNextIndex, incrementTrailingNumber } from "../../src/webapp/utils/predictiveText";

describe("predictiveText utilities", () => {
  it("increments trailing numeric suffix", () => {
    expect(incrementTrailingNumber("Chapter 1")).toBe("Chapter 2");
    expect(incrementTrailingNumber("Unit-099")).toBe("Unit-100");
  });

  it("returns trimmed value when no trailing numeric suffix exists", () => {
    expect(incrementTrailingNumber("  Intro  ")).toBe("Intro");
    expect(incrementTrailingNumber("Appendix A")).toBe("Appendix A");
    expect(incrementTrailingNumber("")).toBe("");
  });

  it("returns empty string for empty index list", () => {
    expect(getNextIndex([])).toBe("");
  });

  it("returns max+1 for sparse and negative index lists", () => {
    expect(getNextIndex([1, 4, 9])).toBe("10");
    expect(getNextIndex([-5, -2, -9])).toBe("-1");
  });
});

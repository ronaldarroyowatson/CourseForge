import { describe, expect, it } from "vitest";

import { checkContrast, computeContrastRatio, simplifyNumberForDyscalculia } from "../../src/core/services/accessibilityService";

describe("accessibility service", () => {
  it("computes contrast ratio for high-contrast pair", () => {
    const ratio = computeContrastRatio("#000000", "#ffffff");
    expect(ratio).toBeGreaterThanOrEqual(21);
  });

  it("passes WCAG AA for high-contrast mode baseline colors", () => {
    const result = checkContrast("#000000", "#ffffff");
    expect(result.passesAA).toBe(true);
  });

  it("formats numbers in simplified dyscalculia mode", () => {
    const formatted = simplifyNumberForDyscalculia(12345.6789);
    expect(formatted).toBe("12,345.68");
  });
});

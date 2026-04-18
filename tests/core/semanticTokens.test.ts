import { describe, expect, it } from "vitest";

import {
  AUTHORITATIVE_SEMANTIC_PALETTE,
  LEGACY_BRAND_BLUE,
  detectLegacyColorUsage,
  getSemanticCssVariables,
  normalizeHexColor,
} from "../../src/core/services/semanticTokens";

describe("semanticTokens", () => {
  it("keeps authoritative semantic palette values fixed", () => {
    expect(AUTHORITATIVE_SEMANTIC_PALETTE).toEqual({
      MAJOR: "#2563EB",
      MINOR: "#73A2F5",
      ACCENT: "#FFFFFF",
      SUCCESS: "#22C55E",
      WARNING: "#FACC15",
      ERROR: "#EF4444",
      INFO: "#06B6D4",
    });
  });

  it("normalizes hex values and flags non-whitelisted legacy color", () => {
    expect(normalizeHexColor("0c3183")).toBe("#0C3183");
    expect(normalizeHexColor(LEGACY_BRAND_BLUE)).toBe("#0C3183");
    expect(detectLegacyColorUsage("#0c3183")).toBe(true);
    expect(detectLegacyColorUsage("#0c3183", ["#0c3183"])).toBe(false);
  });

  it("generates stable semantic CSS variable mapping", () => {
    expect(getSemanticCssVariables()).toEqual({
      "--dsc-major": "#2563EB",
      "--dsc-minor": "#73A2F5",
      "--dsc-accent": "#FFFFFF",
      "--dsc-success": "#22C55E",
      "--dsc-warning": "#FACC15",
      "--dsc-error": "#EF4444",
      "--dsc-info": "#06B6D4",
    });
  });
});

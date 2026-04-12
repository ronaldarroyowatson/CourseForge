import { describe, expect, it } from "vitest";

import {
  applyDesignTokensToDocument,
  clearLocalDesignTokenPreferences,
  DEFAULT_DESIGN_TOKEN_PREFERENCES,
  generateDesignTokens,
  loadLocalDesignTokenPreferences,
  saveLocalDesignTokenPreferences,
  sanitizeDesignTokenPreferences,
} from "../../src/core/services/designSystemService";

describe("designSystemService", () => {
  it("generates nine primary shades from gamma-based settings", () => {
    const lowGamma = generateDesignTokens(sanitizeDesignTokenPreferences({ gamma: 2.0 }));
    const highGamma = generateDesignTokens(sanitizeDesignTokenPreferences({ gamma: 2.4 }));

    expect(lowGamma.color.primary).toHaveLength(9);
    expect(highGamma.color.primary).toHaveLength(9);
    expect(lowGamma.color.primary[4]).not.toBe(highGamma.color.primary[4]);
  });

  it("clamps and sanitizes preferences", () => {
    const sanitized = sanitizeDesignTokenPreferences({
      gamma: 9,
      typeRatio: 0.5,
      spacingRatio: 9,
      motionTimingMs: 999,
      motionEasing: "invalid" as "ease-in",
      semanticColors: {
        error: "red",
        success: "#11aa11",
        pending: "#ffaa00",
        new: "#1177aa",
      },
    });

    expect(sanitized.gamma).toBe(2.4);
    expect(sanitized.typeRatio).toBe(1.067);
    expect(sanitized.spacingRatio).toBe(2);
    expect(sanitized.motionTimingMs).toBe(500);
    expect(sanitized.motionEasing).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.motionEasing);
    expect(sanitized.semanticColors.error).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors.error);
    expect(sanitized.semanticColors.success).toBe("#11aa11");
  });

  it("builds type, stroke, spacing, and motion token scales", () => {
    const tokens = generateDesignTokens(
      sanitizeDesignTokenPreferences({
        typeRatio: 1.333,
        strokePreset: "doubling",
        spacingRatio: 1.5,
        motionTimingMs: 500,
        motionEasing: "ease-out",
      })
    );

    expect(tokens.type.scale["text-5xl"]).toBeGreaterThan(tokens.type.scale["text-2xl"]);
    expect(tokens.stroke.values).toEqual([1, 2, 4]);
    expect(tokens.spacing.values[2]).toBeCloseTo(9, 4);
    expect(tokens.motion.timingMs).toBe(500);
    expect(tokens.motion.easing).toBe("ease-out");
  });

  it("applies css variables to document root", () => {
    const tokens = generateDesignTokens(DEFAULT_DESIGN_TOKEN_PREFERENCES);
    applyDesignTokensToDocument(tokens, document);

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--cf-ds-primary-1")).toContain("#");
    expect(root.style.getPropertyValue("--cf-ds-text-3xl")).toContain("px");
    expect(root.style.getPropertyValue("--cf-ds-motion-easing")).toBe(tokens.motion.easing);
  });

  it("supports local persistence lifecycle", () => {
    const sample = sanitizeDesignTokenPreferences({
      gamma: 2.3,
      typeRatio: 1.333,
      strokePreset: "soft",
    });

    saveLocalDesignTokenPreferences(sample);
    const loaded = loadLocalDesignTokenPreferences();
    expect(loaded.gamma).toBe(2.3);
    expect(loaded.strokePreset).toBe("soft");

    clearLocalDesignTokenPreferences();
    const reset = loadLocalDesignTokenPreferences();
    expect(reset.gamma).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.gamma);
  });
});

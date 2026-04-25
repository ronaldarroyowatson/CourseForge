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
  it("generates ten primary shades from gamma-based settings", () => {
    const lowGamma = generateDesignTokens(sanitizeDesignTokenPreferences({ gamma: 2.0 }));
    const highGamma = generateDesignTokens(sanitizeDesignTokenPreferences({ gamma: 2.4 }));

    expect(lowGamma.color.primary).toHaveLength(10);
    expect(highGamma.color.primary).toHaveLength(10);
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

  it("derives accent trio and glow shadow presets", () => {
    const tokens = generateDesignTokens(sanitizeDesignTokenPreferences({
      brandDistance: 30,
      accentDistance: 75,
      glowEnabled: true,
      glowRadius: 32,
      glowIntensity: 0.9,
      shadowPreset: "dramatic",
      colorHarmony: "tetradic",
    }));

    expect(tokens.color.accent).toHaveLength(3);
    expect(tokens.color.harmony.label).toBe("Tetradic");
    expect(tokens.glow.enabled).toBe(true);
    expect(tokens.glow.shadow).toContain("rgba(0, 0, 0");
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

  it("anchors harmony accent and alt hues to primary hue", () => {
    const prefs = sanitizeDesignTokenPreferences({
      primaryHue: 30,
      colorHarmony: "complementary",
    });

    const tokens = generateDesignTokens(prefs);

    expect(tokens.color.harmony.anchorHue).toBe(30);
    expect(tokens.color.harmony.accentHue).toBe(210);
    expect(tokens.color.harmony.altHue).toBe(240);
  });

  it("constrains semantic token hues to their families while harmonizing", () => {
    const tokens = generateDesignTokens(sanitizeDesignTokenPreferences({
      primaryHue: 280,
      colorHarmony: "triadic",
      semanticColors: {
        error: "#ff00ff",
        success: "#ff00ff",
        pending: "#ff00ff",
        new: "#ff00ff",
      },
    }));

    expect(tokens.color.semantic.errorFamily).toBe("red");
    expect(tokens.color.semantic.successFamily).toBe("green");
    expect(tokens.color.semantic.pendingFamily).toBe("yellow");
    expect(tokens.color.semantic.newFamily).toBe("blue-cyan");

    expect(tokens.color.semantic.errorHue >= 340 || tokens.color.semantic.errorHue <= 20).toBe(true);
    expect(tokens.color.semantic.successHue).toBeGreaterThanOrEqual(85);
    expect(tokens.color.semantic.successHue).toBeLessThanOrEqual(155);
    expect(tokens.color.semantic.pendingHue).toBeGreaterThanOrEqual(35);
    expect(tokens.color.semantic.pendingHue).toBeLessThanOrEqual(70);
    expect(tokens.color.semantic.newHue).toBeGreaterThanOrEqual(185);
    expect(tokens.color.semantic.newHue).toBeLessThanOrEqual(220);
  });

  it("forces glow in dark mode and shadow in light mode", () => {
    const darkTokens = generateDesignTokens(sanitizeDesignTokenPreferences({
      colorMode: "dark",
      glowEnabled: false,
    }));
    const lightTokens = generateDesignTokens(sanitizeDesignTokenPreferences({
      colorMode: "light",
      glowEnabled: false,
    }));

    expect(darkTokens.glow.enabled).toBe(true);
    expect(lightTokens.glow.shadowEnabled).toBe(true);
  });

  it("keeps shadow neutral black while glow remains color-driven", () => {
    const tokens = generateDesignTokens(sanitizeDesignTokenPreferences({
      primaryHue: 32,
      glowRadius: 18,
      glowIntensity: 0.85,
      shadowStrength: 0.9,
      colorMode: "light",
    }));

    expect(tokens.glow.shadow).toContain("rgba(0, 0, 0");
    expect(tokens.glow.boxShadow).toContain(tokens.glow.glowColor);
  });

  it("supports shadow geometry controls for distance, blur, and spread", () => {
    const tokens = generateDesignTokens(sanitizeDesignTokenPreferences({
      shadowDistance: 22,
      shadowBlur: 36,
      shadowSpread: 8,
      shadowStrength: 0.75,
      colorMode: "light",
    }));

    expect(tokens.glow.shadow).toContain("0 22px 36px 8px");
  });
});

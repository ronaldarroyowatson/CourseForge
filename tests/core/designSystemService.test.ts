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

const EXPECTED_LOCKED_SEMANTIC_PALETTE = {
  major: "#2563EB",
  minor: "#73A2F5",
  accent: "#FFFFFF",
  success: "#22C55E",
  warning: "#FACC15",
  error: "#EF4444",
  info: "#06B6D4",
};

describe("designSystemService", () => {
  it("generates nine primary shades from gamma-based settings", () => {
    const lowGamma = generateDesignTokens(sanitizeDesignTokenPreferences({ gamma: 1.8 }));
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
        major: "#2563EB",
        minor: "#73A2F5",
        accent: "#FFFFFF",
        error: "red",
        success: "#11aa11",
        warning: "#ffaa00",
        info: "#1177aa",
        pending: "#ffaa00",
        new: "#1177aa",
      },
    });

    expect(sanitized.gamma).toBe(2.6);
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

  it("builds harmony role ramps, semantic assignments, and component recipes", () => {
    const tokens = generateDesignTokens(sanitizeDesignTokenPreferences({
      colorHarmonyMode: "triadic",
      colorHarmonyBrandMode: "derived",
      colorHarmonySaturation: 74,
      semanticAssignments: {
        ...DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticAssignments,
        buttonPrimary: "major",
        border: "accent",
      },
    }));

    expect(tokens.harmony.effectiveBrandHue).toBe(tokens.harmony.accentHue);
    expect(tokens.color.roles.major.shades).toHaveLength(9);
    expect(tokens.color.assignments.buttonPrimary).toBe("major");
    expect(tokens.color.resolved.buttonPrimary).toBe(tokens.color.roles.major.shades[4]);
    expect(tokens.component.buttonPrimary.background).toBe(tokens.color.resolved.buttonPrimary);
    expect(tokens.component.buttonPrimary.hover).toBe(tokens.color.resolved.accentHover);
    expect(tokens.component.buttonPrimary.active).toBe(tokens.color.resolved.accentActive);
    expect(tokens.component.buttonPrimary.disabled).toBe(tokens.color.resolved.surface);
    expect(tokens.component.input.hoverBorder).toBe(tokens.color.resolved.accentHover);
    expect(tokens.component.input.activeBorder).toBe(tokens.color.resolved.accentActive);
    expect(tokens.component.input.disabledBackground).toBe(tokens.color.resolved.background);
    expect(tokens.component.alert.error).toBe(tokens.color.resolved.error);
    expect(tokens.component.badge.info).toBe(tokens.color.resolved.info);
  });

  it("uses deterministic blue harmony defaults for startup token generation", () => {
    const tokens = generateDesignTokens(DEFAULT_DESIGN_TOKEN_PREFERENCES);

    expect(DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBaseHue).toBe(221.2);
    expect(DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonySaturation).toBe(83);
    expect(tokens.harmony.baseHue).toBe(221.2);
    expect(tokens.harmony.saturation).toBe(83);
    expect(tokens.color.semantic.error).toBe("#EF4444");
    expect(tokens.color.semantic.success).toBe("#22C55E");
    expect(tokens.color.semantic.pending).toBe("#FACC15");
    expect(tokens.color.semantic.new).toBe("#06B6D4");
  });

  it("locks semantic palette roles to the exact required hex values", () => {
    const tokens = generateDesignTokens(DEFAULT_DESIGN_TOKEN_PREFERENCES);

    expect(tokens.color.roles.major.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.major);
    expect(tokens.color.roles.minor.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.minor);
    expect(tokens.color.roles.accent.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.accent);
    expect(tokens.color.roles.success.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.success);
    expect(tokens.color.roles.warning.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.warning);
    expect(tokens.color.roles.error.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.error);
    expect(tokens.color.roles.info.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.info);
  });

  it("does not allow harmony settings to override locked semantic palette roles", () => {
    const tokens = generateDesignTokens(
      sanitizeDesignTokenPreferences({
        colorHarmonyMode: "triadic",
        colorHarmonyBaseHue: 18,
        colorHarmonyBrandHue: 300,
        colorHarmonySaturation: 100,
      })
    );

    expect(tokens.color.roles.major.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.major);
    expect(tokens.color.roles.minor.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.minor);
    expect(tokens.color.roles.accent.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.accent);
    expect(tokens.color.roles.success.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.success);
    expect(tokens.color.roles.warning.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.warning);
    expect(tokens.color.roles.error.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.error);
    expect(tokens.color.roles.info.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.info);
  });

  it("keeps locked palette when harmony is effectively disconnected", () => {
    const disconnectedHarmonyTokens = generateDesignTokens(
      sanitizeDesignTokenPreferences({
        colorHarmonyMode: "mono",
        colorHarmonyBaseHue: 0,
        colorHarmonyBrandHue: 0,
        colorHarmonyBrandMode: "independent",
        colorHarmonySaturationMode: "locked",
        colorHarmonySaturation: 0,
        gamma: 2.6,
      })
    );

    expect(disconnectedHarmonyTokens.color.roles.major.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.major);
    expect(disconnectedHarmonyTokens.color.roles.minor.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.minor);
    expect(disconnectedHarmonyTokens.color.roles.accent.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.accent);
    expect(disconnectedHarmonyTokens.color.roles.success.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.success);
    expect(disconnectedHarmonyTokens.color.roles.warning.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.warning);
    expect(disconnectedHarmonyTokens.color.roles.error.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.error);
    expect(disconnectedHarmonyTokens.color.roles.info.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.info);
  });

  it("keeps locked semantic palette across harmony and curve control matrix", () => {
    const matrix = [
      { colorHarmonyMode: "mono", colorHarmonyBrandMode: "independent", colorHarmonySaturationMode: "free", colorHarmonyBaseHue: 221.2, colorHarmonyBrandHue: 221.2, colorHarmonySaturation: 83, gamma: 2.2 },
      { colorHarmonyMode: "analogous", colorHarmonyBrandMode: "derived", colorHarmonySaturationMode: "locked", colorHarmonyBaseHue: 12, colorHarmonyBrandHue: 300, colorHarmonySaturation: 25, gamma: 1.8 },
      { colorHarmonyMode: "complementary", colorHarmonyBrandMode: "independent", colorHarmonySaturationMode: "free", colorHarmonyBaseHue: 180, colorHarmonyBrandHue: 60, colorHarmonySaturation: 100, gamma: 2.4 },
      { colorHarmonyMode: "split-complementary", colorHarmonyBrandMode: "derived", colorHarmonySaturationMode: "locked", colorHarmonyBaseHue: 320, colorHarmonyBrandHue: 45, colorHarmonySaturation: 0, gamma: 2.6 },
      { colorHarmonyMode: "triadic", colorHarmonyBrandMode: "independent", colorHarmonySaturationMode: "free", colorHarmonyBaseHue: 44, colorHarmonyBrandHue: 270, colorHarmonySaturation: 67, gamma: 2.0 },
    ] as const;

    for (const scenario of matrix) {
      const tokens = generateDesignTokens(sanitizeDesignTokenPreferences({ ...scenario }));

      expect(tokens.color.roles.major.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.major);
      expect(tokens.color.roles.minor.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.minor);
      expect(tokens.color.roles.accent.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.accent);
      expect(tokens.color.roles.success.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.success);
      expect(tokens.color.roles.warning.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.warning);
      expect(tokens.color.roles.error.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.error);
      expect(tokens.color.roles.info.shades[4]).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.info);

      expect(tokens.color.resolved.background).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.major);
      expect(tokens.color.resolved.surface).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.major);
      expect(tokens.color.resolved.border).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.minor);
      expect(tokens.color.resolved.text).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.accent);
      expect(tokens.color.resolved.warning).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.warning);
      expect(tokens.color.resolved.error).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.error);
      expect(tokens.color.resolved.info).toBe(EXPECTED_LOCKED_SEMANTIC_PALETTE.info);
    }
  });

  it("applies css variables to document root", () => {
    const tokens = generateDesignTokens(DEFAULT_DESIGN_TOKEN_PREFERENCES);
    applyDesignTokensToDocument(tokens, document);

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--cf-ds-primary-1")).toContain("#");
    expect(root.style.getPropertyValue("--cf-ds-text-3xl")).toContain("px");
    expect(root.style.getPropertyValue("--cf-ds-motion-easing")).toBe(tokens.motion.easing);
    expect(root.style.getPropertyValue("--cf-semantic-button-primary")).toBe(tokens.color.resolved.buttonPrimary);
    expect(root.style.getPropertyValue("--cf-ds-role-major-5")).toBe(tokens.color.roles.major.shades[4]);
    expect(root.style.getPropertyValue("--cf-ds-alert-error")).toBe(tokens.component.alert.error);
    expect(root.style.getPropertyValue("--cf-ds-btn-primary-hover")).toBe(tokens.component.buttonPrimary.hover);
    expect(root.style.getPropertyValue("--cf-ds-input-hover-border")).toBe(tokens.component.input.hoverBorder);
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

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDscDebugRecords,
  DEFAULT_DESIGN_TOKEN_PREFERENCES,
  generateDscDebugReport,
  generateDesignTokens,
  LOCKED_SEMANTIC_PALETTE,
  sanitizeDesignTokenPreferences,
  setDscDebugModeEnabled,
} from "../../src/core/services/designSystemService";

describe("dsc debug report", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearDscDebugRecords();
    setDscDebugModeEnabled(true);
  });

  it("keeps semantic palette locked across harmony changes", () => {
    const tokens = generateDesignTokens(
      sanitizeDesignTokenPreferences({
        colorHarmonyMode: "triadic",
        colorHarmonyBaseHue: 19,
        colorHarmonyBrandHue: 332,
        colorHarmonySaturation: 100,
      })
    );

    expect(tokens.color.roles.major.shades[4]).toBe(LOCKED_SEMANTIC_PALETTE.major);
    expect(tokens.color.roles.minor.shades[4]).toBe(LOCKED_SEMANTIC_PALETTE.minor);
    expect(tokens.color.roles.accent.shades[4]).toBe(LOCKED_SEMANTIC_PALETTE.accent);
    expect(tokens.color.roles.success.shades[4]).toBe(LOCKED_SEMANTIC_PALETTE.success);
    expect(tokens.color.roles.warning.shades[4]).toBe(LOCKED_SEMANTIC_PALETTE.warning);
    expect(tokens.color.roles.error.shades[4]).toBe(LOCKED_SEMANTIC_PALETTE.error);
    expect(tokens.color.roles.info.shades[4]).toBe(LOCKED_SEMANTIC_PALETTE.info);
  });

  it("builds a comprehensive report with required debug fields", () => {
    document.documentElement.dataset.theme = "light";
    const report = generateDscDebugReport(DEFAULT_DESIGN_TOKEN_PREFERENCES);

    expect(report.palette).toEqual(LOCKED_SEMANTIC_PALETTE);
    expect(report.semanticTokens.roles.major).toBe(LOCKED_SEMANTIC_PALETTE.major);
    expect(report.componentTokenMaps.buttonPrimary.hover).toBe(LOCKED_SEMANTIC_PALETTE.accent);
    expect(report.componentTokenMaps.alerts.error).toBe(LOCKED_SEMANTIC_PALETTE.error);
    expect(report.componentTokenMaps.badges.info).toBe(LOCKED_SEMANTIC_PALETTE.info);
    expect(report.componentTokenMaps.inputs.focus).toBe(LOCKED_SEMANTIC_PALETTE.info);

    const sample = report.fallbackRecords[0];
    expect(sample).toBeTruthy();
    expect(sample).toHaveProperty("semanticRole");
    expect(sample).toHaveProperty("sourcePath");
    expect(sample).toHaveProperty("requestedValue");
    expect(sample).toHaveProperty("computedValue");
    expect(sample).toHaveProperty("fallbackChain");
    expect(sample).toHaveProperty("reasonForFallback");
    expect(sample).toHaveProperty("component");
    expect(sample).toHaveProperty("interactionState");
    expect(sample).toHaveProperty("contrastRatio");
    expect(sample).toHaveProperty("themeMode");

    expect(report.cssVariablesSnapshot["--cf-semantic-accent"]).toBe(LOCKED_SEMANTIC_PALETTE.accent);
    expect(report.contrastChecks.length).toBeGreaterThan(0);
    expect(report.uiIntrospection.pages.length).toBeGreaterThan(0);
    expect(report.uiIntrospection.pages[0].cards.length).toBeGreaterThan(0);
  });

  it("captures light and dark theme generation states", () => {
    document.documentElement.dataset.theme = "dark";
    const darkReport = generateDscDebugReport(DEFAULT_DESIGN_TOKEN_PREFERENCES);
    expect(darkReport.themeGeneration.mode).toBe("dark");

    document.documentElement.dataset.theme = "light";
    const lightReport = generateDscDebugReport(DEFAULT_DESIGN_TOKEN_PREFERENCES);
    expect(lightReport.themeGeneration.mode).toBe("light");

    expect(darkReport.semanticTokens.roles).toEqual(lightReport.semanticTokens.roles);
  });

  it("reports no unexpected fallback reasons for locked semantic palette", () => {
    const report = generateDscDebugReport(DEFAULT_DESIGN_TOKEN_PREFERENCES);
    const unexpectedFallbacks = report.fallbackRecords.filter((record) => record.reasonForFallback !== null);
    expect(unexpectedFallbacks).toHaveLength(0);
  });

  it("emits deterministic token-resolution records with cascading-risk metadata", () => {
    const report = generateDscDebugReport(DEFAULT_DESIGN_TOKEN_PREFERENCES);
    const sample = report.fallbackRecords[0] as unknown as Record<string, unknown>;

    expect(sample).toHaveProperty("requestedToken");
    expect(sample).toHaveProperty("resolvedToken");
    expect(sample).toHaveProperty("computedColor");
    expect(sample).toHaveProperty("componentName");
    expect(sample).toHaveProperty("componentState");
    expect(sample).toHaveProperty("contrastAgainstBackground");
    expect(sample).toHaveProperty("contrastAcceptable");
    expect(sample).toHaveProperty("cascadingFailureRisk");

    expect(report.cascadingFailureSummary.riskCount).toBe(0);
    expect(report.cascadingFailureSummary.risks).toHaveLength(0);
  });

  it("tracks page and card token introspection details", () => {
    const report = generateDscDebugReport(DEFAULT_DESIGN_TOKEN_PREFERENCES);
    const settingsPage = report.uiIntrospection.pages.find((page) => page.pageId === "settings");

    expect(settingsPage).toBeTruthy();
    if (!settingsPage) {
      return;
    }

    const designCard = settingsPage.cards.find((card) => card.cardId === "design-system-controls");
    expect(designCard).toBeTruthy();
    if (!designCard) {
      return;
    }

    expect(designCard.expectedTokenSet.background).toBe("cardBackground");
    expect(designCard.actualTokenSet.background).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(Array.isArray(designCard.components)).toBe(true);
  });

  it("flags legacy #0c3183 usage when not explicitly whitelisted", () => {
    const report = generateDscDebugReport(DEFAULT_DESIGN_TOKEN_PREFERENCES);
    const legacyFindings = report.fallbackRecords.filter((record) => record.computedColor.toLowerCase() === "#0c3183");

    expect(legacyFindings).toHaveLength(0);
    expect(report.cascadingFailureSummary.risks.some((risk) => risk.code === "legacy-color-use")).toBe(false);
  });

  it("flags low contrast records as cascading-failure risks", () => {
    const report = generateDscDebugReport(sanitizeDesignTokenPreferences({
      semanticAssignments: {
        ...DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticAssignments,
        background: "accent",
        text: "accent",
      },
    }));

    expect(report.cascadingFailureSummary.riskCount).toBeGreaterThan(0);
    expect(report.cascadingFailureSummary.risks.some((risk) => risk.code === "low-contrast")).toBe(true);
  });
});

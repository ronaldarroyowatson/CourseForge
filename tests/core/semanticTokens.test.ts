import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LEGACY_COLOR_WHITELIST,
  SEMANTIC_CSS_VARS,
  SEMANTIC_PALETTE,
  applySemanticTokensToRoot,
  generateSemanticTokensCss,
  getSemanticColor,
  isLegacyColorWhitelisted,
  semanticTokenMatchesPalette,
  validateSemanticTokens,
} from "../../src/core/services/semanticTokens";
import {
  clearCardTokenReports,
  clearTokenResolutionLog,
  generateDscDebugReport,
  getCardTokenReports,
  getTokenResolutionLog,
  isDscDebugEnabled,
  recordTokenResolution,
  registerCardTokenReport,
  serializeDscDebugReport,
  setDscDebugEnabled,
} from "../../src/core/services/tokenDebugService";

// ============================================================
// PART 0 — Authoritative Semantic Palette
// ============================================================

describe("SEMANTIC_PALETTE — authoritative hex values", () => {
  it("MAJOR resolves to #2563EB", () => {
    expect(SEMANTIC_PALETTE.MAJOR).toBe("#2563EB");
  });

  it("MINOR resolves to #73A2F5", () => {
    expect(SEMANTIC_PALETTE.MINOR).toBe("#73A2F5");
  });

  it("ACCENT resolves to #FFFFFF", () => {
    expect(SEMANTIC_PALETTE.ACCENT).toBe("#FFFFFF");
  });

  it("SUCCESS resolves to #22C55E", () => {
    expect(SEMANTIC_PALETTE.SUCCESS).toBe("#22C55E");
  });

  it("WARNING resolves to #FACC15", () => {
    expect(SEMANTIC_PALETTE.WARNING).toBe("#FACC15");
  });

  it("ERROR resolves to #EF4444", () => {
    expect(SEMANTIC_PALETTE.ERROR).toBe("#EF4444");
  });

  it("INFO resolves to #06B6D4", () => {
    expect(SEMANTIC_PALETTE.INFO).toBe("#06B6D4");
  });

  it("palette is frozen and cannot be mutated", () => {
    expect(Object.isFrozen(SEMANTIC_PALETTE)).toBe(true);
  });

  it("palette contains exactly 7 roles", () => {
    expect(Object.keys(SEMANTIC_PALETTE)).toHaveLength(7);
  });
});

describe("LEGACY_COLOR_WHITELIST", () => {
  it("LEGACY_BRAND_BLUE is #0c3183", () => {
    expect(LEGACY_COLOR_WHITELIST["LEGACY_BRAND_BLUE"].toLowerCase()).toBe("#0c3183");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(LEGACY_COLOR_WHITELIST)).toBe(true);
  });
});

describe("SEMANTIC_CSS_VARS", () => {
  it("maps MAJOR to --dsc-major", () => {
    expect(SEMANTIC_CSS_VARS.MAJOR).toBe("--dsc-major");
  });

  it("maps ERROR to --dsc-error", () => {
    expect(SEMANTIC_CSS_VARS.ERROR).toBe("--dsc-error");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(SEMANTIC_CSS_VARS)).toBe(true);
  });
});

// ============================================================
// Helper functions
// ============================================================

describe("getSemanticColor", () => {
  it("returns the correct hex for each role", () => {
    expect(getSemanticColor("MAJOR")).toBe("#2563EB");
    expect(getSemanticColor("SUCCESS")).toBe("#22C55E");
    expect(getSemanticColor("ERROR")).toBe("#EF4444");
  });
});

describe("semanticTokenMatchesPalette", () => {
  it("returns true when colors match (case-insensitive)", () => {
    expect(semanticTokenMatchesPalette("MAJOR", "#2563EB")).toBe(true);
    expect(semanticTokenMatchesPalette("MAJOR", "#2563eb")).toBe(true);
  });

  it("returns false when colors do not match", () => {
    expect(semanticTokenMatchesPalette("MAJOR", "#0c3183")).toBe(false);
    expect(semanticTokenMatchesPalette("ERROR", "#2563EB")).toBe(false);
  });
});

describe("isLegacyColorWhitelisted", () => {
  it("returns true for #0c3183 (LEGACY_BRAND_BLUE)", () => {
    expect(isLegacyColorWhitelisted("#0c3183")).toBe(true);
    expect(isLegacyColorWhitelisted("#0C3183")).toBe(true);
    expect(isLegacyColorWhitelisted("0c3183")).toBe(true);
  });

  it("returns false for a non-whitelisted color", () => {
    expect(isLegacyColorWhitelisted("#FF0000")).toBe(false);
    expect(isLegacyColorWhitelisted("#2563EB")).toBe(false);
  });
});

describe("validateSemanticTokens", () => {
  it("returns no mismatches when all tokens match the palette", () => {
    const mismatches = validateSemanticTokens({
      MAJOR: "#2563EB",
      SUCCESS: "#22C55E",
    });
    expect(mismatches).toHaveLength(0);
  });

  it("reports mismatches when tokens deviate from the palette", () => {
    const mismatches = validateSemanticTokens({
      MAJOR: "#0c3183",
      ERROR: "#EF4444",
    });
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.role).toBe("MAJOR");
    expect(mismatches[0]?.expected).toBe("#2563EB");
    expect(mismatches[0]?.actual).toBe("#0c3183");
  });

  it("skips roles that are not present in the input object", () => {
    const mismatches = validateSemanticTokens({});
    expect(mismatches).toHaveLength(0);
  });
});

describe("generateSemanticTokensCss", () => {
  it("produces a :root block with all seven DSC custom properties", () => {
    const css = generateSemanticTokensCss();
    expect(css).toContain(":root {");
    expect(css).toContain("--dsc-major: #2563EB");
    expect(css).toContain("--dsc-minor: #73A2F5");
    expect(css).toContain("--dsc-accent: #FFFFFF");
    expect(css).toContain("--dsc-success: #22C55E");
    expect(css).toContain("--dsc-warning: #FACC15");
    expect(css).toContain("--dsc-error: #EF4444");
    expect(css).toContain("--dsc-info: #06B6D4");
  });

  it("does not contain the legacy brand blue (#0c3183)", () => {
    const css = generateSemanticTokensCss();
    expect(css.toLowerCase()).not.toContain("0c3183");
  });
});

describe("applySemanticTokensToRoot", () => {
  it("sets CSS custom properties on the provided element", () => {
    const el = document.createElement("div");
    applySemanticTokensToRoot(el);
    expect(el.style.getPropertyValue("--dsc-major")).toBe("#2563EB");
    expect(el.style.getPropertyValue("--dsc-success")).toBe("#22C55E");
    expect(el.style.getPropertyValue("--dsc-error")).toBe("#EF4444");
  });
});

// ============================================================
// PART 1 — Token Resolution Debug Module
// ============================================================

describe("tokenDebugService — resolution recording", () => {
  beforeEach(() => {
    setDscDebugEnabled(true);
    clearTokenResolutionLog();
  });

  afterEach(() => {
    setDscDebugEnabled(false);
    clearTokenResolutionLog();
  });

  it("records a valid resolution with status ok", () => {
    const rec = recordTokenResolution({
      semanticRole: "MAJOR",
      requestedToken: "--dsc-major",
      resolvedToken: "--dsc-major",
      computedColor: "#2563EB",
      themeMode: "light",
      componentName: "PrimaryButton",
      componentState: "default",
    });
    expect(rec).not.toBeNull();
    expect(rec?.status).toBe("ok");
    expect(rec?.computedColor).toBe("#2563eb");
  });

  it("marks resolution as 'mismatch' when color deviates from palette", () => {
    const rec = recordTokenResolution({
      semanticRole: "MAJOR",
      requestedToken: "--dsc-major",
      resolvedToken: "--cf-accent",
      computedColor: "#1f6fb6",
    });
    expect(rec?.status).toBe("mismatch");
    expect(rec?.issue).toContain("#1f6fb6");
    expect(rec?.issue).toContain("#2563EB");
  });

  it("marks resolution as 'error' when legacy brand blue (#0c3183) is computed", () => {
    const rec = recordTokenResolution({
      semanticRole: "MAJOR",
      requestedToken: "--dsc-major",
      resolvedToken: "--legacy-brand",
      computedColor: "#0c3183",
    });
    expect(rec?.status).toBe("error");
    expect(rec?.issue).toContain("#0c3183");
  });

  it("marks resolution as 'cascading-failure-risk' when fallback chain is non-empty and color is correct", () => {
    const rec = recordTokenResolution({
      semanticRole: "MAJOR",
      requestedToken: "--dsc-major",
      resolvedToken: "--dsc-major",
      computedColor: "#2563EB",
      fallbackChain: ["--cf-accent", "--primary-bg"],
      reasonForFallback: "Token not found at original path",
    });
    expect(rec?.status).toBe("cascading-failure-risk");
    expect(rec?.fallbackChain).toHaveLength(2);
  });

  it("returns null when debug mode is disabled", () => {
    setDscDebugEnabled(false);
    const rec = recordTokenResolution({
      semanticRole: "MAJOR",
      requestedToken: "--dsc-major",
      resolvedToken: "--dsc-major",
      computedColor: "#2563EB",
    });
    expect(rec).toBeNull();
    expect(getTokenResolutionLog()).toHaveLength(0);
  });

  it("accumulates multiple records", () => {
    recordTokenResolution({ semanticRole: "MAJOR", requestedToken: "--dsc-major", resolvedToken: "--dsc-major", computedColor: "#2563EB" });
    recordTokenResolution({ semanticRole: "ERROR", requestedToken: "--dsc-error", resolvedToken: "--dsc-error", computedColor: "#EF4444" });
    expect(getTokenResolutionLog()).toHaveLength(2);
  });

  it("clearTokenResolutionLog empties the log", () => {
    recordTokenResolution({ semanticRole: "MAJOR", requestedToken: "--dsc-major", resolvedToken: "--dsc-major", computedColor: "#2563EB" });
    clearTokenResolutionLog();
    expect(getTokenResolutionLog()).toHaveLength(0);
  });
});

describe("tokenDebugService — isDscDebugEnabled / setDscDebugEnabled", () => {
  afterEach(() => {
    setDscDebugEnabled(false);
  });

  it("can be toggled via localStorage", () => {
    setDscDebugEnabled(true);
    expect(isDscDebugEnabled()).toBe(true);
    setDscDebugEnabled(false);
    expect(isDscDebugEnabled()).toBe(false);
  });
});

// ============================================================
// Card-level token reports
// ============================================================

describe("tokenDebugService — card token reports", () => {
  beforeEach(() => {
    clearCardTokenReports();
  });

  afterEach(() => {
    clearCardTokenReports();
  });

  it("registers and retrieves a card token report", () => {
    registerCardTokenReport({
      pageId: "settings",
      cardId: "debug-log",
      cardType: "settings-card",
      recipeName: "default",
      expectedTokenSet: { MAJOR: "#2563EB" },
      actualTokenSet: { MAJOR: "#2563EB" },
      backgroundColor: "#ffffff",
      borderColor: "#cad8e6",
      titleTextColor: "#11253a",
      bodyTextColor: "#1d3247",
      buttonTypes: ["primary"],
      buttonTokenSets: [],
      fallbacksUsed: [],
      mismatches: [],
      legacyColorsFound: [],
      timestamp: new Date().toISOString(),
    });

    const reports = getCardTokenReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.cardId).toBe("debug-log");
  });

  it("overwrites an existing report for the same page+card", () => {
    const base = {
      pageId: "settings",
      cardId: "debug-log",
      cardType: "settings-card",
      recipeName: "default",
      expectedTokenSet: {},
      actualTokenSet: {},
      backgroundColor: "#fff",
      borderColor: "#ccc",
      titleTextColor: "#000",
      bodyTextColor: "#000",
      buttonTypes: [],
      buttonTokenSets: [],
      fallbacksUsed: [],
      mismatches: [],
      legacyColorsFound: [],
      timestamp: new Date().toISOString(),
    };

    registerCardTokenReport({ ...base, backgroundColor: "#fff" });
    registerCardTokenReport({ ...base, backgroundColor: "#eee" });

    const reports = getCardTokenReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]?.backgroundColor).toBe("#eee");
  });
});

// ============================================================
// Full debug report generation
// ============================================================

describe("generateDscDebugReport", () => {
  beforeEach(() => {
    setDscDebugEnabled(true);
    clearTokenResolutionLog();
    clearCardTokenReports();
  });

  afterEach(() => {
    setDscDebugEnabled(false);
    clearTokenResolutionLog();
    clearCardTokenReports();
  });

  it("includes the authoritative semantic palette", () => {
    const report = generateDscDebugReport();
    expect(report.semanticPalette.MAJOR).toBe("#2563EB");
    expect(report.semanticPalette.ERROR).toBe("#EF4444");
  });

  it("reflects recorded resolutions in summary", () => {
    recordTokenResolution({
      semanticRole: "MAJOR",
      requestedToken: "--dsc-major",
      resolvedToken: "--cf-accent",
      computedColor: "#1f6fb6",
    });
    const report = generateDscDebugReport();
    expect(report.summary.totalResolutions).toBe(1);
    expect(report.summary.mismatches).toBe(1);
  });

  it("can be serialized to valid JSON", () => {
    const report = generateDscDebugReport({ appVersion: "1.5.0" });
    const json = serializeDscDebugReport(report);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as { appVersion: string };
    expect(parsed.appVersion).toBe("1.5.0");
  });
});

// ============================================================
// Regression: #0c3183 must never appear in the palette
// ============================================================

describe("regression — #0c3183 (legacy brand blue) must not be in the active palette", () => {
  it("SEMANTIC_PALETTE does not contain #0c3183", () => {
    const values = Object.values(SEMANTIC_PALETTE).map((v) => v.toLowerCase());
    expect(values).not.toContain("#0c3183");
  });

  it("generateSemanticTokensCss output does not contain #0c3183", () => {
    const css = generateSemanticTokensCss();
    expect(css.toLowerCase()).not.toContain("0c3183");
  });

  it("applySemanticTokensToRoot does not set #0c3183 on any property", () => {
    const el = document.createElement("div");
    applySemanticTokensToRoot(el);
    const style = el.getAttribute("style") ?? "";
    expect(style.toLowerCase()).not.toContain("0c3183");
  });
});

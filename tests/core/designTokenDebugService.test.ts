import { describe, expect, it } from "vitest";

import {
  AUTHORITATIVE_SEMANTIC_PALETTE,
  applyAuthoritativeSemanticPalette,
  buildDesignTokenDebugReport,
} from "../../src/core/services/designTokenDebugService";

describe("designTokenDebugService", () => {
  it("resolves semantic tokens to the authoritative palette and flags legacy mismatches", () => {
    const report = buildDesignTokenDebugReport({
      pageId: "settings",
      cardId: "debug-log",
      componentIds: ["debug-toggle", "debug-clear", "debug-send", "debug-introspection"],
      tokenSources: {
        "--cf-accent": "#0c3183",
        "--cf-accent-strong": "#0c3183",
        "--cf-text-on-accent": "#ffffff",
        "--cf-success": "#22c55e",
        "--cf-warning": "#facc15",
        "--cf-danger": "#ef4444",
        "--cf-info": "#06b6d4",
      },
    });

    expect(report.tokens.MAJOR.resolvedValue).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.MAJOR);
    expect(report.tokens.MINOR.resolvedValue).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.MINOR);
    expect(report.mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "MAJOR", actual: "#0C3183", expected: AUTHORITATIVE_SEMANTIC_PALETTE.MAJOR, whitelisted: false }),
        expect.objectContaining({ token: "MINOR", actual: "#0C3183", expected: AUTHORITATIVE_SEMANTIC_PALETTE.MINOR, whitelisted: false }),
      ])
    );
    expect(report.cascadingFailureRisk.level).toBe("high");
    expect(report.cascadingFailureRisk.impactedTokens).toEqual(expect.arrayContaining(["MAJOR", "MINOR"]));
  });

  it("permits explicit legacy whitelists without reporting a bug", () => {
    const report = buildDesignTokenDebugReport({
      pageId: "settings",
      cardId: "debug-log",
      tokenSources: {
        "--cf-accent": "#0c3183",
      },
      legacyWhitelist: ["#0c3183"],
    });

    expect(report.mismatches).toEqual([]);
    expect(report.tokens.MAJOR.usedLegacyWhitelist).toBe(true);
    expect(report.cascadingFailureRisk.level).toBe("none");
  });

  it("applies the authoritative palette to the live root element", () => {
    applyAuthoritativeSemanticPalette(document.documentElement);

    expect(document.documentElement.style.getPropertyValue("--cf-accent")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.MAJOR);
    expect(document.documentElement.style.getPropertyValue("--cf-accent-strong")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.MINOR);
    expect(document.documentElement.style.getPropertyValue("--cf-text-on-accent")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.ACCENT);
    expect(document.documentElement.style.getPropertyValue("--cf-success")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.SUCCESS);
    expect(document.documentElement.style.getPropertyValue("--cf-warning")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.WARNING);
    expect(document.documentElement.style.getPropertyValue("--cf-danger")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.ERROR);
    expect(document.documentElement.style.getPropertyValue("--cf-info")).toBe(AUTHORITATIVE_SEMANTIC_PALETTE.INFO);
  });
});
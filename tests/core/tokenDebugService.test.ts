import { describe, expect, it } from "vitest";

import {
  buildFullDebugReport,
  buildTokenResolutionRecords,
  buildUiIntrospectionReport,
} from "../../src/core/services/tokenDebugService";

describe("tokenDebugService", () => {
  it("captures mismatch, fallback, and legacy-color errors", () => {
    const records = buildTokenResolutionRecords({
      tokenSources: {
        "--cf-semantic-major": "#0c3183",
        "--cf-semantic-minor": "#0c3183",
      },
    });

    const major = records.find((entry) => entry.semanticRole === "MAJOR");
    const minor = records.find((entry) => entry.semanticRole === "MINOR");

    expect(major?.isLegacyColorError).toBe(true);
    expect(minor?.isLegacyColorError).toBe(true);
    expect(records.some((entry) => entry.cascadingFailureRisk)).toBe(true);
  });

  it("builds page/card/component introspection report", () => {
    const report = buildUiIntrospectionReport({ pageId: "settings", cardId: "debug-log" });

    expect(report.pageId).toBe("settings");
    expect(report.cardId).toBe("debug-log");
    expect(report.recipeName).toBe("settings.debug-log");
    expect(report.buttonTypes).toEqual(expect.arrayContaining(["primary", "secondary", "danger"]));
  });

  it("builds a full debug report with cascading detector", () => {
    const report = buildFullDebugReport({
      tokenSources: {
        "--cf-semantic-major": "#0c3183",
      },
    });

    expect(report.tokenResolution.length).toBeGreaterThan(0);
    expect(report.uiIntrospection.cardId).toBe("debug-log");
    expect(report.cascadingFailureDetector.hasRisk).toBe(true);
  });
});

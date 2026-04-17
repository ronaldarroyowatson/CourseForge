import { describe, expect, it, beforeEach } from "vitest";

import {
  DEFAULT_DESIGN_TOKEN_PREFERENCES,
  initializeDesignTokenPreferencesOnFirstRun,
  readLocalDesignTokenDiagnostics,
  resolveCloudSettingsDecision,
  sanitizeDesignTokenPreferences,
  tryRepairCorruptedLocalDesignSettings,
  validateDesignTokenPreferences,
} from "../../src/core/services/designSystemService";

describe("design system recovery and first-run", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("detects system defaults on first run when APIs are available", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-color-scheme") || query.includes("prefers-contrast"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const result = initializeDesignTokenPreferencesOnFirstRun();

    expect(result.source).toBe("system");
    expect(result.preferences.useSystemDefaults).toBe(true);
    expect(result.preferences.colorHarmonyBaseHue).toBe(221.2);
    expect(result.preferences.colorHarmonySaturation).toBe(83);
    expect(result.preferences.semanticColors.error).toBe("#EF4444");
    expect(result.preferences.semanticColors.success).toBe("#22C55E");
    expect(result.preferences.semanticColors.pending).toBe("#FACC15");
    expect(result.preferences.semanticColors.new).toBe("#06B6D4");
    expect(result.traces.some((entry) => entry.step === "first-run-detection")).toBe(true);

    window.matchMedia = originalMatchMedia;
  });

  it("migrates older saved design-token profiles to deterministic semantic defaults", () => {
    window.localStorage.setItem(
      "courseforge.designTokens.v1",
      JSON.stringify({
        ...DEFAULT_DESIGN_TOKEN_PREFERENCES,
        colorHarmonyBaseHue: 12,
        colorHarmonySaturation: 40,
        semanticColors: {
          ...DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors,
          pending: "#999999",
          new: "#333333",
        },
      })
    );
    window.localStorage.setItem("courseforge.designTokens.profile.v1", "semantic-unified-v1");

    const result = initializeDesignTokenPreferencesOnFirstRun();

    expect(result.source).toBe("local");
    expect(result.preferences.colorHarmonyBaseHue).toBe(221.2);
    expect(result.preferences.colorHarmonySaturation).toBe(83);
    expect(result.preferences.semanticColors.pending).toBe("#FACC15");
    expect(result.preferences.semanticColors.new).toBe("#06B6D4");
    expect(window.localStorage.getItem("courseforge.designTokens.profile.v1")).toBe("semantic-unified-v2");
    expect(result.traces.some((entry) => entry.step === "profile-migration")).toBe(true);
  });

  it("falls back when system detection APIs are unavailable", () => {
    const originalMatchMedia = window.matchMedia;
    (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia = undefined;

    const result = initializeDesignTokenPreferencesOnFirstRun();

    expect(result.source).toBe("system");
    expect(Object.keys(result.failedSystem).length).toBeGreaterThan(0);
    expect(result.traces.some((entry) => entry.status === "fallback")).toBe(true);

    window.matchMedia = originalMatchMedia;
  });

  it("falls back safely when local settings are corrupted", () => {
    window.localStorage.setItem("courseforge.designTokens.v1", "{invalid-json");

    const result = initializeDesignTokenPreferencesOnFirstRun();
    const diagnostics = readLocalDesignTokenDiagnostics();

    expect(result.source === "default" || result.source === "system").toBe(true);
    expect(result.traces.some((entry) => entry.step === "local-parse" && entry.status === "failure")).toBe(true);
    expect(diagnostics.corrupted).toBe(false);
  });

  it("validates and repairs malformed token fields", () => {
    const validation = validateDesignTokenPreferences({
      gamma: 9,
      typeRatio: 0,
      spacingRatio: 20,
      strokePreset: "invalid",
      semanticColors: { error: "bad", success: "bad", warning: "#ffaa00", info: "#2277bb", pending: "#ffaa00", new: "#2277bb" },
    });

    expect(validation.valid).toBe(false);
    expect(validation.invalidFields.length).toBeGreaterThan(0);
    expect(validation.repaired.gamma).toBe(2.6);
  });

  it("repairs from corrupted backup payload when possible", () => {
    window.localStorage.setItem(
      "courseforge.designTokens.corruptedBackup.v1",
      JSON.stringify({ gamma: 3.1, typeRatio: 1.4, spacingRatio: 1.5, motionTimingMs: 300, motionEasing: "ease-in-out", primaryHue: 180, strokePreset: "soft", semanticColors: { error: "#ff0000", success: "#00ff00", warning: "#ffaa00", info: "#2266ff", pending: "#ffaa00", new: "#2266ff" } })
    );

    const repaired = tryRepairCorruptedLocalDesignSettings();
    expect(repaired.success).toBe(true);
    expect(repaired.repaired.gamma).toBe(2.6);
    expect(repaired.invalidFields).toContain("gamma");
  });

  it("falls back when corrupted backup is unrepairable", () => {
    window.localStorage.setItem("courseforge.designTokens.corruptedBackup.v1", "{bad-json");
    const repaired = tryRepairCorruptedLocalDesignSettings();

    expect(repaired.success).toBe(false);
    expect(repaired.invalidFields).toContain("json");
  });

  it("resolves cloud decision options deterministically", () => {
    const local = sanitizeDesignTokenPreferences({ gamma: 2.1, typeRatio: 1.2 });
    const cloud = sanitizeDesignTokenPreferences({ gamma: 2.35, typeRatio: 1.333 });

    const apply = resolveCloudSettingsDecision({ local, cloud, decision: "apply-cloud" });
    const keep = resolveCloudSettingsDecision({ local, cloud, decision: "keep-local" });
    const merge = resolveCloudSettingsDecision({ local, cloud, decision: "merge-local-into-cloud" });
    const del = resolveCloudSettingsDecision({ local, cloud, decision: "delete-cloud-use-local-defaults" });

    expect(apply.nextLocal.gamma).toBe(cloud.gamma);
    expect(keep.nextLocal.gamma).toBe(local.gamma);
    expect(merge.cloudTarget?.gamma).toBe(local.gamma);
    expect(del.nextLocal.gamma).toBe(DEFAULT_DESIGN_TOKEN_PREFERENCES.gamma);
  });

  it("flags cloud payloads as corrupted when invalid", () => {
    const cloudValidation = validateDesignTokenPreferences({
      gamma: 8,
      semanticColors: {
        error: "oops",
        success: "#00ff00",
        warning: "#ffaa00",
        info: "#3366ff",
        pending: "#ffaa00",
        new: "#3366ff",
      },
    });

    expect(cloudValidation.valid).toBe(false);
    expect(cloudValidation.invalidFields).toContain("gamma");
    expect(cloudValidation.invalidFields).toContain("semanticColors.error");
  });
});

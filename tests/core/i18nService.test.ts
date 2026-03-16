import { describe, expect, it } from "vitest";

import { detectLanguage, t, translateTextOptional } from "../../src/core/services/i18nService";

describe("i18n service", () => {
  it("detects language by user preference first", () => {
    expect(detectLanguage({ userPreference: "fr-FR", osLocale: "es-ES", browserLanguage: "de-DE" })).toBe("fr");
  });

  it("falls back to english for unknown languages", () => {
    expect(detectLanguage({ browserLanguage: "ja-JP" })).toBe("en");
  });

  it("returns fallback english key when translation missing", () => {
    const text = t("es", "common", "appName");
    expect(text).toBe("CourseForge");
  });

  it("supports optional translation pipeline interface", async () => {
    const result = await translateTextOptional({ text: "Chapter 1", targetLanguage: "de" });
    expect(result.language).toBe("de");
    expect(result.provider).toBe("none");
    expect(result.translatedText).toBe("Chapter 1");
  });

  it("loads zomi starter strings", () => {
    expect(t("zm", "common", "save")).toBe("Kikem");
    expect(t("zm", "onboarding", "stepCover")).toBe("Laibu puhna lim la");
  });

  it("falls back to english for missing zomi keys", () => {
    expect(t("zm", "settings", "dyslexiaMode")).toBe("Enable Dyslexia Mode");
  });
});

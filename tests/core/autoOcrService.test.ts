import { beforeEach, describe, expect, it } from "vitest";

import {
  extractTextFromImageWithFallback,
  getAutoOcrProviderOrder,
  setAutoOcrProviderOrder,
  type AutoOcrProvider,
} from "../../src/core/services/autoOcrService";

describe("autoOcrService", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores and returns normalized provider order", () => {
    const next = setAutoOcrProviderOrder(["cloud_openai_vision", "local_tesseract"]);
    expect(next).toEqual(["cloud_openai_vision", "local_tesseract"]);
    expect(getAutoOcrProviderOrder()).toEqual(["cloud_openai_vision", "local_tesseract"]);
  });

  it("falls back to secondary provider when primary fails", async () => {
    const providers: AutoOcrProvider[] = [
      {
        id: "local_tesseract",
        label: "Local",
        isAvailable: async () => true,
        extractText: async () => {
          throw new Error("Local OCR failed");
        },
      },
      {
        id: "cloud_openai_vision",
        label: "Cloud",
        isAvailable: async () => true,
        extractText: async () => "Table of Contents\nChapter 1 Numbers",
      },
    ];

    const result = await extractTextFromImageWithFallback("data:image/png;base64,AAAA", {
      providerOrder: ["local_tesseract", "cloud_openai_vision"],
      providersOverride: providers,
    });

    expect(result.providerId).toBe("cloud_openai_vision");
    expect(result.text).toContain("Chapter 1");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[1].success).toBe(true);
  });

  it("throws when all providers fail", async () => {
    const providers: AutoOcrProvider[] = [
      {
        id: "local_tesseract",
        label: "Local",
        isAvailable: async () => false,
        extractText: async () => "",
      },
      {
        id: "cloud_openai_vision",
        label: "Cloud",
        isAvailable: async () => true,
        extractText: async () => {
          throw new Error("Cloud unavailable");
        },
      },
    ];

    await expect(extractTextFromImageWithFallback("data:image/png;base64,AAAA", {
      providerOrder: ["local_tesseract", "cloud_openai_vision"],
      providersOverride: providers,
    })).rejects.toThrow(/All OCR providers failed/i);
  });
});

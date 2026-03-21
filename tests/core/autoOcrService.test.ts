import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const callableMocks = vi.hoisted(() => ({
  getAiProviderStatus: vi.fn(),
  extractScreenshotText: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_client: unknown, callableName: string) => {
    const handler = callableMocks[callableName as keyof typeof callableMocks];
    return handler ?? vi.fn();
  },
}));

vi.mock("../../src/firebase/functions", () => ({
  functionsClient: {},
}));

import {
  clearAutoOcrAvailabilityCache,
  extractTextFromImageWithFallback,
  getAutoOcrProviderOrder,
  getAutoOcrProviderHealth,
  resetAutoOcrCircuitStateForTests,
  setAutoOcrProviderOrder,
  type AutoOcrProvider,
} from "../../src/core/services/autoOcrService";

const TEST_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2NcAAAAASUVORK5CYII=";

const OriginalImage = globalThis.Image;

beforeAll(() => {
  class InstantImage {
    naturalWidth = 1;
    naturalHeight = 1;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;

    set src(_value: string) {
      queueMicrotask(() => {
        this.onload?.();
      });
    }
  }

  globalThis.Image = InstantImage as unknown as typeof Image;
});

afterAll(() => {
  globalThis.Image = OriginalImage;
});

describe("autoOcrService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetAutoOcrCircuitStateForTests();
    clearAutoOcrAvailabilityCache();
    callableMocks.getAiProviderStatus.mockReset();
    callableMocks.extractScreenshotText.mockReset();
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

    const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["local_tesseract", "cloud_openai_vision"],
      providersOverride: providers,
    });

    expect(result.providerId).toBe("cloud_openai_vision");
    expect(result.text).toContain("Chapter 1");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[1].success).toBe(true);
  });

  it("uses backend provider status for cloud OCR health and execution", async () => {
    callableMocks.getAiProviderStatus.mockResolvedValue({
      data: {
        success: true,
        data: {
          providers: [
            { id: "cloud_openai_vision", available: true },
            { id: "local_tesseract", available: true },
          ],
        },
      },
    });
    const health = await getAutoOcrProviderHealth();
    expect(health).toEqual([
      {
        id: "local_tesseract",
        label: "Local OCR (Tesseract)",
        available: true,
        availabilityState: "available",
      },
      {
        id: "cloud_openai_vision",
        label: "Cloud OCR (OpenAI Vision via Firebase Function)",
        available: true,
        availabilityState: "available",
      },
    ]);

    const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["cloud_openai_vision", "local_tesseract"],
      providersOverride: [
        {
          id: "cloud_openai_vision",
          label: "Cloud OCR (OpenAI Vision via Firebase Function)",
          isAvailable: async () => true,
          extractText: async () => "Inspire Physical Science",
        },
        {
          id: "local_tesseract",
          label: "Local OCR (Tesseract)",
          isAvailable: async () => true,
          extractText: async () => "Fallback OCR",
        },
      ],
    });

    expect(result.providerId).toBe("cloud_openai_vision");
    expect(result.text).toContain("Inspire Physical Science");
  });

  it("caches provider availability status within the session TTL", async () => {
    callableMocks.getAiProviderStatus.mockResolvedValue({
      data: {
        success: true,
        data: {
          providers: [
            { id: "cloud_openai_vision", available: true },
            { id: "local_tesseract", available: true },
          ],
        },
      },
    });

    await getAutoOcrProviderHealth();
    await getAutoOcrProviderHealth();

    expect(callableMocks.getAiProviderStatus).toHaveBeenCalledTimes(1);
  });

  it("re-fetches provider availability after cache is cleared", async () => {
    callableMocks.getAiProviderStatus.mockResolvedValue({
      data: {
        success: true,
        data: {
          providers: [
            { id: "cloud_openai_vision", available: true },
            { id: "local_tesseract", available: true },
          ],
        },
      },
    });

    await getAutoOcrProviderHealth();
    clearAutoOcrAvailabilityCache();
    await getAutoOcrProviderHealth();

    expect(callableMocks.getAiProviderStatus).toHaveBeenCalledTimes(2);
  });

  it("bypasses cache when force refresh is requested", async () => {
    callableMocks.getAiProviderStatus
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            providers: [
              { id: "cloud_openai_vision", available: false },
              { id: "local_tesseract", available: true },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            providers: [
              { id: "cloud_openai_vision", available: true },
              { id: "local_tesseract", available: true },
            ],
          },
        },
      });

    const first = await getAutoOcrProviderHealth();
    const second = await getAutoOcrProviderHealth({ forceRefresh: true });

    expect(first.find((provider) => provider.id === "cloud_openai_vision")?.availabilityState).toBe("unavailable");
    expect(second.find((provider) => provider.id === "cloud_openai_vision")?.availabilityState).toBe("available");
    expect(callableMocks.getAiProviderStatus).toHaveBeenCalledTimes(2);
  });

  it("reports unknown health state when cloud status probe fails", async () => {
    callableMocks.getAiProviderStatus.mockRejectedValue(new Error("status probe failed"));

    const health = await getAutoOcrProviderHealth();
    const cloud = health.find((provider) => provider.id === "cloud_openai_vision");

    expect(cloud).toEqual({
      id: "cloud_openai_vision",
      label: "Cloud OCR (OpenAI Vision via Firebase Function)",
      available: false,
      availabilityState: "unknown",
    });
  });

  it("still attempts cloud OCR when provider status is temporarily unknown", async () => {
    callableMocks.getAiProviderStatus.mockRejectedValue(new Error("status probe failed"));
    callableMocks.extractScreenshotText.mockResolvedValue({
      data: {
        success: true,
        data: {
          text: "Teacher Edition\nEarth Science",
        },
      },
    });

    const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["cloud_openai_vision", "local_tesseract"],
    });

    expect(result.providerId).toBe("cloud_openai_vision");
    expect(result.attempts).toEqual([{ providerId: "cloud_openai_vision", success: true }]);
  });

  it("uses the local provider when cloud OCR is reported unavailable", async () => {
    callableMocks.getAiProviderStatus.mockResolvedValue({
      data: {
        success: true,
        data: {
          providers: [
            { id: "cloud_openai_vision", available: false },
            { id: "local_tesseract", available: true },
          ],
        },
      },
    });

    const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["cloud_openai_vision", "local_tesseract"],
      providersOverride: [
        {
          id: "local_tesseract",
          label: "Local OCR (Tesseract)",
          isAvailable: async () => true,
          extractText: async () => "Fallback TOC text",
        },
        {
          id: "cloud_openai_vision",
          label: "Cloud OCR (OpenAI Vision via Firebase Function)",
          isAvailable: async () => false,
          extractText: async () => "should not run",
        },
      ],
    });

    expect(result.providerId).toBe("local_tesseract");
    expect(result.attempts[0]).toEqual({
      providerId: "cloud_openai_vision",
      success: false,
      errorMessage: "Provider is not available in this environment.",
    });
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

    await expect(extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["local_tesseract", "cloud_openai_vision"],
      providersOverride: providers,
    })).rejects.toThrow(/All OCR providers failed/i);
  });
});

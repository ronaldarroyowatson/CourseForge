import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const callableMocks = vi.hoisted(() => ({
  getAiProviderStatus: vi.fn(),
  extractScreenshotText: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  waitForAuthStateChange: vi.fn(),
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

vi.mock("../../src/firebase/auth", () => ({
  getCurrentUser: authMocks.getCurrentUser,
  waitForAuthStateChange: authMocks.waitForAuthStateChange,
}));

vi.mock("tesseract.js", () => ({
  recognize: vi.fn(async () => ({
    data: {
      text: "Fallback text",
    },
  })),
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
const OriginalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

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
    fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    window.localStorage.clear();
    resetAutoOcrCircuitStateForTests();
    clearAutoOcrAvailabilityCache();
    callableMocks.getAiProviderStatus.mockReset();
    callableMocks.extractScreenshotText.mockReset();
    authMocks.getCurrentUser.mockReset();
    authMocks.waitForAuthStateChange.mockReset();
    authMocks.getCurrentUser.mockReturnValue({
      getIdToken: vi.fn(async () => "token"),
    });
    authMocks.waitForAuthStateChange.mockResolvedValue({
      getIdToken: vi.fn(async () => "token"),
    });
  });

  afterAll(() => {
    globalThis.fetch = OriginalFetch;
  });

  it("stores and returns normalized provider order", () => {
    const next = setAutoOcrProviderOrder(["cloud_openai_vision", "local_tesseract"]);
    expect(next).toEqual(["cloud_openai_vision", "cloud_github_models_vision", "local_tesseract"]);
    expect(getAutoOcrProviderOrder()).toEqual(["cloud_openai_vision", "cloud_github_models_vision", "local_tesseract"]);
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

  it("false-positive guard: does not attempt providers marked unavailable", async () => {
    const unavailableExtract = vi.fn(async () => "should-not-run");
    const cloudExtract = vi.fn(async () => "Valid OCR text");

    const providers: AutoOcrProvider[] = [
      {
        id: "local_tesseract",
        label: "Local",
        isAvailable: async () => false,
        extractText: unavailableExtract,
      },
      {
        id: "cloud_openai_vision",
        label: "Cloud",
        isAvailable: async () => true,
        extractText: cloudExtract,
      },
    ];

    const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["local_tesseract", "cloud_openai_vision"],
      providersOverride: providers,
    });

    expect(result.providerId).toBe("cloud_openai_vision");
    expect(unavailableExtract).not.toHaveBeenCalled();
    expect(cloudExtract).toHaveBeenCalledTimes(1);
  });

  it("false-negative guard: throws when all providers fail or are unavailable", async () => {
    const providers: AutoOcrProvider[] = [
      {
        id: "local_tesseract",
        label: "Local",
        isAvailable: async () => true,
        extractText: async () => {
          throw new Error("Local failed");
        },
      },
      {
        id: "cloud_openai_vision",
        label: "Cloud",
        isAvailable: async () => false,
        extractText: async () => "unused",
      },
    ];

    await expect(
      extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["local_tesseract", "cloud_openai_vision"],
        providersOverride: providers,
      })
    ).rejects.toThrow();
  });

  it("uses backend provider status for cloud OCR health and execution", async () => {
    callableMocks.getAiProviderStatus.mockResolvedValue({
      data: {
        success: true,
        data: {
          providers: [
            { id: "cloud_openai_vision", available: true, availabilityState: "available" },
            { id: "cloud_github_models_vision", available: true, availabilityState: "available" },
            { id: "local_tesseract", available: true },
          ],
        },
      },
    });
    const health = await getAutoOcrProviderHealth();
    expect(health).toHaveLength(3);
    expect(health.find((provider) => provider.id === "cloud_openai_vision")).toMatchObject({
      id: "cloud_openai_vision",
      label: "Cloud OCR (OpenAI Vision via Firebase Function)",
      available: true,
      availabilityState: "available",
    });
    expect(health.find((provider) => provider.id === "cloud_github_models_vision")).toMatchObject({
      id: "cloud_github_models_vision",
      label: "Cloud OCR (GitHub Models Vision via Firebase Function)",
      available: true,
      availabilityState: "available",
    });
    expect(health.find((provider) => provider.id === "local_tesseract")).toMatchObject({
      id: "local_tesseract",
      label: "Local OCR (Tesseract)",
      available: true,
      availabilityState: "available",
    });

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

  it("passes the original image to cloud OCR providers", async () => {
    const cloudExtract = vi.fn(async () => "Cloud OCR full page text");

    const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["cloud_openai_vision"],
      providersOverride: [
        {
          id: "cloud_openai_vision",
          label: "Cloud OCR (OpenAI Vision via Firebase Function)",
          isAvailable: async () => true,
          extractText: cloudExtract,
        },
      ],
    });

    expect(result.providerId).toBe("cloud_openai_vision");
    expect(cloudExtract).toHaveBeenCalledWith(TEST_IMAGE_DATA_URL);
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

  it("gates concurrent force-refresh health probes to a single status request", async () => {
    let resolveStatusProbe: (value: unknown) => void = () => {};
    callableMocks.getAiProviderStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatusProbe = resolve;
      })
    );

    const first = getAutoOcrProviderHealth({ forceRefresh: true });
    const second = getAutoOcrProviderHealth({ forceRefresh: true });

    expect(callableMocks.getAiProviderStatus).toHaveBeenCalledTimes(1);

    resolveStatusProbe({
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

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.find((provider) => provider.id === "cloud_openai_vision")?.availabilityState).toBe("available");
    expect(secondResult.find((provider) => provider.id === "cloud_openai_vision")?.availabilityState).toBe("available");
    expect(callableMocks.getAiProviderStatus).toHaveBeenCalledTimes(1);
  });

  it("reports unknown health state when cloud status probe fails", async () => {
    callableMocks.getAiProviderStatus.mockRejectedValue(new Error("status probe failed"));

    const health = await getAutoOcrProviderHealth();
    const cloud = health.find((provider) => provider.id === "cloud_openai_vision");

    expect(cloud).toMatchObject({
      id: "cloud_openai_vision",
      label: "Cloud OCR (OpenAI Vision via Firebase Function)",
      available: false,
      availabilityState: "unknown",
      errorMessage: "status probe failed",
    });
  });

  it("treats transient backend cloud probe failures as unknown and still attempts cloud OCR", async () => {
    callableMocks.getAiProviderStatus.mockResolvedValue({
      data: {
        success: true,
        data: {
          providers: [
            {
              id: "cloud_openai_vision",
              available: false,
              availabilityState: "unknown",
              reasonCode: "probe_timeout",
              reasonMessage: "OpenAI health probe timed out.",
              httpStatus: null,
            },
            { id: "local_tesseract", available: true },
          ],
        },
      },
    });

    const health = await getAutoOcrProviderHealth({ forceRefresh: true });
    const cloud = health.find((provider) => provider.id === "cloud_openai_vision");
    expect(cloud?.availabilityState).toBe("unknown");
    expect(cloud?.errorMessage).toBe("OpenAI health probe timed out.");

    callableMocks.extractScreenshotText.mockResolvedValue({
      data: {
        success: true,
        data: {
          text: "Chapter 2\nFractions",
        },
      },
    });

    const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["cloud_openai_vision", "local_tesseract"],
    });

    expect(result.providerId).toBe("cloud_openai_vision");
    expect(result.text).toContain("Fractions");
  });

  it("marks cloud provider unavailable when no authenticated user is present", async () => {
    authMocks.getCurrentUser.mockReturnValue(null);
    authMocks.waitForAuthStateChange.mockResolvedValue(null);

    const health = await getAutoOcrProviderHealth({ forceRefresh: true });
    const cloud = health.find((provider) => provider.id === "cloud_openai_vision");

    expect(cloud).toMatchObject({
      id: "cloud_openai_vision",
      label: "Cloud OCR (OpenAI Vision via Firebase Function)",
      available: false,
      availabilityState: "unavailable",
      errorMessage: "Sign in is required for Cloud OCR.",
    });
    expect(callableMocks.getAiProviderStatus).not.toHaveBeenCalled();
  });

  it("retries status callable after auth refresh when first attempt is unauthenticated", async () => {
    callableMocks.getAiProviderStatus
      .mockRejectedValueOnce({ code: "unauthenticated", message: "not authenticated" })
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

    const health = await getAutoOcrProviderHealth({ forceRefresh: true });
    const cloud = health.find((provider) => provider.id === "cloud_openai_vision");

    expect(cloud?.availabilityState).toBe("available");
    expect(callableMocks.getAiProviderStatus).toHaveBeenCalledTimes(2);
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

  it("uses GitHub cloud OCR when GitHub provider is healthy", async () => {
    callableMocks.getAiProviderStatus.mockResolvedValue({
      data: {
        success: true,
        data: {
          providers: [
            { id: "cloud_openai_vision", available: false, availabilityState: "unavailable", reasonCode: "auth_failed", reasonMessage: "OpenAI auth failed" },
            { id: "cloud_github_models_vision", available: true, availabilityState: "available" },
            { id: "local_tesseract", available: true },
          ],
        },
      },
    });
    callableMocks.extractScreenshotText.mockImplementation(async (payload?: { providerId?: string }) => {
      expect(payload?.providerId).toBe("cloud_github_models_vision");
      return {
        data: {
          success: true,
          data: {
            text: "Inspire Physical Science\nwith Earth Science",
          },
        },
      };
    });

    const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["cloud_github_models_vision", "local_tesseract"],
    });

    expect(result.providerId).toBe("cloud_github_models_vision");
    expect(result.text).toContain("Inspire Physical Science");
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

    await expect(extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
      providerOrder: ["local_tesseract", "cloud_openai_vision"],
      providersOverride: providers,
    })).rejects.toThrow(/\[ocr-fallback-/i);
  });

  describe("cloud OCR Firebase callable response handling", () => {
    const cloudProvider = {
      id: "cloud_openai_vision" as const,
      label: "Cloud",
      isAvailable: async () => true,
      extractText: async () => {
        const callable = (callableMocks.extractScreenshotText as unknown as () => Promise<unknown>);
        const response = await callable();
        const payload = response as { data?: { success?: boolean; data?: { text?: string }; message?: string } };
        if (!payload?.data?.success || !payload?.data?.data?.text) {
          const message = (payload?.data?.message as string) || "Invalid payload";
          throw new Error(message);
        }
        return (payload.data.data.text as string).trim();
      },
    };

    const localProvider = {
      id: "local_tesseract" as const,
      label: "Local",
      isAvailable: async () => true,
      extractText: async () => "Fallback text",
    };

    it("fallsback to local when callable returns success=false", async () => {
      callableMocks.extractScreenshotText.mockResolvedValue({
        data: {
          success: false,
          message: "OpenAI API rate limited",
        },
      });

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision", "local_tesseract"],
        providersOverride: [cloudProvider, localProvider],
      });

      expect(result.providerId).toBe("local_tesseract");
      expect(result.attempts[0].success).toBe(false);
    });

    it("fallsback to local when callable returns missing text field", async () => {
      callableMocks.extractScreenshotText.mockResolvedValue({
        data: {
          success: true,
          data: { text: undefined },
        },
      });

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision", "local_tesseract"],
        providersOverride: [cloudProvider, localProvider],
      });

      expect(result.providerId).toBe("local_tesseract");
      expect(result.attempts[0].success).toBe(false);
    });

    it("fallsback to local when callable returns null data object", async () => {
      callableMocks.extractScreenshotText.mockResolvedValue({
        data: { success: true, data: null },
      });

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision", "local_tesseract"],
        providersOverride: [cloudProvider, localProvider],
  });

      expect(result.providerId).toBe("local_tesseract");
    });

    it("fallsback to local when callable returns whitespace-only text", async () => {
      callableMocks.extractScreenshotText.mockResolvedValue({
        data: {
          success: true,
          data: { text: "   \n\n  \t  " },
        },
      });

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision", "local_tesseract"],
        providersOverride: [cloudProvider, localProvider],
      });

      expect(result.providerId).toBe("local_tesseract");
    });

    it("fallsback to local when callable throws HttpsError", async () => {
      callableMocks.extractScreenshotText.mockRejectedValue({
        code: "internal",
        message: "Cloud OCR provider error: 429 Too Many Requests",
      });

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision", "local_tesseract"],
        providersOverride: [cloudProvider, localProvider],
      });

      expect(result.providerId).toBe("local_tesseract");
      expect(result.attempts[0].success).toBe(false);
    });

    it("marks cloud health unavailable after cloud authentication failures", async () => {
      callableMocks.getAiProviderStatus.mockResolvedValue({
        data: {
          success: true,
          data: {
            providers: [
              { id: "cloud_openai_vision", available: true, availabilityState: "available" },
              { id: "cloud_github_models_vision", available: false, availabilityState: "unavailable", reasonCode: "missing_github_models_token", reasonMessage: "GitHub Models token missing" },
              { id: "local_tesseract", available: true },
            ],
          },
        },
      });

      callableMocks.extractScreenshotText.mockRejectedValue({
        code: "internal",
        message: "Cloud OCR provider error: 401 Unauthorized",
        details: {
          reasonCode: "auth_failed",
          reasonMessage: "OpenAI rejected credentials",
          failureStage: "provider_response",
          traceId: "ocr-cloud-openai-auth",
        },
      });

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision", "local_tesseract"],
      });

      expect(result.providerId).toBe("local_tesseract");

      callableMocks.getAiProviderStatus.mockReset();
      const health = await getAutoOcrProviderHealth();
      const cloud = health.find((provider) => provider.id === "cloud_openai_vision");

      expect(cloud?.availabilityState).toBe("unavailable");
      expect(cloud?.errorMessage).toContain("OpenAI rejected credentials");
      expect(callableMocks.getAiProviderStatus).not.toHaveBeenCalled();
    });

    it("emits cloud failure diagnostics to local OCR log endpoint", async () => {
      callableMocks.extractScreenshotText.mockRejectedValue({
        code: "internal",
        message: "Cloud OCR provider error: 429 Too Many Requests",
      });

      await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision", "local_tesseract"],
        providersOverride: [cloudProvider, localProvider],
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const postedBodies = fetchMock.mock.calls
        .filter((call) => call[0] === "/api/ocr-debug-log")
        .map((call) => {
          const init = call[1] as RequestInit | undefined;
          return typeof init?.body === "string" ? JSON.parse(init.body) as { event?: string } : {};
        });

      expect(
        postedBodies.some((body) => body.event === "provider_extract_failed" || body.event === "cloud_extract_callable_failed")
      ).toBe(true);
    });

    it("fallsback to local when callable throws network error", async () => {
      callableMocks.extractScreenshotText.mockRejectedValue(
        new Error("Failed to fetch from OpenAI")
      );

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision", "local_tesseract"],
        providersOverride: [cloudProvider, localProvider],
      });

      expect(result.providerId).toBe("local_tesseract");
      expect(result.attempts[0].success).toBe(false);
    });

    it("succeeds when callable returns valid text response", async () => {
      const expectedText = "Chapter 1\nIntroduction";
      callableMocks.extractScreenshotText.mockResolvedValue({
        data: {
          success: true,
          data: { text: expectedText },
        },
      });

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision"],
        providersOverride: [cloudProvider],
      });

      expect(result.providerId).toBe("cloud_openai_vision");
      expect(result.text).toBe(expectedText);
      expect(result.attempts[0].success).toBe(true);
    });

    it("trims whitespace from valid callable response", async () => {
      callableMocks.extractScreenshotText.mockResolvedValue({
        data: {
          success: true,
          data: { text: "  Chapter 1  \n" },
        },
      });

      const result = await extractTextFromImageWithFallback(TEST_IMAGE_DATA_URL, {
        providerOrder: ["cloud_openai_vision"],
        providersOverride: [cloudProvider],
      });

      expect(result.text).toBe("Chapter 1");
    });
  });
});

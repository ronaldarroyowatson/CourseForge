import { beforeEach, describe, expect, it, vi } from "vitest";

const callableMock = vi.fn();
const ocrMock = vi.fn();

vi.mock("firebase/functions", () => ({
  httpsCallable: () => callableMock,
}));

vi.mock("../../src/core/services/autoOcrService", () => ({
  extractTextFromImageWithFallback: (...args: unknown[]) => ocrMock(...args),
}));

vi.mock("../../src/firebase/functions", () => ({
  functionsClient: {},
}));

import { extractMetadataWithOcrFallbackFromDataUrl } from "../../src/core/services/metadataExtractionPipelineService";

describe("metadataExtractionPipelineService", () => {
  beforeEach(() => {
    callableMock.mockReset();
    ocrMock.mockReset();
    window.localStorage.clear();
  });

  it("returns vision metadata when confidence is high", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Algebra 1",
            publisher: "Northbridge Press",
            confidence: 0.91,
            rawText: "Algebra 1",
          },
        },
      },
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "cover", publisherHint: null }
    );

    expect(result.result.source).toBe("vision");
    expect(result.result.title).toBe("Algebra 1");
    expect(ocrMock).not.toHaveBeenCalled();
  });

  it("falls back to OCR when vision response is low confidence", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "",
            publisher: "Mc Graw Hill",
            confidence: 0.3,
            rawText: "mc graw hill",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: "Mc Graw Hill\nTeacher S Edition\nMathematics",
      providerId: "local_tesseract",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "McGraw Hill" }
    );

    expect(ocrMock).toHaveBeenCalledTimes(1);
    expect(result.result.source).toBe("ocr");
    expect(result.originalOcrOutput?.providerId).toBe("local_tesseract");
    expect(result.result.title).toBeTruthy();
  });
});

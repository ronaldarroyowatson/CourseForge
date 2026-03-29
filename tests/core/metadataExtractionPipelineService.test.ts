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

  it("cross-validates a high-confidence vision subject against screenshot raw text", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Inspire Physical Science",
            subtitle: "with Earth Science",
            publisher: "McGraw-Hill Education",
            subject: "ELA",
            confidence: 0.93,
            rawText: [
              "Inspire Physical Science",
              "with Earth Science",
              "mheducation.com/prek-12",
              "McGraw Hill",
              "Science, Technology, Engineering, and Mathematics (STEM)",
              "Copyright © 2021 McGraw-Hill Education",
              "ISBN: 978-0-07-671685-2",
              "MHID: 0-07-671685-6",
            ].join("\n"),
          },
        },
      },
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "McGraw-Hill Education" }
    );

    expect(result.result.source).toBe("vision");
    expect(result.result.subject).toBe("Science");
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

  it("falls back to OCR when vision misses required metadata fields", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "",
            publisher: "Northbridge Press",
            confidence: 0.95,
            rawText: "Northbridge Press",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: "Algebra Foundations\nNorthbridge Press",
      providerId: "local_tesseract",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "Northbridge Press" }
    );

    expect(ocrMock).toHaveBeenCalledTimes(1);
    expect(result.result.source).toBe("ocr");
    expect(result.result.title).toBeTruthy();
  });

  it("merges vision and OCR metadata when vision is below threshold", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Algebra",
            subtitle: null,
            publisher: null,
            confidence: 0.5,
            rawText: "Algebra",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: "Algebra\nNorthbridge Press\nGrade 8",
      providerId: "local_tesseract",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "cover", publisherHint: null }
    );

    expect(result.result.source).toBe("vision+ocr");
    expect(result.result.title).toBe("Algebra");
    expect(result.result.publisher).toBeTruthy();
    expect(result.originalVisionOutput).not.toBeNull();
    expect(result.originalOcrOutput?.providerId).toBe("local_tesseract");
  });

  it("preserves richer copyright-page metadata when merging vision and OCR", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Inspire Physical Science with Earth Science",
            publisher: "McGraw-Hill Education",
            confidence: 0.41,
            rawText: "Inspire",
            copyrightYear: 2021,
            platformUrl: "https://mheducation.com/prek-12",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: [
        "Inspire Physical Science with Earth Science",
        "ISBN: 978-0-07-671685-2",
        "Teacher ISBN: 978-0-07-671700-2",
        "MHID: 0-07-671685-6",
        "Columbus, OH 43240",
      ].join("\n"),
      providerId: "local_tesseract",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "McGraw-Hill Education" }
    );

    expect(result.result.source).toBe("vision+ocr");
    expect(result.result.copyrightYear).toBe(2021);
    expect(result.result.platformUrl).toBe("https://mheducation.com/prek-12");
    expect(result.result.isbn).toBe("9780076716852");
    expect(result.result.relatedIsbns).toEqual([
      expect.objectContaining({ isbn: "9780076717002", type: "teacher" }),
    ]);
    expect(result.result.mhid).toBe("0-07-671685-6");
  });

  it("falls back to OCR when vision callable throws", async () => {
    callableMock.mockRejectedValue(new Error("vision unavailable"));
    ocrMock.mockResolvedValue({
      text: "Earth Science\nNorthbridge Press",
      providerId: "cloud_openai_vision",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "cover", publisherHint: null }
    );

    expect(ocrMock).toHaveBeenCalledTimes(1);
    expect(result.result.source).toBe("ocr");
    expect(result.originalVisionOutput).toBeNull();
    expect(result.originalOcrOutput?.providerId).toBe("cloud_openai_vision");
  });

  it("preserves raw OCR and returns parsed metadata for downstream form mapping", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "",
            subject: "",
            publisher: "",
            confidence: 0.2,
            rawText: "",
          },
        },
      },
    });

    const rawOcrText = [
      "Inspire Physical Science",
      "with Earth Science",
      "McGraw Hill Education",
      "Student Edition",
      "Grade 8",
      "ISBN: 978-0-07-671685-2",
    ].join("\n");

    ocrMock.mockResolvedValue({
      text: rawOcrText,
      providerId: "cloud_openai_vision",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "cover", publisherHint: null }
    );

    expect(result.originalOcrOutput?.rawText).toBe(rawOcrText);
    expect(result.originalOcrOutput?.providerId).toBe("cloud_openai_vision");
    expect(result.result.title).toContain("Inspire Physical Science");
    expect(result.result.subject).toBe("Science");
    expect(result.result.publisher).toContain("McGraw");
    expect(result.result.isbn).toBe("9780076716852");
  });
});

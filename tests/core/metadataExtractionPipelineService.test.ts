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

import {
  extractMetadataWithOcrFallbackFromDataUrl,
  readMetadataPipelineRuntimeStatus,
} from "../../src/core/services/metadataExtractionPipelineService";

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

  it("persists pipeline runtime telemetry for OCR fallback path", async () => {
    callableMock.mockRejectedValue(new Error("vision unavailable"));
    ocrMock.mockResolvedValue({
      text: "Inspire Physical Science\nwith Earth Science\nISBN: 978-0-07-671685-2",
      providerId: "cloud_openai_vision",
    });

    await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "McGraw-Hill Education" }
    );

    const runtime = readMetadataPipelineRuntimeStatus();
    expect(runtime.pageType).toBe("title");
    expect(runtime.stage).toBe("completed");
    expect(runtime.path).toBe("ocr_only");
    expect(runtime.secondaryAgent.attempted).toBe(true);
    expect(runtime.secondaryAgent.succeeded).toBe(false);
    expect(runtime.ocr.providerId).toBe("cloud_openai_vision");
    expect(runtime.ocr.rawTextLength).toBeGreaterThan(10);
    expect(runtime.parsedFieldsCount).toBeGreaterThan(0);
    expect(runtime.parsedFields).toContain("title");
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

  // Phase 2: Enhanced Metadata Parsing Agent Tests
  describe("Phase 2: Vision agent field mapping and validation", () => {
    it("correctly maps ISBN from vision model output with hyphens", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "The Nature of Science",
              isbn: "978-0-07-671685-2",  // With hyphens - should be normalized by sanitization
              confidence: 0.85,
              rawText: "The Nature of Science\nISBN: 978-0-07-671685-2",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null }
      );

      // Should normalize to 13-digit ISBN without hyphens via sanitizeMetadataResult
      expect(result.result.isbn).toBe("9780076716852");
    });

    it("correctly maps ISBN from vision model output without formatting", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Algebra",
              isbn: "9780076716852",  // No hyphens - should pass through
              confidence: 0.85,
              rawText: "Algebra\n9780076716852",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null }
      );

      expect(result.result.isbn).toBe("9780076716852");
    });

    it("correctly maps copyrightYear when vision returns it as a number", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Science Textbook",
              copyrightYear: 2021,  // As number
              confidence: 0.85,
              rawText: "Copyright © 2021",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null }
      );

      expect(result.result.copyrightYear).toBe(2021);
    });

    it("correctly maps copyrightYear when vision returns it as a string", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Science Textbook",
              copyrightYear: "2021",  // As string - sanitization should convert to number
              confidence: 0.85,
              rawText: "Copyright © 2021",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null }
      );

      // Sanitization should convert string to number
      expect(result.result.copyrightYear).toBe(2021);
    });

    it("correctly maps publisherLocation from vision model output", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Inspire Physical Science",
              publisher: "McGraw-Hill Education",
              publisherLocation: "8787 Orion Place\nColumbus, OH 43240",
              confidence: 0.85,
              rawText: "Inspire Physical Science\nMcGraw-Hill Education\n8787 Orion Place\nColumbus, OH 43240",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: "McGraw-Hill Education" }
      );

      expect(result.result.publisherLocation).toBeDefined();
      expect(result.result.publisherLocation).toContain("Columbus, OH 43240");
    });

    it("correctly maps platformUrl from vision model output", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Science Textbook",
              platformUrl: "https://mheducation.com/prek-12",
              confidence: 0.85,
              rawText: "mheducation.com/prek-12",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null }
      );

      expect(result.result.platformUrl).toBe("https://mheducation.com/prek-12");
    });

    it("correctly handles multiple related ISBNs with types", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Inspire Physical Science",
              isbn: "9780076716852",  // Already normalized
              relatedIsbns: [
                { isbn: "978-0-07-671700-2", type: "teacher", note: "Teacher Edition" },
                { isbn: "978-0-07-671722-4", type: "digital", note: "Online Access" },
              ],
              confidence: 0.85,
              rawText: "ISBNs listed",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null }
      );

      expect(result.result.isbn).toBe("9780076716852");
      expect(result.result.relatedIsbns).toHaveLength(2);
      expect(result.result.relatedIsbns).toContainEqual(
        expect.objectContaining({ isbn: "9780076717002", type: "teacher" })
      );
    });

    it("normalizes ISBNs in additionalIsbns array", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Textbook",
              isbn: "9780076716852",
              additionalIsbns: [
                "978-0-07-671700-2",  // With hyphens - should be normalized
                "978-0-07-671722-4",  // With hyphens - should be normalized
              ],
              confidence: 0.85,
              rawText: "Multiple ISBNs",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null }
      );

      expect(result.result.additionalIsbns).toEqual([
        "9780076717002",  // Normalized
        "9780076717224",  // Normalized
      ]);
    });

    it("handles malformed ISBN in related ISBNs (filters invalid ones)", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Textbook",
              isbn: "9780076716852",
              relatedIsbns: [
                { isbn: "978-0-07-671700-2", type: "teacher" },
                { isbn: "invalid-isbn-123", type: "digital" },  // Invalid - should be filtered
                { isbn: "9780076717222", type: "workbook" },
              ],
              confidence: 0.85,
              rawText: "ISBNs with one invalid",
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null }
      );

      // Should filter out the invalid ISBN (less than 10 digits after normalization)
      expect(result.result.relatedIsbns?.length).toBeLessThanOrEqual(2);
      expect(result.result.relatedIsbns?.some((x) => x.isbn === "9780076717222")).toBe(true);
    });
  });
});

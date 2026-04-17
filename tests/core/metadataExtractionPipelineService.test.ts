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

    const runtime = readMetadataPipelineRuntimeStatus();
    expect(runtime.path).toBe("vision_only");
    expect(runtime.stage).toBe("completed");
    expect(runtime.ocr.attemptCount).toBe(0);
    expect(runtime.secondaryAgent.lastError).toBeNull();
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
              "Copyright Â© 2021 McGraw-Hill Education",
              "ISBN: 978-0-07-671685-2",
              "MHID: 0-07-671685-6",
            ].join("\n"),
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: [
        "Inspire Physical Science",
        "with Earth Science",
        "mheducation.com/prek-12",
        "Copyright Â© 2021 McGraw-Hill Education",
      ].join("\n"),
      providerId: "cloud_openai_vision",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "McGraw-Hill Education" }
    );

    expect(result.result.source).toBe("vision+ocr");
    expect(result.result.subject).toBe("Science");
    expect(ocrMock).toHaveBeenCalledTimes(1);
  });

  it("clears subject when vision claims a subject but OCR text has no matching evidence", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Student Edition",
            publisher: "Unknown Publisher",
            subject: "ELA",
            confidence: 0.92,
            rawText: "Student Edition\nLevel 3\nWorkbook",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: "Student Edition\nLevel 3\nWorkbook",
      providerId: "cloud_openai_vision",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: null }
    );

    expect(result.result.subject).toBeNull();
  });

  it("prefers OCR-derived subject when vision subject conflicts", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Algebra Foundations",
            publisher: "Northbridge Press",
            subject: "Science",
            confidence: 0.88,
            rawText: "Algebra Foundations\nMathematics\nChapter 1 Numbers",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: "Algebra Foundations\nMathematics\nChapter 1 Numbers",
      providerId: "cloud_github_models_vision",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: null }
    );

    expect(result.result.subject).toBe("Math");
  });

  it("clears ELA when vision claims ELA but raw text only mentions reading or writing generically", async () => {
    // Regression: a single occurrence of "reading" used to pass hasSubjectEvidence("ELA")
    // allowing the vision "ELA" claim to survive even when OCR couldn't confirm ELA.
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Interactive Student Notebook",
            publisher: "McGraw-Hill Education",
            subject: "ELA",
            confidence: 0.91,
            rawText: "Interactive Student Notebook\nReading Support\nGrade 7\nMcGraw-Hill Education",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: "Interactive Student Notebook\nReading Support\nGrade 7\nMcGraw-Hill Education",
      providerId: "cloud_openai_vision",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "cover", publisherHint: null }
    );

    // Vision said "ELA" but the raw text only has "reading" once — not enough ELA-specific evidence.
    expect(result.result.subject).toBeNull();
  });

  it("enriches high-confidence title-page vision output with OCR backfill for missing MHID/copyright fields", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "The Methods of Science",
            subtitle: "Student Edition",
            publisher: "McGraw-Hill Education",
            confidence: 0.95,
            rawText: "The Methods of Science\nStudent Edition",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: [
        "Copyright Â© 2021 McGraw-Hill Education",
        "ISBN: 978-0-07-671685-2",
        "MHID: 0-07-671685-6",
      ].join("\n"),
      providerId: "cloud_github_models_vision",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "McGraw-Hill Education" }
    );

    expect(ocrMock).toHaveBeenCalledTimes(1);
    expect(result.result.source).toBe("vision+ocr");
    expect(result.result.copyrightYear).toBe(2021);
    expect(result.result.mhid).toBe("0-07-671685-6");
    expect(result.result.isbn).toBe("9780076716852");
  });

  it("infers grade level from platform URL for high-confidence vision-only metadata", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Inspire Physical Science",
            publisher: "McGraw-Hill Education",
            confidence: 0.93,
            platformUrl: "mheducation.com/prek-12",
            rawText: "Inspire Physical Science\nmheducation.com/prek-12",
          },
        },
      },
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "cover", publisherHint: "McGraw-Hill Education" }
    );

    expect(result.result.source).toBe("vision");
    expect(result.result.gradeLevel).toBe("Pre-K-12");
    expect(ocrMock).not.toHaveBeenCalled();
  });

  it("forces OCR fallback for copyright-like pages when vision misses critical fields", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "STEM",
            publisher: "McGraw-Hill Education",
            confidence: 0.96,
            copyrightYear: "2021",
            rawText: [
              "Copyright 2021 McGraw-Hill Education",
              "All rights reserved. No part of this publication may be reproduced.",
              "Send all inquiries to:",
              "mheducation.com/prek-12",
              "STEM",
            ].join("\n"),
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: [
        "mheducation.com/prek-12",
        "Send all inquiries to:",
        "McGraw-Hill Education",
        "STEM Learning Solutions Center",
        "8787 Orion Place",
        "Columbus, OH 43240",
        "ISBN: 978-0-07-671685-2",
        "Copyright Â© 2021 McGraw-Hill Education",
      ].join("\n"),
      providerId: "cloud_github_models_vision",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "McGraw-Hill Education" }
    );

    expect(ocrMock).toHaveBeenCalledTimes(1);
    expect(result.result.source).toBe("vision+ocr");
    expect(result.result.isbn).toBe("9780076716852");
    expect(result.result.publisherLocation).toContain("Columbus, OH 43240");
    expect(result.result.platformUrl).toContain("mheducation.com/prek-12");
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

    expect(ocrMock).toHaveBeenCalledTimes(3);
    expect(result.result.source).toBe("ocr");
    expect(result.originalOcrOutput?.providerId).toBe("local_tesseract");
    expect(result.result.title).toBeTruthy();

    const runtime = readMetadataPipelineRuntimeStatus();
    expect(runtime.path).toBe("ocr_only");
    expect(runtime.stage).toBe("completed");
    expect(runtime.ocr.attemptCount).toBe(3);
    expect(runtime.ocr.providerId).toBe("local_tesseract");
  });

  it("false-positive guard: does not trigger OCR fallback for valid high-confidence vision metadata", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "Biology Foundations",
            publisher: "CourseForge Press",
            confidence: 0.89,
            rawText: "Biology Foundations",
          },
        },
      },
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "cover", publisherHint: null }
    );

    expect(result.result.source).toBe("vision");
    expect(ocrMock).not.toHaveBeenCalled();
  });

  it("false-negative guard: detects invalid vision payload and activates OCR fallback", async () => {
    callableMock.mockResolvedValue({
      data: {
        success: true,
        data: {
          metadata: {
            title: "",
            publisher: "",
            confidence: 0.95,
            rawText: "",
          },
        },
      },
    });

    ocrMock.mockResolvedValue({
      text: "Chemistry Student Edition",
      providerId: "local_tesseract",
    });

    const result = await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: null }
    );

    expect(result.result.source).toBe("ocr");
    expect(ocrMock).toHaveBeenCalledTimes(3);
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

    expect(ocrMock).toHaveBeenCalledTimes(3);
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

    expect(ocrMock).toHaveBeenCalledTimes(3);
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

  it("emits comprehensive trace records across vision failure, OCR fallback, and field mapping", async () => {
    callableMock.mockRejectedValue(new Error("vision unavailable"));
    ocrMock.mockResolvedValue({
      text: [
        "Inspire Physical Science",
        "with Earth Science",
        "McGraw Hill Education",
        "ISBN: 978-0-07-671685-2",
      ].join("\n"),
      providerId: "cloud_openai_vision",
    });

    const records: Array<{ component: string; action: string; severity?: string }> = [];

    await extractMetadataWithOcrFallbackFromDataUrl(
      "data:image/png;base64,AAA",
      { pageType: "title", publisherHint: "McGraw-Hill Education" },
      {
        traceRecorder: (record) => {
          records.push({ component: record.component, action: record.action, severity: record.severity });
        },
      }
    );

    expect(records.some((record) => record.component === "pipeline" && record.action === "started")).toBe(true);
    expect(records.some((record) => record.component === "vision" && record.action === "request_failed")).toBe(true);
    expect(records.some((record) => record.component === "ocr" && record.action === "request_started")).toBe(true);
    expect(records.some((record) => record.component === "ocr" && record.action === "request_succeeded")).toBe(true);
    expect(records.some((record) => record.component === "mapping" && record.action === "field_mapping_completed")).toBe(true);
    expect(records.some((record) => record.component === "pipeline" && record.action === "completed")).toBe(true);
  });

  it("records repeated OCR communication failures in trace output", async () => {
    callableMock.mockRejectedValue(new Error("vision unavailable"));
    ocrMock.mockRejectedValue(new Error("ocr timeout"));

    const records: Array<{ component: string; action: string; severity?: string }> = [];

    await expect(
      extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: null },
        {
          traceRecorder: (record) => {
            records.push({ component: record.component, action: record.action, severity: record.severity });
          },
        }
      )
    ).rejects.toThrow("ocr timeout");

    const ocrFailures = records.filter((record) => record.component === "ocr" && record.action === "request_failed");
    expect(ocrFailures.length).toBeGreaterThanOrEqual(1);
    expect(records.some((record) => record.component === "vision" && record.action === "request_failed")).toBe(true);
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
              rawText: "Copyright Â© 2021",
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
              rawText: "Copyright Â© 2021",
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Permanent validation suite: McGraw-Hill copyright page â€” pipeline path
  // Verifies Agent A (OCR) output flows correctly through Agent B (vision/parser)
  // and populates all required metadata fields every time.
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe("McGraw-Hill copyright page â€” pipeline permanent validation", () => {
    const MCGRAW_FULL_OCR_TEXT = [
      "mheducation.com/prek-12",
      "McGraw Hill",
      "Copyright Â© 2021 McGraw-Hill Education",
      "All rights reserved. No part of this publication may be reproduced or distributed in any form or by any means, or stored in a database or retrieval system, without the prior written consent of McGraw-Hill Education, including, but not limited to, network storage or transmission, or broadcast for distance learning.",
      "Send all inquiries to:",
      "McGraw-Hill Education",
      "STEM Learning Solutions Center",
      "8787 Orion Place",
      "Columbus, OH 43240",
      "ISBN: 978-0-07-671685-2",
      "MHID: 0-07-671685-6",
      "Printed in the United States of America.",
      "3 4 5 6 7 8 LWI 24 23 22 21",
      "STEM",
      "McGraw-Hill is committed to providing instructional materials in Science, Technology, Engineering, and Mathematics (STEM) that give all students a solid foundation, one that prepares them for college and careers in the 21st century.",
    ].join("\n");

    it("pipeline (vision low-confidence â†’ OCR fallback): extracts isbn from copyright page", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: { title: "", confidence: 0.2, rawText: "" },
          },
        },
      });
      ocrMock.mockResolvedValue({ text: MCGRAW_FULL_OCR_TEXT, providerId: "cloud_openai_vision" });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: "McGraw-Hill Education" }
      );

      expect(result.result.isbn).toBe("9780076716852");
    });

    it("pipeline (vision low-confidence â†’ OCR fallback): extracts copyrightYear from copyright page", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: { title: "", confidence: 0.2, rawText: "" },
          },
        },
      });
      ocrMock.mockResolvedValue({ text: MCGRAW_FULL_OCR_TEXT, providerId: "cloud_openai_vision" });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: "McGraw-Hill Education" }
      );

      expect(result.result.copyrightYear).toBe(2021);
    });

    it("pipeline (vision low-confidence â†’ OCR fallback): extracts platformUrl from copyright page", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: { title: "", confidence: 0.2, rawText: "" },
          },
        },
      });
      ocrMock.mockResolvedValue({ text: MCGRAW_FULL_OCR_TEXT, providerId: "cloud_openai_vision" });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: "McGraw-Hill Education" }
      );

      expect(result.result.platformUrl).toBe("https://mheducation.com/prek-12");
    });

    it("pipeline (vision low-confidence â†’ OCR fallback): extracts gradeBand from copyright page URL", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: { title: "", confidence: 0.2, rawText: "" },
          },
        },
      });
      ocrMock.mockResolvedValue({ text: MCGRAW_FULL_OCR_TEXT, providerId: "cloud_openai_vision" });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: "McGraw-Hill Education" }
      );

      expect(result.result.gradeLevel).toBe("Pre-K-12");
    });

    it("pipeline (vision low-confidence â†’ OCR fallback): extracts publisherLocation from copyright page", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: { title: "", confidence: 0.2, rawText: "" },
          },
        },
      });
      ocrMock.mockResolvedValue({ text: MCGRAW_FULL_OCR_TEXT, providerId: "cloud_openai_vision" });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: "McGraw-Hill Education" }
      );

      expect(result.result.publisherLocation).toBeDefined();
      expect(result.result.publisherLocation).toContain("Columbus, OH 43240");
    });

    it("pipeline (vision succeeds with all fields): isbn, copyrightYear, platformUrl, gradeBand all set", async () => {
      callableMock.mockResolvedValue({
        data: {
          success: true,
          data: {
            metadata: {
              title: "Inspire Physical Science",
              publisher: "McGraw-Hill Education",
              isbn: "978-0-07-671685-2",
              copyrightYear: "2021",
              platformUrl: "mheducation.com/prek-12",
              publisherLocation: "McGraw-Hill Education\nSTEM Learning Solutions Center\n8787 Orion Place\nColumbus, OH 43240",
              gradeLevel: "Pre-K-12",
              confidence: 0.92,
              rawText: MCGRAW_FULL_OCR_TEXT,
            },
          },
        },
      });

      const result = await extractMetadataWithOcrFallbackFromDataUrl(
        "data:image/png;base64,AAA",
        { pageType: "title", publisherHint: "McGraw-Hill Education" }
      );

      expect(result.result.isbn).toBe("9780076716852");
      expect(result.result.copyrightYear).toBe(2021);
      expect(result.result.platformUrl).toContain("mheducation.com/prek-12");
      expect(result.result.publisherLocation).toContain("Columbus, OH 43240");
    });
  });
});

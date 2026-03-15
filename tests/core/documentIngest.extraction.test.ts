import { beforeEach, describe, expect, it, vi } from "vitest";

const firebaseFunctionMocks = vi.hoisted(() => {
  const callableMock = vi.fn();
  const httpsCallableMock = vi.fn(() => callableMock);

  return {
    callableMock,
    httpsCallableMock,
  };
});

vi.mock("firebase/functions", () => ({
  httpsCallable: firebaseFunctionMocks.httpsCallableMock,
}));

vi.mock("../../src/firebase/functions", () => ({
  functionsClient: { app: "test-functions-client" },
}));

import { extractFromDocument, extractFromDocuments, isSupportedDocumentType, mergeExtractedDocuments } from "../../src/core/services/documentIngestService";

describe("documentIngestService.extractFromDocument", () => {
  beforeEach(() => {
    firebaseFunctionMocks.callableMock.mockReset();
    firebaseFunctionMocks.httpsCallableMock.mockClear();
  });

  it("reads TXT files locally and returns all extracted data groups", async () => {
    firebaseFunctionMocks.callableMock.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        data: {
          vocab: ["photosynthesis", "chlorophyll"],
          concepts: ["energy transfer"],
          equations: ["6CO2 + 6H2O -> C6H12O6 + 6O2"],
          namesAndDates: [{ name: "Jan Ingenhousz", date: "1779" }],
          keyIdeas: ["Plants convert light into chemical energy."],
          quality: {
            accepted: true,
            documentType: "lesson",
            detectedLanguage: "english",
            questionAnswerLayouts: [],
            issues: [],
          },
        },
      },
    });

    const file = new File(
      ["Plants use chlorophyll to convert light into stored energy."],
      "lesson.txt",
      { type: "text/plain" }
    );

    const result = await extractFromDocument(file, {
      textbookSubject: "Science",
      chapterTitle: "Photosynthesis",
    });

    expect(firebaseFunctionMocks.httpsCallableMock).toHaveBeenCalledWith(
      { app: "test-functions-client" },
      "extractDocumentContent"
    );
    expect(firebaseFunctionMocks.callableMock).toHaveBeenCalledWith({
      fileName: "lesson.txt",
      mimeType: "text/plain",
      text: "Plants use chlorophyll to convert light into stored energy.",
      context: {
        textbookSubject: "Science",
        chapterTitle: "Photosynthesis",
      },
    });
    expect(result).toEqual({
      vocab: ["photosynthesis", "chlorophyll"],
      concepts: ["energy transfer"],
      equations: ["6CO2 + 6H2O -> C6H12O6 + 6O2"],
      namesAndDates: [{ name: "Jan Ingenhousz", date: "1779" }],
      keyIdeas: ["Plants convert light into chemical energy."],
      quality: {
        accepted: true,
        documentType: "lesson",
        detectedLanguage: "english",
        questionAnswerLayouts: [],
        issues: [],
      },
    });
  });

  it("encodes binary files as base64 before calling the extraction function", async () => {
    firebaseFunctionMocks.callableMock.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        data: {
          vocab: [],
          concepts: [],
          equations: [],
          namesAndDates: [],
          keyIdeas: [],
          quality: {
            accepted: true,
            documentType: "worksheet",
            detectedLanguage: "english",
            questionAnswerLayouts: ["split-pages"],
            issues: [],
          },
        },
      },
    });

    const file = new File([new Uint8Array([80, 68, 70, 45, 49, 46, 55])], "worksheet.pdf", {
      type: "application/pdf",
    });

    await extractFromDocument(file);

    expect(firebaseFunctionMocks.callableMock).toHaveBeenCalledTimes(1);
    const payload = firebaseFunctionMocks.callableMock.mock.calls[0]?.[0];

    expect(payload).toMatchObject({
      fileName: "worksheet.pdf",
      mimeType: "application/pdf",
    });
    expect(payload.text).toBeUndefined();
    expect(typeof payload.base64).toBe("string");
    expect(payload.base64.length).toBeGreaterThan(0);
  });

  it("rejects unsupported document types before any function call", async () => {
    const file = new File(["not supported"], "lesson.csv", { type: "text/csv" });

    await expect(extractFromDocument(file)).rejects.toThrow("Unsupported file type");
    expect(firebaseFunctionMocks.callableMock).not.toHaveBeenCalled();
  });

  it("accepts captured webpage and markdown exports as supported document types", () => {
    expect(isSupportedDocumentType(new File(["<html></html>"], "page.html", { type: "text/html" }))).toBe(true);
    expect(isSupportedDocumentType(new File(["# Notes"], "chapter.md", { type: "text/markdown" }))).toBe(true);
    expect(isSupportedDocumentType(new File(["{\\rtf1 Test}"], "publisher.rtf", { type: "application/rtf" }))).toBe(true);
  });

  it("merges extracted data from multiple files and preserves file-specific issues", () => {
    const merged = mergeExtractedDocuments([
      {
        fileName: "chapter-1.txt",
        data: {
          vocab: ["evidence"],
          concepts: ["scientific method"],
          equations: [],
          namesAndDates: [{ name: "Galileo" }],
          keyIdeas: ["Scientists test explanations."],
          quality: {
            accepted: true,
            documentType: "lesson",
            detectedLanguage: "english",
            questionAnswerLayouts: [],
            issues: [],
          },
        },
      },
      {
        fileName: "chapter-2.txt",
        data: {
          vocab: ["evidence", "hypothesis"],
          concepts: ["controlled experiment"],
          equations: [],
          namesAndDates: [{ name: "Galileo" }, { name: "Newton", date: "1687" }],
          keyIdeas: ["Repeat trials to confirm results."],
          quality: {
            accepted: true,
            documentType: "worksheet",
            detectedLanguage: "english",
            questionAnswerLayouts: ["interleaved"],
            issues: [{ code: "multi_chapter_content", severity: "warning", message: "The document appears to include content from more than one chapter or lesson." }],
          },
        },
      },
    ]);

    expect(merged.vocab).toEqual(["evidence", "hypothesis"]);
    expect(merged.namesAndDates).toEqual([{ name: "Galileo" }, { name: "Newton", date: "1687" }]);
    expect(merged.quality.questionAnswerLayouts).toEqual(["interleaved"]);
    expect(merged.quality.issues[0]?.message).toContain("chapter-2.txt:");
  });

  it("extracts from a mixed file batch and reports skipped unsupported files", async () => {
    firebaseFunctionMocks.callableMock
      .mockResolvedValueOnce({
        data: {
          success: true,
          message: "ok",
          data: {
            vocab: ["evidence"],
            concepts: [],
            equations: [],
            namesAndDates: [],
            keyIdeas: [],
            quality: {
              accepted: true,
              documentType: "lesson",
              detectedLanguage: "english",
              questionAnswerLayouts: [],
              issues: [],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          message: "ok",
          data: {
            vocab: ["hypothesis"],
            concepts: [],
            equations: [],
            namesAndDates: [],
            keyIdeas: [],
            quality: {
              accepted: true,
              documentType: "worksheet",
              detectedLanguage: "english",
              questionAnswerLayouts: ["inline-bold-answer"],
              issues: [],
            },
          },
        },
      });

    const result = await extractFromDocuments([
      new File(["Evidence matters"], "chapter.txt", { type: "text/plain" }),
      new File(["# Hypothesis"], "notes.md", { type: "text/markdown" }),
      new File(["not supported"], "bad.csv", { type: "text/csv" }),
    ]);

    expect(result.vocab).toEqual(["evidence", "hypothesis"]);
    expect(result.quality.issues.some((issue) => issue.message.includes("bad.csv"))).toBe(true);
  });
});
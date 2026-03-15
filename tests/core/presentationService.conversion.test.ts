import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

const callableMocks = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => Promise<unknown>> = {};
  const httpsCallable = vi.fn((_: unknown, functionName: string) => {
    return async (payload: unknown) => {
      const handler = handlers[functionName];
      if (!handler) {
        throw new Error(`Missing mock handler for callable: ${functionName}`);
      }
      return { data: await handler(payload) };
    };
  });

  return {
    handlers,
    httpsCallable,
  };
});

const firestoreMocks = vi.hoisted(() => ({
  setDoc: vi.fn(async () => undefined),
  doc: vi.fn((_: unknown, path: string) => ({ path })),
}));

const repositoryMocks = vi.hoisted(() => ({
  saveExtractedPresentation: vi.fn(async () => "presentation-id"),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: callableMocks.httpsCallable,
}));

vi.mock("firebase/firestore", () => ({
  setDoc: firestoreMocks.setDoc,
  doc: firestoreMocks.doc,
}));

vi.mock("../../src/firebase/functions", () => ({
  functionsClient: { app: "test-functions" },
}));

vi.mock("../../src/firebase/auth", () => ({
  getCurrentUser: () => ({ uid: "teacher-1" }),
}));

vi.mock("../../src/firebase/firestore", () => ({
  firestoreDb: { app: "db" },
}));

vi.mock("../../src/core/services/repositories", () => ({
  saveExtractedPresentation: repositoryMocks.saveExtractedPresentation,
}));

import {
  classifySlideVisualAsset,
  extractPresentationFromFile,
  savePresentationToLocalAndFirestore,
  type PresentationExtractionContext,
} from "../../src/core/services/presentationService";
import type { ExtractedPresentation } from "../../src/core/models";

function createMinimalPptxBase64(): Promise<string> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp><p:txBody><a:p><a:r><a:t>Cell Overview</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:txBody><a:p><a:r><a:t>Analyze this visual set.</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/border-1.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/graph-1.png"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/icon-1.png"/>
</Relationships>`
  );

  return zip.generateAsync({ type: "base64" });
}

describe("presentationService conversion and persistence", () => {
  beforeEach(() => {
    callableMocks.httpsCallable.mockClear();
    firestoreMocks.setDoc.mockClear();
    firestoreMocks.doc.mockClear();
    repositoryMocks.saveExtractedPresentation.mockClear();
    Object.keys(callableMocks.handlers).forEach((key) => {
      delete callableMocks.handlers[key];
    });
  });

  it("converts legacy .ppt via callable and extracts sanitized slide content", async () => {
    const convertedBase64 = await createMinimalPptxBase64();

    callableMocks.handlers.convertPresentationFile = async () => ({
      success: true,
      message: "converted",
      data: {
        fileName: "legacy-converted.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        base64: convertedBase64,
      },
    });

    callableMocks.handlers.generatePresentationDesignSuggestions = async () => ({
      success: true,
      message: "ok",
      data: {
        themeName: "Clean",
        backgroundAssets: [],
        fontChoices: ["Calibri", "Segoe UI"],
        animationStyle: "fade-in",
        iconSuggestions: {},
        videoBackgroundSuggestions: [],
      },
    });

    const legacyFile = new File([new Uint8Array([1, 2, 3, 4])], "legacy.ppt", {
      type: "application/vnd.ms-powerpoint",
    });

    const context: PresentationExtractionContext = {};
    const extracted = await extractPresentationFromFile(legacyFile, context);

    expect(extracted.fileName).toBe("legacy-converted.pptx");
    expect(extracted.slides).toHaveLength(1);
    expect(extracted.slides[0]?.rawText[0]).toBe("Cell Overview");
    expect(extracted.slides[0]?.extractedImages).toContain("ppt/media/graph-1.png");
    expect(extracted.slides[0]?.extractedImages).toContain("ppt/media/icon-1.png");
    expect(extracted.slides[0]?.extractedImages).not.toContain("ppt/media/border-1.png");
    expect(extracted.slides[0]?.notes ?? "").toContain("Review visual relevance");
  });

  it("surfaces manual-conversion guidance when legacy conversion service is unavailable", async () => {
    callableMocks.handlers.convertPresentationFile = async () => ({
      success: false,
      message: "Automatic .ppt conversion is not configured. Please convert to .pptx manually for now.",
      data: {
        fileName: "legacy.ppt",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        base64: "",
      },
    });

    const legacyFile = new File([new Uint8Array([9, 8, 7])], "legacy.ppt", {
      type: "application/vnd.ms-powerpoint",
    });

    await expect(extractPresentationFromFile(legacyFile, {})).rejects.toThrow("not configured");
  });

  it("saves extracted presentation to local repository and Firestore path", async () => {
    const presentation: ExtractedPresentation = {
      id: "p-1",
      textbookId: "tb-1",
      chapterId: "ch-1",
      sectionId: "sec-1",
      presentationTitle: "Energy",
      fileName: "energy.pptx",
      slides: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pendingSync: true,
      source: "local",
    };

    await savePresentationToLocalAndFirestore(presentation);

    expect(repositoryMocks.saveExtractedPresentation).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.doc).toHaveBeenCalledWith(
      { app: "db" },
      "textbooks/tb-1/chapters/ch-1/sections/sec-1/presentations/p-1"
    );
    expect(firestoreMocks.setDoc).toHaveBeenCalledTimes(1);
  });

  it("classifies visual assets into discard, keep, and review outcomes", () => {
    const discard = classifySlideVisualAsset({
      assetPath: "ppt/media/background-border-2.png",
      slideType: "content",
      slideText: ["Lesson summary"],
      formulas: [],
    });

    const keep = classifySlideVisualAsset({
      assetPath: "ppt/media/diagram-heart.png",
      slideType: "diagram",
      slideText: ["Heart diagram"],
      formulas: [],
    });

    const review = classifySlideVisualAsset({
      assetPath: "ppt/media/icon-lightbulb.png",
      slideType: "content",
      slideText: ["Think about this concept"],
      formulas: [],
    });

    expect(discard).toBe("discard");
    expect(keep).toBe("keep");
    expect(review).toBe("review");
  });
});

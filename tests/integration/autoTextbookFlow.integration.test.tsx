import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { METADATA_CORRECTION_STORAGE_KEYS } from "../../src/core/services/metadataCorrectionLearningService";
import { persistAutoTextbook } from "../../src/core/services/autoTextbookPersistenceService";
import type { TocChapter } from "../../src/core/services/textbookAutoExtractionService";
import { AutoTextbookSetupFlow } from "../../src/webapp/components/textbooks/AutoTextbookSetupFlow";
import { TextbookForm } from "../../src/webapp/components/textbooks/TextbookForm";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

const AUTO_SESSION_DRAFTS_KEY = "courseforge.autoSessionDrafts.v2";
const SOURCE_OF_TRUTH_COVER_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=";

const SOURCE_OF_TRUTH_COPYRIGHT_OCR_TEXT = [
  "mheducation.com/prek-12",
  "McGraw Hill",
  "Copyright © 2021 McGraw-Hill Education",
  "Send all inquiries to:",
  "McGraw-Hill Education",
  "STEM Learning Solutions Center",
  "8787 Orion Place",
  "Columbus, OH 43240",
  "ISBN: 978-0-07-671685-2",
  "MHID: 0-07-671685-6",
].join("\n");

const SOURCE_OF_TRUTH_TOC = {
  confidence: 0.95,
  chapters: [
    {
      chapterNumber: "31",
      title: "STARS AND GALAXIES",
      pageStart: 819,
      sections: [
        { sectionNumber: "31.1", title: "Discovering the Universe", pageStart: 819 },
        { sectionNumber: "31.2", title: "Evolution of Stars", pageStart: 820 },
        { sectionNumber: "31.3", title: "Galaxies and the Milky Way", pageStart: 825 },
        { sectionNumber: "31.4", title: "Cosmological Discoveries", pageStart: 832 },
        { sectionNumber: "", title: "Module Wrap-Up", pageStart: 841 },
        { sectionNumber: "", title: "STEM Data Analysis Lab", pageStart: 843, pageEnd: 843 },
      ],
    },
  ],
} satisfies { confidence: number; chapters: TocChapter[] };

const metadataPipelineMocks = vi.hoisted(() => ({
  extractMetadataWithOcrFallbackFromDataUrl: vi.fn(async () => ({
    result: {
      title: "Inspire Physical Science",
      subtitle: "with Earth Science",
      edition: "Student Edition",
      publisher: "McGraw Hill",
      series: null,
      gradeLevel: null,
      subject: "Science",
      confidence: 0.91,
      rawText: "Inspire Physical Science\nwith Earth Science\nStudent Edition\nMcGraw Hill",
      source: "ocr",
    },
    originalVisionOutput: null,
    originalOcrOutput: {
      rawText: "Inspire Physical Science\nwith Earth Science\nStudent Edition\nMcGraw Hill",
      providerId: "cloud_openai_vision",
    },
  })),
}));

const repositoryMocks = vi.hoisted(() => ({
  fetchTextbooks: vi.fn<( ) => Promise<any[]>>(async () => []),
  createTextbook: vi.fn<(input: any) => Promise<string>>(async () => "textbook-1"),
  editTextbook: vi.fn<(id: string, changes: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({ id: "textbook-1" })),
  findDuplicateTextbook: vi.fn<(input: Record<string, unknown>) => Promise<any>>(async () => undefined),
  findTextbookByISBN: vi.fn<(isbn: string) => Promise<any>>(async () => undefined),
  createChapter: vi.fn<(input: { textbookId: string; index: number; name: string; description?: string }) => Promise<string>>(async ({ index }) => `chapter-${index}`),
  createSection: vi.fn<(input: { chapterId: string; index: number; title: string; notes?: string }) => Promise<string>>(async () => "section-1"),
  editChapter: vi.fn<(id: string, changes: Record<string, unknown>) => Promise<{ id: string }>>(async (id) => ({ id })),
  editSection: vi.fn<(id: string, changes: Record<string, unknown>) => Promise<{ id: string }>>(async (id) => ({ id })),
  fetchChaptersByTextbookId: vi.fn<(textbookId: string) => Promise<any[]>>(async () => []),
  fetchSectionsByChapterId: vi.fn<(chapterId: string) => Promise<any[]>>(async () => []),
  fetchVocabTermsBySectionId: vi.fn<(sectionId: string) => Promise<any[]>>(async () => []),
  fetchEquationsBySectionId: vi.fn<(sectionId: string) => Promise<any[]>>(async () => []),
  fetchConceptsBySectionId: vi.fn<(sectionId: string) => Promise<any[]>>(async () => []),
  fetchKeyIdeasBySectionId: vi.fn<(sectionId: string) => Promise<any[]>>(async () => []),
  removeVocabTerm: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  removeEquation: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  removeConcept: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  removeKeyIdea: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  removeSection: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  removeChapter: vi.fn<(id: string) => Promise<void>>(async () => undefined),
}));

const coverServiceMocks = vi.hoisted(() => ({
  uploadTextbookCoverFromDataUrl: vi.fn<(textbookId: string, dataUrl: string) => Promise<string>>(async (textbookId) => `cover://${textbookId}`),
  uploadTextbookOwnershipProofFromDataUrl: vi.fn<(textbookId: string, dataUrl: string) => Promise<string>>(async (textbookId) => `ownership://${textbookId}`),
}));

const syncServiceMocks = vi.hoisted(() => ({
  syncNow: vi.fn(async () => ({
    success: true,
    message: "Synced successfully.",
    retryable: false,
    permissionDenied: false,
    throttled: false,
    writeLoopTriggered: false,
    writeBudgetExceeded: false,
    writeCount: 0,
    writeBudgetLimit: 500,
    readCount: 0,
    readBudgetLimit: 5000,
    readBudgetExceeded: false,
    retryLimit: 3,
    errorCode: null,
    pendingCount: 0,
  })),
  findCloudTextbookByISBN: vi.fn<(userId: string, isbnRaw: string) => Promise<unknown>>(async () => undefined),
}));

const metadataCorrectionSyncMocks = vi.hoisted(() => ({
  syncMetadataCorrectionLearning: vi.fn(async () => ({ message: null })),
}));

const autoOcrMocks = vi.hoisted(() => ({
  extractTextFromImageWithFallback: vi.fn<(image: string) => Promise<{ text: string; providerId: string; attempts: string[] }>>(async (_image: string) => ({
    text: "Inspire Physical Science Student Edition",
    providerId: "local_tesseract",
    attempts: ["local_tesseract"],
  })),
}));

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(() => ({ uid: "teacher-sync" })),
}));

vi.mock("../../src/core/services/coverImageService", () => ({
  uploadTextbookCoverFromDataUrl: (textbookId: string, dataUrl: string) => coverServiceMocks.uploadTextbookCoverFromDataUrl(textbookId, dataUrl),
  uploadTextbookOwnershipProofFromDataUrl: (textbookId: string, dataUrl: string) => coverServiceMocks.uploadTextbookOwnershipProofFromDataUrl(textbookId, dataUrl),
  uploadTextbookCoverImage: vi.fn(async () => "cover://mock"),
}));

vi.mock("../../src/core/services/syncService", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/services/syncService")>("../../src/core/services/syncService");
  return {
    ...actual,
    syncNow: () => syncServiceMocks.syncNow(),
    findCloudTextbookByISBN: (userId: string, isbn: string) => syncServiceMocks.findCloudTextbookByISBN(userId, isbn),
  };
});

vi.mock("../../src/core/services/metadataCorrectionSyncService", () => ({
  syncMetadataCorrectionLearning: () => metadataCorrectionSyncMocks.syncMetadataCorrectionLearning(),
}));

vi.mock("../../src/core/services/autoOcrService", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/services/autoOcrService")>("../../src/core/services/autoOcrService");
  return {
    ...actual,
    extractTextFromImageWithFallback: (image: string) => autoOcrMocks.extractTextFromImageWithFallback(image),
  };
});

vi.mock("../../src/firebase/auth", async () => {
  const actual = await vi.importActual<typeof import("../../src/firebase/auth")>("../../src/firebase/auth");
  return {
    ...actual,
    getCurrentUser: () => authMocks.getCurrentUser(),
  };
});

vi.mock("../../src/webapp/hooks/useRepositories", () => ({
  useRepositories: () => ({
    fetchTextbooks: repositoryMocks.fetchTextbooks,
    createTextbook: repositoryMocks.createTextbook,
    editTextbook: repositoryMocks.editTextbook,
    findDuplicateTextbook: repositoryMocks.findDuplicateTextbook,
    findTextbookByISBN: repositoryMocks.findTextbookByISBN,
    createChapter: repositoryMocks.createChapter,
    createSection: repositoryMocks.createSection,
    editChapter: repositoryMocks.editChapter,
    editSection: repositoryMocks.editSection,
    fetchChaptersByTextbookId: repositoryMocks.fetchChaptersByTextbookId,
    fetchSectionsByChapterId: repositoryMocks.fetchSectionsByChapterId,
    fetchVocabTermsBySectionId: repositoryMocks.fetchVocabTermsBySectionId,
    fetchEquationsBySectionId: repositoryMocks.fetchEquationsBySectionId,
    fetchConceptsBySectionId: repositoryMocks.fetchConceptsBySectionId,
    fetchKeyIdeasBySectionId: repositoryMocks.fetchKeyIdeasBySectionId,
    removeVocabTerm: repositoryMocks.removeVocabTerm,
    removeEquation: repositoryMocks.removeEquation,
    removeConcept: repositoryMocks.removeConcept,
    removeKeyIdea: repositoryMocks.removeKeyIdea,
    removeSection: repositoryMocks.removeSection,
    removeChapter: repositoryMocks.removeChapter,
  }),
}));

vi.mock("../../src/core/services/metadataExtractionPipelineService", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/services/metadataExtractionPipelineService")>("../../src/core/services/metadataExtractionPipelineService");
  return {
    ...actual,
    extractMetadataWithOcrFallbackFromDataUrl: metadataPipelineMocks.extractMetadataWithOcrFallbackFromDataUrl,
  };
});

describe("auto textbook flow integration", () => {
  beforeEach(() => {
    repositoryMocks.fetchTextbooks.mockReset().mockResolvedValue([]);
    repositoryMocks.createTextbook.mockClear();
    repositoryMocks.editTextbook.mockClear();
    repositoryMocks.findDuplicateTextbook.mockReset().mockResolvedValue(undefined);
    repositoryMocks.findTextbookByISBN.mockReset().mockResolvedValue(undefined);
    repositoryMocks.createChapter.mockClear();
    repositoryMocks.createSection.mockClear();
    repositoryMocks.editChapter.mockClear();
    repositoryMocks.editSection.mockClear();
    repositoryMocks.fetchChaptersByTextbookId.mockClear();
    repositoryMocks.fetchSectionsByChapterId.mockClear();
    repositoryMocks.fetchVocabTermsBySectionId.mockClear();
    repositoryMocks.fetchEquationsBySectionId.mockClear();
    repositoryMocks.fetchConceptsBySectionId.mockClear();
    repositoryMocks.fetchKeyIdeasBySectionId.mockClear();
    repositoryMocks.removeVocabTerm.mockClear();
    repositoryMocks.removeEquation.mockClear();
    repositoryMocks.removeConcept.mockClear();
    repositoryMocks.removeKeyIdea.mockClear();
    repositoryMocks.removeSection.mockClear();
    repositoryMocks.removeChapter.mockClear();
    coverServiceMocks.uploadTextbookCoverFromDataUrl.mockClear();
    coverServiceMocks.uploadTextbookOwnershipProofFromDataUrl.mockClear();

    useUIStore.setState({
      selectedTextbook: null,
      selectedTextbookId: null,
    });

    // Keep integration tests deterministic by opting out of metadata-learning uploads.
    window.localStorage.setItem(METADATA_CORRECTION_STORAGE_KEYS.optedIn, "false");
    window.localStorage.removeItem(METADATA_CORRECTION_STORAGE_KEYS.corrections);
    window.localStorage.removeItem(AUTO_SESSION_DRAFTS_KEY);
    window.localStorage.removeItem("courseforge.autoSessionDraft.v1");
    window.localStorage.removeItem("courseforge.autoExtractionCheckpoints.v1");
    metadataPipelineMocks.extractMetadataWithOcrFallbackFromDataUrl.mockClear();
    autoOcrMocks.extractTextFromImageWithFallback.mockClear();
    syncServiceMocks.syncNow.mockClear();
    syncServiceMocks.findCloudTextbookByISBN.mockReset().mockResolvedValue(undefined);
    metadataCorrectionSyncMocks.syncMetadataCorrectionLearning.mockClear();
    authMocks.getCurrentUser.mockClear();
    syncServiceMocks.syncNow.mockResolvedValue({
      success: true,
      message: "Synced successfully.",
      retryable: false,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: false,
      writeBudgetExceeded: false,
      writeCount: 0,
      writeBudgetLimit: 500,
      readCount: 0,
      readBudgetLimit: 5000,
      readBudgetExceeded: false,
      retryLimit: 3,
      errorCode: null,
      pendingCount: 0,
    });
    metadataCorrectionSyncMocks.syncMetadataCorrectionLearning.mockResolvedValue({ message: null });
    authMocks.getCurrentUser.mockReturnValue({ uid: "teacher-sync" });
    useAuthStore.setState({ authMode: "cloud" });
  });

  it("switches from Auto setup back to Manual entry", () => {
    render(<TextbookForm onSaved={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /Auto \(Recommended\)/i }));

    expect(screen.getByRole("button", { name: "Switch to Manual" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to Manual" }));

    expect(screen.getByRole("button", { name: "Save Textbook" })).toBeInTheDocument();
  });

  it("marks metadata confidence source as manual after user edits", () => {
    const { container } = render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "cover",
          metadataDraft: {
            title: "Auto Algebra",
            edition: "2nd Edition",
          },
          metadataConfidence: {
            title: {
              value: "Auto Algebra",
              confidence: 0.82,
              sourceType: "auto",
            },
          },
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
        }}
      />
    );

    fireEvent.click(screen.getAllByRole("listitem").find((el) => el.querySelector(".metadata-tile__title")?.textContent === "Title")!);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Manual Title Override" } });

    const manualDot = container.querySelector("[title*='(manual)']");
    expect(manualDot).toBeTruthy();
  });

  it("shows teacher-friendly correction guidance in metadata review", () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "cover",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
        }}
      />
    );

    expect(
      screen.getByText("You can edit any of these fields. Your corrections help improve future extractions.")
    ).toBeInTheDocument();
  });

  it("processes a dropped cover image through OCR pipeline and surfaces provider/source status", async () => {
    const fileReaderReadAsDataUrl = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function mockReadAsDataUrl(this: FileReader) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2NcAAAAASUVORK5CYII=",
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    try {
      render(
        <AutoTextbookSetupFlow
          onSaved={() => undefined}
          onSwitchToManual={() => undefined}
        />
      );

      fireEvent.drop(screen.getByRole("region", { name: "Cover image drop zone" }), {
        dataTransfer: {
          files: [new File(["cover"], "cover.png", { type: "image/png" })],
        },
      });

      await waitFor(() => {
        expect(metadataPipelineMocks.extractMetadataWithOcrFallbackFromDataUrl).toHaveBeenCalledTimes(1);
      });

      expect(screen.getByText(/Metadata source: ocr/i)).toBeInTheDocument();
      expect(screen.getByText(/OCR: cloud_openai_vision/i)).toBeInTheDocument();
    } finally {
      fileReaderReadAsDataUrl.mockRestore();
    }
  });

  it("falls back to OCR when pipeline returns refusal-style raw text", async () => {
    const fileReaderReadAsDataUrl = vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function mockReadAsDataUrl(this: FileReader) {
      Object.defineProperty(this, "result", {
        configurable: true,
        value: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2NcAAAAASUVORK5CYII=",
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });

    metadataPipelineMocks.extractMetadataWithOcrFallbackFromDataUrl.mockResolvedValueOnce({
      result: {
        title: "Inspire Physical Science",
        subtitle: "with Earth Science",
        edition: "Student Edition",
        publisher: "McGraw Hill",
        series: null,
        gradeLevel: null,
        subject: "Science",
        confidence: 0.93,
        rawText: "I\u2019m unable to extract text from images. If you have a specific text or content you need help with, feel free to share!",
        source: "vision",
      },
      originalVisionOutput: null,
      originalOcrOutput: {
        rawText: "",
        providerId: "cloud_openai_vision",
      },
    });

    autoOcrMocks.extractTextFromImageWithFallback.mockResolvedValueOnce({
      text: "Inspire Physical Science Student Edition",
      providerId: "local_tesseract",
      attempts: ["local_tesseract"],
    });

    try {
      render(
        <AutoTextbookSetupFlow
          onSaved={() => undefined}
          onSwitchToManual={() => undefined}
        />
      );

      fireEvent.drop(screen.getByRole("region", { name: "Cover image drop zone" }), {
        dataTransfer: {
          files: [new File(["cover"], "cover.png", { type: "image/png" })],
        },
      });

      await waitFor(() => {
        expect(autoOcrMocks.extractTextFromImageWithFallback).toHaveBeenCalledTimes(1);
      });
    } finally {
      fileReaderReadAsDataUrl.mockRestore();
    }
  });

  it("renders multi-line extracted publisher location with comma separators in the input field", () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "cover",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          metadataDraft: {
            title: "Inspire Physical Science",
            subject: "Science",
            publisherLocation: [
              "McGraw-Hill Education",
              "STEM Learning Solutions Center",
              "8777 Lusk Road",
              "Columbus, OH 43240",
            ].join("\n"),
          },
        }}
      />
    );

    fireEvent.click(screen.getAllByRole("listitem").find((el) => el.querySelector(".metadata-tile__title")?.textContent === "Publisher Location")!);
    expect((screen.getByLabelText("Publisher Location") as HTMLInputElement).value).toBe(
      "McGraw-Hill Education, STEM Learning Solutions Center, 8777 Lusk Road, Columbus, OH 43240"
    );
  });

  it("renders clean extraction/remove symbols without mojibake in auto metadata UI", () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "cover",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          metadataDraft: {
            title: "Inspire Physical Science",
            subject: "Science",
            relatedIsbns: [{ isbn: "9780076770007", type: "teacher", note: "Teacher Edition" }],
          },
        }}
      />
    );

    fireEvent.click(screen.getAllByRole("listitem").find((el) => el.querySelector(".metadata-tile__title")?.textContent === "Related ISBNs")!);
    const removeButton = screen.getByRole("button", { name: "Remove related ISBN" });
    expect(removeButton.textContent?.trim()).toBe("×");
    expect(document.body.textContent ?? "").not.toContain("âœ");
  });

  it("restores additional and typed ISBN metadata when resuming a queued draft", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      AUTO_SESSION_DRAFTS_KEY,
      JSON.stringify([
        {
          id: "resume-isbn-draft",
          version: 1,
          savedAt: now,
          coverImageDataUrl: "data:image/png;base64,a",
          rawOcrText: "Inspire Physical Science",
          metadataTitle: "Inspire Physical Science",
          metadataSubject: "Science",
          metadataPublisher: "McGraw Hill",
          metadataFormSnapshot: {
            title: "Inspire Physical Science",
            subtitle: "",
            grade: "",
            gradeBand: "",
            subject: "Science",
            edition: "Student Edition",
            publicationYear: "2021",
            copyrightYear: "2021",
            isbnRaw: "9780076716852",
            additionalIsbnsCsv: "9780076770007",
            seriesName: "",
            publisher: "McGraw Hill",
            publisherLocation: "",
            platformUrl: "",
            mhid: "",
            authorsCsv: "",
            tocExtractionConfidence: "",
          },
          relatedIsbnsSnapshot: [{ isbn: "9780076770007", type: "teacher", note: "Teacher Edition" }],
          step: "title",
          stepsCompleted: { cover: true, copyright: false },
        },
      ])
    );

    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(screen.getAllByRole("listitem").find((el) => el.querySelector(".metadata-tile__title")?.textContent === "Additional ISBNs")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByRole("listitem").find((el) => el.querySelector(".metadata-tile__title")?.textContent === "Additional ISBNs")!);
    expect((screen.getByLabelText(/Additional ISBNs \(comma separated\)/i) as HTMLInputElement).value).toContain("9780076770007");

    fireEvent.click(screen.getAllByRole("listitem").find((el) => el.querySelector(".metadata-tile__title")?.textContent === "Related ISBNs")!);
    expect((screen.getByDisplayValue("Teacher Edition") as HTMLInputElement).value).toBe("Teacher Edition");
  });

  it("restores pinned guided cue markers from a resumable TOC draft", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      AUTO_SESSION_DRAFTS_KEY,
      JSON.stringify([
        {
          id: "resume-guided-cues-draft",
          version: 1,
          savedAt: now,
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          tocCaptureImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          rawOcrText: "Table of Contents",
          metadataTitle: "Inspire Physical Science",
          metadataSubject: "Science",
          metadataPublisher: "McGraw Hill",
          guidedCuePlan: {
            version: 1,
            viewerHost: "example.viewer",
            cues: {
              openToc: {
                type: "openToc",
                acknowledged: true,
                point: { xRatio: 0.15, yRatio: 0.22, capturedAt: now },
              },
              openGlossary: {
                type: "openGlossary",
                acknowledged: true,
                point: { xRatio: 0.33, yRatio: 0.45, capturedAt: now },
              },
              nextPage: {
                type: "nextPage",
                acknowledged: true,
                point: { xRatio: 0.87, yRatio: 0.56, capturedAt: now },
              },
            },
          },
          step: "toc",
          stepsCompleted: { cover: true, copyright: true },
        },
      ])
    );

    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Re-parse TOC Text" })).toBeInTheDocument();
    });

    expect(screen.getByText(/Live TOC Structure Preview/i)).toBeInTheDocument();
  });

  it("restores captured TOC chapters from resumable draft snapshots", async () => {
    const now = Date.now();
    const snapshot = {
      confidence: 0.91,
      chapters: [
        {
          chapterNumber: "5",
          title: "ENERGY AND WAVES",
          pageStart: 120,
          sections: [
            { sectionNumber: "5.1", title: "Forms of Energy", pageStart: 121 },
          ],
        },
      ],
    };

    window.localStorage.setItem(
      AUTO_SESSION_DRAFTS_KEY,
      JSON.stringify([
        {
          id: "resume-toc-snapshot-draft",
          version: 1,
          savedAt: now,
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          tocCaptureImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          rawOcrText: "MODULE 5: ENERGY AND WAVES",
          metadataTitle: "Inspire Physical Science",
          metadataSubject: "Science",
          metadataPublisher: "McGraw Hill",
          tocResultSnapshot: snapshot,
          tocPagesSnapshot: [
            {
              imageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
              ocrText: "MODULE 5: ENERGY AND WAVES",
              chapters: snapshot.chapters,
              confidence: snapshot.confidence,
            },
          ],
          step: "toc-editor",
          stepsCompleted: { cover: true, copyright: true },
        },
      ])
    );

    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "TOC Editor" })).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("ENERGY AND WAVES")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Forms of Energy")).toBeInTheDocument();
  });

  it("hydrates TOC chapters from saved textbook hierarchy when resumable draft has no TOC snapshot", async () => {
    const now = Date.now();
    repositoryMocks.findDuplicateTextbook.mockResolvedValueOnce({
      id: "textbook-existing",
      title: "Inspire Physical Science",
      isbnRaw: "9780076716852",
    });
    repositoryMocks.fetchChaptersByTextbookId.mockResolvedValueOnce([
      {
        id: "chapter-existing-1",
        sourceType: "auto",
        textbookId: "textbook-existing",
        index: 2,
        name: "ENERGY AND WAVES",
        lastModified: new Date(now).toISOString(),
        pendingSync: false,
        source: "local",
      },
    ]);
    repositoryMocks.fetchSectionsByChapterId.mockResolvedValueOnce([
      {
        id: "section-existing-1",
        sourceType: "auto",
        chapterId: "chapter-existing-1",
        index: 3,
        title: "Forms of Energy",
        lastModified: new Date(now).toISOString(),
        pendingSync: false,
        source: "local",
      },
    ]);

    window.localStorage.setItem(
      AUTO_SESSION_DRAFTS_KEY,
      JSON.stringify([
        {
          id: "resume-without-toc-snapshot",
          version: 1,
          savedAt: now,
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          rawOcrText: "MODULE 2: ENERGY AND WAVES",
          metadataTitle: "Inspire Physical Science",
          metadataSubject: "Science",
          metadataPublisher: "McGraw Hill",
          metadataFormSnapshot: {
            title: "Inspire Physical Science",
            subtitle: "",
            grade: "8",
            gradeBand: "",
            subject: "Science",
            edition: "Student",
            publicationYear: "2021",
            copyrightYear: "",
            isbnRaw: "9780076716852",
            additionalIsbnsCsv: "",
            seriesName: "",
            publisher: "McGraw Hill",
            publisherLocation: "",
            platformUrl: "",
            mhid: "",
            authorsCsv: "",
            tocExtractionConfidence: "0",
          },
          step: "toc-editor",
          stepsCompleted: { cover: true, copyright: true },
        },
      ])
    );

    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "TOC Editor" })).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("ENERGY AND WAVES")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Forms of Energy")).toBeInTheDocument();
    expect(screen.getByText(/Restored existing TOC chapters from saved textbook data/i)).toBeInTheDocument();
    expect(repositoryMocks.findDuplicateTextbook).toHaveBeenCalledWith(expect.objectContaining({
      title: "Inspire Physical Science",
      grade: "8",
      publisher: "McGraw Hill",
      publicationYear: 2021,
    }));
    expect(repositoryMocks.fetchChaptersByTextbookId).toHaveBeenCalledWith("textbook-existing");
    expect(repositoryMocks.fetchSectionsByChapterId).toHaveBeenCalledWith("chapter-existing-1");
  });

  it("hydrates TOC chapters from title fallback when resumable draft metadata is sparse", async () => {
    const now = Date.now();
    repositoryMocks.findDuplicateTextbook.mockResolvedValueOnce(undefined);
    repositoryMocks.findTextbookByISBN.mockResolvedValueOnce(undefined);
    repositoryMocks.fetchTextbooks.mockResolvedValueOnce([
      {
        id: "textbook-old",
        sourceType: "auto",
        title: "Inspire Physical Science",
        grade: "8",
        subject: "Science",
        edition: "Student",
        publicationYear: 2020,
        isbnRaw: "",
        isbnNormalized: "",
        seriesName: "",
        publisher: "",
        lastModified: new Date(now - 5000).toISOString(),
        createdAt: new Date(now - 5000).toISOString(),
        updatedAt: new Date(now - 5000).toISOString(),
        pendingSync: false,
        source: "local",
        isFavorite: false,
        isArchived: false,
      },
      {
        id: "textbook-new",
        sourceType: "auto",
        title: "Inspire Physical Science",
        grade: "8",
        subject: "Science",
        edition: "Student",
        publicationYear: 2021,
        isbnRaw: "",
        isbnNormalized: "",
        seriesName: "",
        publisher: "",
        lastModified: new Date(now).toISOString(),
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        pendingSync: false,
        source: "local",
        isFavorite: false,
        isArchived: false,
      },
    ]);
    repositoryMocks.fetchChaptersByTextbookId.mockResolvedValueOnce([
      {
        id: "chapter-new-1",
        sourceType: "auto",
        textbookId: "textbook-new",
        index: 4,
        name: "MATTER AND CHANGE",
        lastModified: new Date(now).toISOString(),
        pendingSync: false,
        source: "local",
      },
    ]);
    repositoryMocks.fetchSectionsByChapterId.mockResolvedValueOnce([
      {
        id: "section-new-1",
        sourceType: "auto",
        chapterId: "chapter-new-1",
        index: 1,
        title: "Properties of Matter",
        lastModified: new Date(now).toISOString(),
        pendingSync: false,
        source: "local",
      },
    ]);

    window.localStorage.setItem(
      AUTO_SESSION_DRAFTS_KEY,
      JSON.stringify([
        {
          id: "resume-sparse-metadata",
          version: 1,
          savedAt: now,
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          rawOcrText: "MODULE 4: MATTER AND CHANGE",
          metadataTitle: "Inspire Physical Science",
          metadataSubject: "Science",
          metadataPublisher: "",
          metadataFormSnapshot: {
            title: "Inspire Physical Science",
            subtitle: "",
            grade: "8",
            gradeBand: "",
            subject: "Science",
            edition: "",
            publicationYear: "",
            copyrightYear: "",
            isbnRaw: "",
            additionalIsbnsCsv: "",
            seriesName: "",
            publisher: "",
            publisherLocation: "",
            platformUrl: "",
            mhid: "",
            authorsCsv: "",
            tocExtractionConfidence: "0",
          },
          step: "toc-editor",
          stepsCompleted: { cover: true, copyright: true },
        },
      ])
    );

    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "TOC Editor" })).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("MATTER AND CHANGE")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Properties of Matter")).toBeInTheDocument();
    expect(repositoryMocks.fetchTextbooks).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.fetchChaptersByTextbookId).toHaveBeenCalledWith("textbook-new");
  });

  it("allows deleting TOC sections and chapters before recapture", async () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          ownershipProofDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          tocResult: {
            confidence: 0.88,
            chapters: [
              {
                chapterNumber: "6",
                title: "EARTH SYSTEMS",
                pageStart: 140,
                sections: [
                  { sectionNumber: "6.1", title: "Earth Materials", pageStart: 141 },
                  { sectionNumber: "6.2", title: "Plate Motion", pageStart: 148 },
                ],
              },
            ],
          },
        }}
      />
    );

    expect(screen.getByDisplayValue("Plate Motion")).toBeInTheDocument();
    const plateMotionInput = screen.getByDisplayValue("Plate Motion");
    const plateMotionRow = plateMotionInput.closest(".auto-toc-editor__section-row");
    if (!plateMotionRow) {
      throw new Error("Expected to find section row for Plate Motion");
    }
    const deleteButton = plateMotionRow.querySelector("button[aria-label='Delete section']") as HTMLButtonElement | null;
    if (!deleteButton) {
      throw new Error("Expected delete button for Plate Motion section");
    }
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Plate Motion")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Chapter" }));
    await waitFor(() => {
      expect(screen.getByText("No chapters detected yet.")).toBeInTheDocument();
    });
  });

  it("limits unfinished auto captures to three queue slots and allows deleting a draft to reopen capacity", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      AUTO_SESSION_DRAFTS_KEY,
      JSON.stringify([
        {
          id: "draft-1",
          version: 1,
          savedAt: now,
          coverImageDataUrl: "data:image/png;base64,a",
          rawOcrText: "Book One",
          metadataTitle: "Book One",
          metadataSubject: "Science",
          metadataPublisher: "Pub A",
          step: "cover",
          stepsCompleted: { cover: true, copyright: false },
        },
        {
          id: "draft-2",
          version: 1,
          savedAt: now - 1000,
          coverImageDataUrl: "data:image/png;base64,b",
          rawOcrText: "Book Two",
          metadataTitle: "Book Two",
          metadataSubject: "Math",
          metadataPublisher: "Pub B",
          step: "title",
          stepsCompleted: { cover: true, copyright: true },
        },
        {
          id: "draft-3",
          version: 1,
          savedAt: now - 2000,
          coverImageDataUrl: "data:image/png;base64,c",
          rawOcrText: "Book Three",
          metadataTitle: "Book Three",
          metadataSubject: "ELA",
          metadataPublisher: "Pub C",
          step: "cover",
          stepsCompleted: { cover: true, copyright: false },
        },
      ])
    );

    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
      />
    );

    expect(screen.getByText(/Auto Mode Queue \(3\/3\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Queue full:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capture Cover" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload Image" })).toBeDisabled();

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Auto Mode Queue \(2\/3\)/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Queue full:/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capture Cover" })).not.toBeDisabled();
  });

  it("propagates manual sourceType when saving textbook in manual mode", async () => {
    render(<TextbookForm onSaved={() => undefined} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Manual/i }));
    });

    await screen.findByLabelText("Title");

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Manual Algebra" } });
      fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "8" } });
      fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Math" } });
      fireEvent.change(screen.getByLabelText("Edition"), { target: { value: "2" } });
      fireEvent.change(screen.getByLabelText("Publication Year"), { target: { value: "2025" } });

      fireEvent.click(screen.getByRole("button", { name: "Save Textbook" }));
    });

    await waitFor(() => {
      expect(repositoryMocks.createTextbook).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "manual",
          title: "Manual Algebra",
        })
      );
    });
  });

  it("prompts before saving a duplicate ISBN in manual mode and only proceeds when confirmed", async () => {
    repositoryMocks.findDuplicateTextbook.mockResolvedValueOnce({
      id: "tb-existing-manual",
      title: "Existing Algebra",
      isbnRaw: "9781402894626",
      sourceType: "manual",
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    try {
      render(<TextbookForm onSaved={() => undefined} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Manual/i }));
      });

      await screen.findByLabelText("Title");

      await act(async () => {
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Manual Algebra" } });
        fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "8" } });
        fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Math" } });
        fireEvent.change(screen.getByLabelText("Edition"), { target: { value: "2" } });
        fireEvent.change(screen.getByLabelText("Publication Year"), { target: { value: "2025" } });
        fireEvent.change(screen.getByLabelText(/ISBN/i), { target: { value: "9781402894626" } });
      });

      fireEvent.click(screen.getByRole("button", { name: "Save Textbook" }));

      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledWith("A textbook with this ISBN already exists. Upload anyway?");
      });
      expect(repositoryMocks.createTextbook).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Save Textbook" })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button", { name: "Save Textbook" }));

      await waitFor(() => {
        expect(repositoryMocks.createTextbook).toHaveBeenCalledTimes(1);
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("persists textbook, chapters, and sections while only storing image references", async () => {
    const toc: TocChapter[] = [
      {
        chapterNumber: "1",
        title: "Integers",
        sections: [
          { sectionNumber: "1.1", title: "Absolute Value" },
          { sectionNumber: "1.2", title: "Number Lines" },
        ],
      },
      {
        chapterNumber: "2",
        title: "Expressions",
        sections: [{ sectionNumber: "2.1", title: "Variables" }],
      },
    ];

    await persistAutoTextbook(
      {
        metadata: {
          title: "Foundations of Algebra",
          grade: "8",
          gradeBand: "7-9",
          subject: "Math",
          edition: "3rd Edition",
          publicationYear: 2026,
          isbnRaw: "978-1-4028-9462-6",
          tocExtractionConfidence: 0.84,
        },
        coverDataUrl: "data:image/jpeg;base64,AAAA",
        ownershipProofDataUrl: "data:image/jpeg;base64,BBBB",
        tocChapters: toc,
      },
      {
        createTextbook: repositoryMocks.createTextbook,
        createChapter: repositoryMocks.createChapter,
        createSection: repositoryMocks.createSection,
      }
    );

    expect(repositoryMocks.createTextbook).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.createTextbook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Foundations of Algebra",
        sourceType: "auto",
        coverDataUrl: "data:image/jpeg;base64,AAAA",
        ownershipProofDataUrl: "data:image/jpeg;base64,BBBB",
      })
    );

    const firstCreateCall = repositoryMocks.createTextbook.mock.calls.at(0);
    expect(firstCreateCall).toBeDefined();
    const savedTextbookPayload = (firstCreateCall?.[0] ?? {}) as Record<string, unknown>;
    expect(savedTextbookPayload).not.toHaveProperty("titlePageImageUrl");
    expect(savedTextbookPayload).not.toHaveProperty("tocPageImages");
    expect(savedTextbookPayload).not.toHaveProperty("rawOcrText");

    expect(repositoryMocks.createChapter).toHaveBeenCalledTimes(2);
    expect(repositoryMocks.createChapter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceType: "auto" })
    );
    expect(repositoryMocks.createSection).toHaveBeenCalledTimes(3);
    expect(repositoryMocks.createSection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceType: "auto" })
    );
  });

  it("blocks explicit language in Auto OCR parsing", () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "cover",
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          ocrDraft: "initial text",
        }}
      />
    );

    const ocrInput = screen.getByLabelText(/OCR text/i);
    fireEvent.click(ocrInput);
    fireEvent.change(ocrInput, { target: { value: "This is fucking explicit text" } });
    fireEvent.click(screen.getByRole("button", { name: "Re-parse OCR Text" }));

    expect(screen.getByText(/Capture blocked: detected inappropriate language/i)).toBeInTheDocument();
  });

  it("marks flagged educationally-graphic textbooks for admin approval and cloud hold", async () => {
    await persistAutoTextbook(
      {
        metadata: {
          title: "Grey's Anatomy",
          grade: "College",
          subject: "Science",
          edition: "1",
          publicationYear: 2026,
          isbnRaw: "",
          imageModerationState: "pending_admin_review",
          imageModerationReason: "Potentially graphic educational imagery. Requires admin approval.",
          imageModerationConfidence: 0.88,
          requiresAdminReview: true,
          cloudSyncBlockedReason: "pending_admin_review",
          status: "submitted",
        },
        coverDataUrl: "data:image/jpeg;base64,AAAA",
        tocChapters: [],
      },
      {
        createTextbook: repositoryMocks.createTextbook,
        createChapter: repositoryMocks.createChapter,
        createSection: repositoryMocks.createSection,
      }
    );

    expect(repositoryMocks.createTextbook).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "submitted",
        requiresAdminReview: true,
        cloudSyncBlockedReason: "pending_admin_review",
      })
    );
  });

  it("prompts for duplicate resolution and applies merge/dedupe choice in auto flow", async () => {
    const onSaved = vi.fn();
    const validCoverDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=";
    const validOwnershipProofDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=";

    repositoryMocks.findDuplicateTextbook.mockResolvedValue({
      id: "tb-existing",
      title: "Manual Algebra",
      isbnRaw: "9781402894626",
    });

    repositoryMocks.fetchChaptersByTextbookId.mockResolvedValue([
      {
        id: "ch-existing",
        sourceType: "manual",
        textbookId: "tb-existing",
        index: 1,
        name: "Integers",
        lastModified: "2026-03-15T00:00:00.000Z",
        pendingSync: true,
        source: "local",
      },
    ]);

    repositoryMocks.fetchSectionsByChapterId.mockResolvedValue([
      {
        id: "sec-existing",
        sourceType: "manual",
        textbookId: "tb-existing",
        chapterId: "ch-existing",
        index: 1,
        title: "Absolute Value",
        lastModified: "2026-03-15T00:00:00.000Z",
        pendingSync: true,
        source: "local",
      },
    ]);

    render(
      <AutoTextbookSetupFlow
        onSaved={onSaved}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: validCoverDataUrl,
          ownershipProofDataUrl: validOwnershipProofDataUrl,
          tocResult: {
            confidence: 0.9,
            chapters: [
              {
                chapterNumber: "1",
                title: "Integers",
                sections: [{ sectionNumber: "1.1", title: "Absolute Value" }],
              },
            ],
          },
          bypassImageModeration: true,
          metadataForm: {
            title: "Auto Algebra",
            grade: "8",
            gradeBand: "7-9",
            subject: "Math",
            edition: "2",
            publicationYear: "2026",
            isbnRaw: "9781402894626",
          },
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    expect(await screen.findByText(/Existing textbook found:/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm and Save Textbook" })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText("Resolution mode"), { target: { value: "merge_dedupe" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    await waitFor(() => {
      expect(repositoryMocks.editTextbook).toHaveBeenCalledWith(
        "tb-existing",
        expect.objectContaining({
          title: "Auto Algebra",
          sourceType: "auto",
        })
      );
    });
    expect(repositoryMocks.editChapter).toHaveBeenCalledWith(
      "ch-existing",
      expect.objectContaining({
        sourceType: "auto",
        name: "Integers",
      })
    );
    expect(repositoryMocks.editSection).toHaveBeenCalledWith(
      "sec-existing",
      expect.objectContaining({
        sourceType: "auto",
        title: "Absolute Value",
      })
    );
    expect(repositoryMocks.removeChapter).not.toHaveBeenCalled();
    expect(repositoryMocks.removeSection).not.toHaveBeenCalled();
    expect(coverServiceMocks.uploadTextbookCoverFromDataUrl).toHaveBeenCalledWith("tb-existing", validCoverDataUrl);
    expect(coverServiceMocks.uploadTextbookOwnershipProofFromDataUrl).toHaveBeenCalledWith("tb-existing", validOwnershipProofDataUrl);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("applies overwrite_auto choice by clearing old hierarchy and rebuilding from auto TOC", async () => {
    const onSaved = vi.fn();
    const validCoverDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=";

    repositoryMocks.findDuplicateTextbook.mockResolvedValue({
      id: "tb-existing-overwrite",
      title: "Manual Precalculus",
      isbnRaw: "9781402894000",
    });

    repositoryMocks.fetchChaptersByTextbookId.mockResolvedValue([
      {
        id: "ch-legacy",
        sourceType: "manual",
        textbookId: "tb-existing-overwrite",
        index: 1,
        name: "Legacy Chapter",
        lastModified: "2026-03-15T00:00:00.000Z",
        pendingSync: true,
        source: "local",
      },
    ]);

    repositoryMocks.fetchSectionsByChapterId.mockResolvedValue([
      {
        id: "sec-legacy",
        sourceType: "manual",
        textbookId: "tb-existing-overwrite",
        chapterId: "ch-legacy",
        index: 1,
        title: "Legacy Section",
        lastModified: "2026-03-15T00:00:00.000Z",
        pendingSync: true,
        source: "local",
      },
    ]);

    repositoryMocks.fetchVocabTermsBySectionId.mockResolvedValue([{ id: "v-legacy" }]);
    repositoryMocks.fetchEquationsBySectionId.mockResolvedValue([{ id: "eq-legacy" }]);
    repositoryMocks.fetchConceptsBySectionId.mockResolvedValue([{ id: "co-legacy" }]);
    repositoryMocks.fetchKeyIdeasBySectionId.mockResolvedValue([{ id: "ki-legacy" }]);

    repositoryMocks.createChapter.mockImplementation(async ({ index }) => `chapter-overwrite-${index}`);

    render(
      <AutoTextbookSetupFlow
        onSaved={onSaved}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: validCoverDataUrl,
          tocResult: {
            confidence: 0.92,
            chapters: [
              {
                chapterNumber: "1",
                title: "Functions",
                sections: [
                  { sectionNumber: "1.1", title: "Linear Functions" },
                  { sectionNumber: "1.2", title: "Quadratic Functions" },
                ],
              },
            ],
          },
          bypassImageModeration: true,
          metadataForm: {
            title: "Auto Precalculus",
            grade: "11",
            gradeBand: "10-12",
            subject: "Math",
            edition: "4",
            publicationYear: "2026",
            isbnRaw: "9781402894000",
          },
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    expect(await screen.findByText(/Existing textbook found:/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm and Save Textbook" })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText("Resolution mode"), { target: { value: "overwrite_auto" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    await waitFor(() => {
      expect(repositoryMocks.removeSection).toHaveBeenCalledWith("sec-legacy");
    });

    expect(repositoryMocks.removeVocabTerm).toHaveBeenCalledWith("v-legacy");
    expect(repositoryMocks.removeEquation).toHaveBeenCalledWith("eq-legacy");
    expect(repositoryMocks.removeConcept).toHaveBeenCalledWith("co-legacy");
    expect(repositoryMocks.removeKeyIdea).toHaveBeenCalledWith("ki-legacy");
    expect(repositoryMocks.removeChapter).toHaveBeenCalledWith("ch-legacy");

    expect(repositoryMocks.createChapter).toHaveBeenCalledWith(
      expect.objectContaining({
        textbookId: "tb-existing-overwrite",
        sourceType: "auto",
        name: "Functions",
      })
    );
    expect(repositoryMocks.createSection).toHaveBeenCalledTimes(2);
    expect(repositoryMocks.createSection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chapterId: "chapter-overwrite-1",
        sourceType: "auto",
        title: "Linear Functions",
      })
    );
    expect(repositoryMocks.editChapter).not.toHaveBeenCalled();
    expect(repositoryMocks.editSection).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("fail-first: completes save and attempts immediate upload even when metadata-learning sync hangs", async () => {
    const onSaved = vi.fn();
    const validCoverDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=";

    window.localStorage.setItem(METADATA_CORRECTION_STORAGE_KEYS.optedIn, "true");
    repositoryMocks.findTextbookByISBN.mockResolvedValue(undefined);
    metadataCorrectionSyncMocks.syncMetadataCorrectionLearning.mockImplementation(
      async () => new Promise(() => undefined)
    );

    render(
      <AutoTextbookSetupFlow
        onSaved={onSaved}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: validCoverDataUrl,
          tocResult: {
            confidence: 0.96,
            chapters: [
              {
                chapterNumber: "31",
                title: "Astronomy",
                pageStart: 820,
                sections: [
                  { sectionNumber: "31.2", title: "Evolution of Stars", pageStart: 825 },
                  { sectionNumber: "31.3", title: "Galaxies of the Milky Way", pageStart: 832 },
                  { sectionNumber: "31.4", title: "Cosmology", pageStart: 837 },
                  { sectionNumber: "", title: "Astrobiological Debates", pageStart: 841 },
                  { sectionNumber: "", title: "Module Wrap-Up", pageStart: 843, pageEnd: 843 },
                ],
              },
            ],
          },
          bypassImageModeration: true,
          metadataForm: {
            title: "Inspire Physical Science",
            grade: "8",
            gradeBand: "7-9",
            subject: "Science",
            edition: "Student",
            publicationYear: "2026",
            isbnRaw: "9780076716852",
          },
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    await waitFor(() => {
      expect(repositoryMocks.createTextbook).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it("shows save and upload progress after pressing Confirm and Save Textbook", async () => {
    const validCoverDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=";

    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: validCoverDataUrl,
          tocResult: {
            confidence: 0.93,
            chapters: [
              {
                chapterNumber: "1",
                title: "Astronomy",
                sections: [{ sectionNumber: "1.1", title: "Cosmology", pageStart: 12 }],
              },
            ],
          },
          bypassImageModeration: true,
          metadataForm: {
            title: "Inspire Physical Science",
            grade: "8",
            gradeBand: "7-9",
            subject: "Science",
            edition: "Student",
            publicationYear: "2026",
            isbnRaw: "9780076716852",
          },
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    expect(await screen.findByText(/Save and Upload Progress:/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Textbook upload progress" })).toBeInTheDocument();
  });

  it("retries immediate upload once after sync throttling and reaches completion", async () => {
    const onSaved = vi.fn();

    syncServiceMocks.syncNow
      .mockResolvedValueOnce({
        success: false,
        message: "Sync skipped to avoid excessive write frequency.",
        retryable: false,
        permissionDenied: false,
        throttled: true,
        writeLoopTriggered: false,
        writeBudgetExceeded: false,
        writeCount: 0,
        writeBudgetLimit: 500,
        readCount: 0,
        readBudgetLimit: 5000,
        readBudgetExceeded: false,
        retryLimit: 3,
        errorCode: null,
        pendingCount: 1,
      })
      .mockResolvedValueOnce({
        success: true,
        message: "Sync completed successfully.",
        retryable: false,
        permissionDenied: false,
        throttled: false,
        writeLoopTriggered: false,
        writeBudgetExceeded: false,
        writeCount: 1,
        writeBudgetLimit: 500,
        readCount: 0,
        readBudgetLimit: 5000,
        readBudgetExceeded: false,
        retryLimit: 3,
        errorCode: null,
        pendingCount: 0,
      });

    render(
      <AutoTextbookSetupFlow
        onSaved={onSaved}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          ocrDraft: SOURCE_OF_TRUTH_COPYRIGHT_OCR_TEXT,
          tocResult: SOURCE_OF_TRUTH_TOC,
          bypassImageModeration: true,
          metadataForm: {
            title: "Inspire Physical Science with Earth Science",
            grade: "9",
            gradeBand: "7-9",
            subject: "Science",
            edition: "Student",
            publicationYear: "2021",
            isbnRaw: "978-0-07-671685-2",
            publisher: "McGraw-Hill Education",
            publisherLocation: "STEM Learning Solutions Center, 8787 Orion Place, Columbus, OH 43240",
            mhid: "0-07-671685-6",
          },
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    await waitFor(() => {
      expect(repositoryMocks.createTextbook).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText(/Upload queued\. Waiting for sync window\./i)).toBeInTheDocument();

    await waitFor(() => {
      expect(syncServiceMocks.syncNow).toHaveBeenCalledTimes(2);
    }, { timeout: 9000 });

    expect(await screen.findByText(/Upload complete\./i)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("clears resumable TOC draft immediately after local save, even when cloud upload fails", async () => {
    const resumableDraftId = "resume-clear-on-local-save";
    const now = Date.now();

    window.localStorage.setItem(
      AUTO_SESSION_DRAFTS_KEY,
      JSON.stringify([
        {
          id: resumableDraftId,
          version: 1,
          savedAt: now,
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          rawOcrText: SOURCE_OF_TRUTH_COPYRIGHT_OCR_TEXT,
          metadataTitle: "Inspire Physical Science with Earth Science",
          metadataSubject: "Science",
          metadataPublisher: "McGraw-Hill Education",
          metadataFormSnapshot: {
            title: "Inspire Physical Science with Earth Science",
            subtitle: "",
            grade: "9",
            gradeBand: "7-9",
            subject: "Science",
            edition: "Student",
            publicationYear: "2021",
            copyrightYear: "2021",
            isbnRaw: "978-0-07-671685-2",
            additionalIsbnsCsv: "",
            seriesName: "",
            publisher: "McGraw-Hill Education",
            publisherLocation: "STEM Learning Solutions Center, 8787 Orion Place, Columbus, OH 43240",
            platformUrl: "",
            mhid: "0-07-671685-6",
            authorsCsv: "",
            tocExtractionConfidence: "0.95",
          },
          relatedIsbnsSnapshot: [],
          step: "toc-editor",
          stepsCompleted: { cover: true, copyright: true },
        },
      ])
    );

    syncServiceMocks.syncNow.mockResolvedValue({
      success: false,
      message: "Signed in successfully, but cloud sync is temporarily unavailable. Local data remains available.",
      retryable: true,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: false,
      writeBudgetExceeded: false,
      writeCount: 0,
      writeBudgetLimit: 500,
      readCount: 0,
      readBudgetLimit: 5000,
      readBudgetExceeded: false,
      retryLimit: 3,
      errorCode: null,
      pendingCount: 1,
    });

    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          tocResult: SOURCE_OF_TRUTH_TOC,
          metadataForm: {
            title: "Inspire Physical Science with Earth Science",
            grade: "9",
            gradeBand: "7-9",
            subject: "Science",
            edition: "Student",
            publicationYear: "2021",
            isbnRaw: "978-0-07-671685-2",
            publisher: "McGraw-Hill Education",
            publisherLocation: "STEM Learning Solutions Center, 8787 Orion Place, Columbus, OH 43240",
            mhid: "0-07-671685-6",
          },
          bypassImageModeration: true,
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    await waitFor(() => {
      expect(repositoryMocks.createTextbook).toHaveBeenCalledTimes(1);
    });

    // Draft should be cleared immediately after local save, regardless of cloud sync status.
    // This prevents duplicate entries: stale draft in Auto Add queue + fresh textbook in main list.
    const savedDraftsRaw = window.localStorage.getItem(AUTO_SESSION_DRAFTS_KEY);
    const savedDrafts = JSON.parse(savedDraftsRaw ?? "[]") as Array<{ id: string }>;
    expect(savedDrafts.some((draft) => draft.id === resumableDraftId)).toBe(false);
  });

  it("source-of-truth: replays OCR-derived cover/copyright/TOC data and saves hierarchy with upload attempt", async () => {
    const onSaved = vi.fn();
    repositoryMocks.findTextbookByISBN.mockResolvedValue(undefined);

    render(
      <AutoTextbookSetupFlow
        onSaved={onSaved}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          ocrDraft: SOURCE_OF_TRUTH_COPYRIGHT_OCR_TEXT,
          tocResult: SOURCE_OF_TRUTH_TOC,
          tocPages: [
            {
              pageIndex: 0,
              confidence: SOURCE_OF_TRUTH_TOC.confidence,
              chapters: SOURCE_OF_TRUTH_TOC.chapters,
            },
          ],
          bypassImageModeration: true,
          metadataForm: {
            title: "Inspire Physical Science with Earth Science",
            grade: "9",
            gradeBand: "7-9",
            subject: "Science",
            edition: "Student",
            publicationYear: "2021",
            isbnRaw: "978-0-07-671685-2",
            publisher: "McGraw-Hill Education",
            publisherLocation: "STEM Learning Solutions Center, 8787 Orion Place, Columbus, OH 43240",
            mhid: "0-07-671685-6",
          },
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm and Save Textbook" }));

    await waitFor(() => {
      expect(repositoryMocks.createTextbook).toHaveBeenCalledTimes(1);
    });

    expect(repositoryMocks.createTextbook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Inspire Physical Science with Earth Science",
        subject: "Science",
        publicationYear: 2021,
        isbnRaw: "978-0-07-671685-2",
      })
    );
    expect(repositoryMocks.createChapter).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.createSection).toHaveBeenCalledTimes(6);

    await waitFor(() => {
      expect(syncServiceMocks.syncNow).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it("builds live TOC hierarchy preview with computed ranges from OCR text", async () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          ocrDraft: "initial placeholder",
        }}
      />
    );

    const tocOcrInput = screen.getByLabelText(/OCR text/i);
    fireEvent.click(tocOcrInput);
    fireEvent.change(tocOcrInput, {
      target: {
        value: [
          "MODULE 1: THE NATURE OF SCIENCE",
          "CER Claim, Evidence, Reasoning 3",
          "Lesson 1 The Methods of Science 4",
          "Lesson 2 Standards of Measurement 12",
          "Lesson 3 Communicating with Graphs 19",
          "MODULE 2: MOTION",
          "CER Claim, Evidence, Reasoning 37",
          "Lesson 1 Describing Motion 38",
        ].join("\n"),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Re-parse TOC Text" }));

    expect(await screen.findByText(/Live TOC Structure Preview/i)).toBeInTheDocument();
    expect(await screen.findByText(/^Module 1$/i, { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText(/NATURE OF SCIENCE/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/pp\. 3-36/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Methods of Science/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/pp\. 4-11/i).length).toBeGreaterThan(0);
  });

  it("clears title OCR buffers when advancing into TOC capture step", async () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "title",
          coverImageDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          ownershipProofDataUrl: SOURCE_OF_TRUTH_COVER_DATA_URL,
          ocrDraft: "Copyright title draft text that should stay partitioned to title step",
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(await screen.findByRole("button", { name: "Capture TOC Page" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/OCR text/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Raw OCR Output/i)).not.toBeInTheDocument();
  });

});

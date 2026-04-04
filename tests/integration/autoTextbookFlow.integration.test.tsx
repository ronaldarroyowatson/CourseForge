import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { METADATA_CORRECTION_STORAGE_KEYS } from "../../src/core/services/metadataCorrectionLearningService";
import { persistAutoTextbook } from "../../src/core/services/autoTextbookPersistenceService";
import type { TocChapter } from "../../src/core/services/textbookAutoExtractionService";
import { AutoTextbookSetupFlow } from "../../src/webapp/components/textbooks/AutoTextbookSetupFlow";
import { TextbookForm } from "../../src/webapp/components/textbooks/TextbookForm";
import { useUIStore } from "../../src/webapp/store/uiStore";

const AUTO_SESSION_DRAFTS_KEY = "courseforge.autoSessionDrafts.v2";

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
  createTextbook: vi.fn<(input: any) => Promise<string>>(async () => "textbook-1"),
  editTextbook: vi.fn<(id: string, changes: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({ id: "textbook-1" })),
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
}));

type MockSyncNowResult = {
  success: boolean;
  message: string;
  retryable: boolean;
  permissionDenied: boolean;
  throttled: boolean;
  writeLoopTriggered: boolean;
  writeBudgetExceeded: boolean;
  writeCount: number;
  writeBudgetLimit: number;
  readCount: number;
  readBudgetLimit: number;
  readBudgetExceeded: boolean;
  retryLimit: number;
  errorCode: string | null;
  pendingCount: number;
};

const syncServiceMocks = vi.hoisted(() => ({
  findCloudTextbookByISBN: vi.fn<(userId: string, isbnRaw: string) => Promise<null>>(async () => null),
  syncNow: vi.fn<(deps?: unknown) => Promise<MockSyncNowResult>>(async () => ({
    success: true,
    message: "Cloud sync completed.",
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
}));

vi.mock("../../src/core/services/coverImageService", () => ({
  uploadTextbookCoverFromDataUrl: (textbookId: string, dataUrl: string) => coverServiceMocks.uploadTextbookCoverFromDataUrl(textbookId, dataUrl),
  uploadTextbookCoverImage: vi.fn(async () => "cover://mock"),
}));

vi.mock("../../src/webapp/hooks/useRepositories", () => ({
  useRepositories: () => ({
    createTextbook: repositoryMocks.createTextbook,
    editTextbook: repositoryMocks.editTextbook,
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

vi.mock("../../src/core/services/syncService", () => ({
  findCloudTextbookByISBN: (userId: string, isbnRaw: string) => syncServiceMocks.findCloudTextbookByISBN(userId, isbnRaw),
  syncNow: (deps?: unknown) => syncServiceMocks.syncNow(deps),
}));

describe("auto textbook flow integration", () => {
  beforeEach(() => {
    repositoryMocks.createTextbook.mockClear();
    repositoryMocks.editTextbook.mockClear();
    repositoryMocks.findTextbookByISBN.mockClear();
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
    syncServiceMocks.findCloudTextbookByISBN.mockClear();
    syncServiceMocks.syncNow.mockClear();

    repositoryMocks.findTextbookByISBN.mockResolvedValue(undefined);
    repositoryMocks.fetchChaptersByTextbookId.mockResolvedValue([]);
    repositoryMocks.fetchSectionsByChapterId.mockResolvedValue([]);
    repositoryMocks.fetchVocabTermsBySectionId.mockResolvedValue([]);
    repositoryMocks.fetchEquationsBySectionId.mockResolvedValue([]);
    repositoryMocks.fetchConceptsBySectionId.mockResolvedValue([]);
    repositoryMocks.fetchKeyIdeasBySectionId.mockResolvedValue([]);
    syncServiceMocks.findCloudTextbookByISBN.mockResolvedValue(null);
    syncServiceMocks.syncNow.mockResolvedValue({
      success: true,
      message: "Cloud sync completed.",
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

    useUIStore.setState({
      selectedTextbook: null,
      selectedTextbookId: null,
    });

    // Keep integration tests deterministic by opting out of metadata-learning uploads.
    window.localStorage.setItem(METADATA_CORRECTION_STORAGE_KEYS.optedIn, "false");
    window.localStorage.removeItem(METADATA_CORRECTION_STORAGE_KEYS.corrections);
    window.localStorage.removeItem(AUTO_SESSION_DRAFTS_KEY);
    window.localStorage.removeItem("courseforge.autoSessionDraft.v1");
    metadataPipelineMocks.extractMetadataWithOcrFallbackFromDataUrl.mockClear();
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

  it("keeps optional metadata fields collapsed by default even when some optional values are populated", () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "cover",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          metadataDraft: {
            title: "Inspire Physical Science",
            subtitle: "with Earth Science",
            publisher: "McGraw Hill",
            copyrightYear: 2021,
          },
        }}
      />
    );

    expect(screen.getByRole("button", { name: /Show optional fields/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Subtitle")).not.toBeInTheDocument();
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

  it("restores typed related ISBN metadata when resuming a queued draft", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Show optional fields/i }));

    expect((screen.getByDisplayValue("Teacher Edition") as HTMLInputElement).value).toBe("Teacher Edition");
  });

  it("restores full TOC tree when resuming a queued TOC draft", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      AUTO_SESSION_DRAFTS_KEY,
      JSON.stringify([
        {
          id: "resume-toc-draft",
          version: 1,
          savedAt: now,
          coverImageDataUrl: "data:image/png;base64,a",
          rawOcrText: "MODULE 1: MATTER\nLesson 1 Atoms 10\nLesson 2 Elements 18",
          metadataTitle: "Physical Science",
          metadataSubject: "Science",
          metadataPublisher: "McGraw Hill",
          metadataFormSnapshot: {
            title: "Physical Science",
            subtitle: "",
            grade: "",
            gradeBand: "",
            subject: "Science",
            edition: "",
            publicationYear: "2026",
            copyrightYear: "2026",
            isbnRaw: "",
            seriesName: "",
            publisher: "McGraw Hill",
            publisherLocation: "",
            platformUrl: "",
            mhid: "",
            authorsCsv: "",
            tocExtractionConfidence: "0.91",
          },
          relatedIsbnsSnapshot: [],
          tocResultSnapshot: {
            confidence: 0.91,
            chapters: [
              {
                chapterNumber: "1",
                title: "MATTER",
                chapterLabel: "Module",
                pageStart: 10,
                pageEnd: 19,
                sections: [
                  { sectionNumber: "1.1", title: "Atoms", pageStart: 10, pageEnd: 17 },
                  { sectionNumber: "1.2", title: "Elements", pageStart: 18, pageEnd: 19 },
                ],
              },
            ],
          },
          tocPagesSnapshot: [
            {
              pageIndex: 0,
              confidence: 0.91,
              chapters: [
                {
                  chapterNumber: "1",
                  title: "MATTER",
                  chapterLabel: "Module",
                  pageStart: 10,
                  pageEnd: 19,
                  sections: [
                    { sectionNumber: "1.1", title: "Atoms", pageStart: 10, pageEnd: 17 },
                    { sectionNumber: "1.2", title: "Elements", pageStart: 18, pageEnd: 19 },
                  ],
                },
              ],
            },
          ],
          step: "toc",
          stepsCompleted: { cover: true, copyright: true, toc: true },
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

    expect(await screen.findByText(/Live TOC Structure Preview/i)).toBeInTheDocument();
    expect(screen.getAllByText(/MATTER/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Capture TOC Page" })).toBeInTheDocument();
  });

  it("removes legacy TOC-end buttons and uses Save Textbook to Cloud", () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          ocrDraft: "Copyright 2026",
          metadataForm: {
            title: "Cloud Algebra",
            grade: "8",
            gradeBand: "7-9",
            subject: "Math",
            edition: "2",
            publicationYear: "2026",
            copyrightYear: "2026",
            isbnRaw: "9781402894626",
          },
          tocResult: {
            confidence: 0.92,
            chapters: [
              {
                chapterNumber: "1",
                title: "Integers",
                pageStart: 10,
                pageEnd: 20,
                sections: [{ sectionNumber: "1.1", title: "Absolute Value", pageStart: 10, pageEnd: 14 }],
              },
            ],
          },
          bypassImageModeration: true,
        }}
      />
    );

    expect(screen.queryByRole("button", { name: "Confirm and Save Textbook" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save TOC to Server" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Textbook to Cloud" })).toBeInTheDocument();
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

  it("persists textbook, chapters, and sections while only storing cover image data", async () => {
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
    render(<TextbookForm onSaved={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /Auto \(Recommended\)/i }));

    const ocrInput = screen.getByLabelText(/OCR text/i);
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

    repositoryMocks.findTextbookByISBN.mockResolvedValue({
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

    fireEvent.click(screen.getByRole("button", { name: "Save Textbook to Cloud" }));

    expect(await screen.findByText(/Existing textbook found:/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Textbook to Cloud" })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText("Resolution mode"), { target: { value: "merge_dedupe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Textbook to Cloud" }));

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
    expect(syncServiceMocks.syncNow).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("applies overwrite_auto choice by clearing old hierarchy and rebuilding from auto TOC", async () => {
    const onSaved = vi.fn();
    const validCoverDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=";

    repositoryMocks.findTextbookByISBN.mockResolvedValue({
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

    fireEvent.click(screen.getByRole("button", { name: "Save Textbook to Cloud" }));

    expect(await screen.findByText(/Existing textbook found:/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Textbook to Cloud" })).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText("Resolution mode"), { target: { value: "overwrite_auto" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Textbook to Cloud" }));

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
    expect(syncServiceMocks.syncNow).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("shows Save Locally Only on homepage only and not at TOC-end", () => {
    render(<TextbookForm onSaved={() => undefined} />);
    expect(screen.getByRole("button", { name: "Save Locally Only" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Auto \(Recommended\)/i }));
    expect(screen.queryByRole("button", { name: "Save Locally Only" })).not.toBeInTheDocument();
  });

  it("saves in local-only mode without cloud upload sync", async () => {
    const onSaved = vi.fn();
    render(
      <AutoTextbookSetupFlow
        saveMode="local"
        onSaved={onSaved}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          ocrDraft: "Copyright 2026",
          metadataForm: {
            title: "Offline Biology",
            grade: "9",
            gradeBand: "9-10",
            subject: "Science",
            edition: "1",
            publicationYear: "2026",
            copyrightYear: "2026",
            isbnRaw: "9781402894001",
          },
          tocResult: {
            confidence: 0.9,
            chapters: [
              {
                chapterNumber: "1",
                title: "Cells",
                pageStart: 1,
                pageEnd: 12,
                sections: [{ sectionNumber: "1.1", title: "Cell Theory", pageStart: 1, pageEnd: 5 }],
              },
            ],
          },
          bypassImageModeration: true,
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Textbook Locally" }));

    await waitFor(() => {
      expect(repositoryMocks.createTextbook).toHaveBeenCalled();
      const firstCreateCall = repositoryMocks.createTextbook.mock.calls.at(0)?.[0];
      expect(firstCreateCall).toEqual(
        expect.objectContaining({
          title: "Offline Biology",
          cloudSyncBlockedReason: "user_blocked",
        })
      );
    });
    expect(syncServiceMocks.syncNow).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("shows cloud upload progress message and refreshes library callback on successful upload", async () => {
    let resolveSync!: (value: MockSyncNowResult) => void;
    const deferredSync = new Promise<MockSyncNowResult>((resolve) => {
      resolveSync = resolve;
    });
    syncServiceMocks.syncNow.mockImplementationOnce(() => deferredSync);
    const onSaved = vi.fn();

    render(
      <AutoTextbookSetupFlow
        saveMode="cloud"
        onSaved={onSaved}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          ocrDraft: "Copyright 2026",
          metadataForm: {
            title: "Cloud Chemistry",
            grade: "10",
            gradeBand: "10-11",
            subject: "Science",
            edition: "1",
            publicationYear: "2026",
            copyrightYear: "2026",
            isbnRaw: "9781402894002",
          },
          tocResult: {
            confidence: 0.9,
            chapters: [
              {
                chapterNumber: "1",
                title: "Atoms",
                pageStart: 2,
                pageEnd: 18,
                sections: [{ sectionNumber: "1.1", title: "Elements", pageStart: 2, pageEnd: 8 }],
              },
            ],
          },
          bypassImageModeration: true,
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Textbook to Cloud" }));
    expect(screen.getAllByText("Uploading textbook to cloud...").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(syncServiceMocks.syncNow).toHaveBeenCalledTimes(1);
    });

    resolveSync({
      success: true,
      message: "Cloud sync completed.",
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

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it("supports adding missing hierarchy levels and preserving downstream structure", async () => {
    render(
      <AutoTextbookSetupFlow
        saveMode="local"
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          ocrDraft: "Copyright 2026",
          metadataForm: {
            title: "Hierarchy Test",
            grade: "8",
            gradeBand: "7-9",
            subject: "Math",
            edition: "1",
            publicationYear: "2026",
            copyrightYear: "2026",
            isbnRaw: "9781402894003",
          },
          tocResult: {
            confidence: 0.9,
            chapters: [
              {
                chapterNumber: "1",
                title: "Integers",
                sections: [{ sectionNumber: "1.1", title: "Absolute Value", pageStart: 10, pageEnd: 14 }],
              },
              {
                chapterNumber: "2",
                title: "Expressions",
                sections: [{ sectionNumber: "2.1", title: "Variables", pageStart: 20, pageEnd: 25 }],
              },
            ],
          },
          bypassImageModeration: true,
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Missing Hierarchy Level" }));

    fireEvent.change(screen.getByLabelText("Hierarchy Level"), { target: { value: "unit" } });
    fireEvent.change(screen.getByLabelText("Number"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Foundations" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Hierarchy Level" }));

    fireEvent.change(screen.getByLabelText("Hierarchy Level"), { target: { value: "chapter" } });
    fireEvent.change(screen.getByLabelText("Number"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Functions" } });
    fireEvent.change(screen.getByLabelText("Unit Assignment"), { target: { value: "Unit 1 Foundations" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Hierarchy Level" }));

    expect(screen.getByDisplayValue("Functions")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Hierarchy Level"), { target: { value: "subsection" } });
    fireEvent.change(screen.getByLabelText("Parent Chapter"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Parent Section"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Number"), { target: { value: "1.1.1" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Absolute Value Word Problems" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Hierarchy Level" }));

    expect(screen.getByDisplayValue("1.1.1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Absolute Value Word Problems")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2.1")).toBeInTheDocument();
  });

  it("builds live TOC hierarchy preview with computed ranges from OCR text", async () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
        }}
      />
    );

    fireEvent.change(screen.getByLabelText(/OCR text/i), {
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

  it("shows Save Textbook to Cloud action after finishing TOC", async () => {
    render(
      <AutoTextbookSetupFlow
        onSaved={() => undefined}
        onSwitchToManual={() => undefined}
        testingSeedState={{
          step: "toc-editor",
          coverImageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
          tocResult: {
            confidence: 0.93,
            chapters: [
              {
                chapterNumber: "1",
                title: "Waves",
                sections: [{ sectionNumber: "1.1", title: "Electromagnetic Waves", pageStart: 10 }],
              },
            ],
          },
          metadataForm: {
            title: "Physics",
            subject: "Science",
            edition: "1",
            publicationYear: "2026",
            isbnRaw: "",
          },
          bypassImageModeration: true,
        }}
      />
    );

    expect(screen.getByRole("button", { name: "Save Textbook to Cloud" })).toBeInTheDocument();
  });
});

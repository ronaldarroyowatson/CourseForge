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
});

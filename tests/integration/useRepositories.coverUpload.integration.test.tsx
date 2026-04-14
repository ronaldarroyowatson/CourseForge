import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../src/webapp/store/uiStore";

const repositoryMocks = vi.hoisted(() => ({
  deleteConcept: vi.fn(async () => undefined),
  deleteEquation: vi.fn(async () => undefined),
  deleteChapter: vi.fn(async () => undefined),
  deleteKeyIdea: vi.fn(async () => undefined),
  deleteSection: vi.fn(async () => undefined),
  deleteTextbook: vi.fn(async () => undefined),
  deleteVocabTerm: vi.fn(async () => undefined),
  updateChapter: vi.fn(async () => ({ id: "ch-1" })),
  updateSection: vi.fn(async () => ({ id: "sec-1" })),
  findTextbookByIsbn: vi.fn(async () => undefined),
  getChapterById: vi.fn(async () => undefined),
  getSectionById: vi.fn(async () => undefined),
  listChaptersByTextbookId: vi.fn(async () => []),
  listConceptsBySectionId: vi.fn(async () => []),
  listEquationsBySectionId: vi.fn(async () => []),
  listKeyIdeasBySectionId: vi.fn(async () => []),
  listSectionsByChapterId: vi.fn(async () => []),
  listTextbooks: vi.fn(async () => []),
  listVocabTermsBySectionId: vi.fn(async () => []),
  saveChapter: vi.fn(async (value: { id: string }) => value.id),
  saveConcept: vi.fn(async (value: { id: string }) => value.id),
  saveEquation: vi.fn(async (value: { id: string }) => value.id),
  saveKeyIdea: vi.fn(async (value: { id: string }) => value.id),
  saveSection: vi.fn(async (value: { id: string }) => value.id),
  saveTextbook: vi.fn(async (value: { id: string }) => value.id),
  saveVocabTerm: vi.fn(async (value: { id: string }) => value.id),
  updateTextbook: vi.fn(async () => ({ id: "tb-1" })),
  updateTextbookFlags: vi.fn(async () => ({ id: "tb-1" })),
}));

const coverServiceMocks = vi.hoisted(() => ({
  uploadTextbookCoverFromDataUrl: vi.fn(async () => "https://example.com/cover.png"),
  uploadTextbookCoverImage: vi.fn(async () => "https://example.com/cover-file.png"),
}));

vi.mock("../../src/core/services/repositories", () => ({
  deleteConcept: repositoryMocks.deleteConcept,
  deleteEquation: repositoryMocks.deleteEquation,
  deleteChapter: repositoryMocks.deleteChapter,
  deleteKeyIdea: repositoryMocks.deleteKeyIdea,
  deleteSection: repositoryMocks.deleteSection,
  deleteTextbook: repositoryMocks.deleteTextbook,
  deleteVocabTerm: repositoryMocks.deleteVocabTerm,
  updateChapter: repositoryMocks.updateChapter,
  updateSection: repositoryMocks.updateSection,
  findTextbookByIsbn: repositoryMocks.findTextbookByIsbn,
  getChapterById: repositoryMocks.getChapterById,
  getSectionById: repositoryMocks.getSectionById,
  listChaptersByTextbookId: repositoryMocks.listChaptersByTextbookId,
  listConceptsBySectionId: repositoryMocks.listConceptsBySectionId,
  listEquationsBySectionId: repositoryMocks.listEquationsBySectionId,
  listKeyIdeasBySectionId: repositoryMocks.listKeyIdeasBySectionId,
  listSectionsByChapterId: repositoryMocks.listSectionsByChapterId,
  listTextbooks: repositoryMocks.listTextbooks,
  listVocabTermsBySectionId: repositoryMocks.listVocabTermsBySectionId,
  saveChapter: repositoryMocks.saveChapter,
  saveConcept: repositoryMocks.saveConcept,
  saveEquation: repositoryMocks.saveEquation,
  saveKeyIdea: repositoryMocks.saveKeyIdea,
  saveSection: repositoryMocks.saveSection,
  saveTextbook: repositoryMocks.saveTextbook,
  saveVocabTerm: repositoryMocks.saveVocabTerm,
  updateTextbook: repositoryMocks.updateTextbook,
  updateTextbookFlags: repositoryMocks.updateTextbookFlags,
}));

vi.mock("../../src/core/services/coverImageService", () => ({
  uploadTextbookCoverFromDataUrl: coverServiceMocks.uploadTextbookCoverFromDataUrl,
  uploadTextbookCoverImage: coverServiceMocks.uploadTextbookCoverImage,
}));

import { useRepositories } from "../../src/webapp/hooks/useRepositories";

describe("useRepositories createTextbook cover upload resilience", () => {
  beforeEach(() => {
    repositoryMocks.saveTextbook.mockClear();
    coverServiceMocks.uploadTextbookCoverFromDataUrl.mockClear();
    useUIStore.setState({ localChangeVersion: 0 });
  });

  it("saves textbook locally even when cover upload fails", async () => {
    coverServiceMocks.uploadTextbookCoverFromDataUrl.mockRejectedValueOnce(new Error("Storage timeout"));

    const { result } = renderHook(() => useRepositories());

    let createdId = "";
    await act(async () => {
      createdId = await result.current.createTextbook({
        sourceType: "auto",
        title: "Network Resilience",
        grade: "9",
        subject: "Science",
        edition: "1",
        publicationYear: 2026,
        isbnRaw: "9781402891001",
        isbnNormalized: "9781402891001",
        coverDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn8n7wAAAAASUVORK5CYII=",
      });
    });

    expect(createdId).toBeTruthy();
    expect(repositoryMocks.saveTextbook).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.saveTextbook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Network Resilience",
        coverImageUrl: null,
        translatedFields: {},
      })
    );
    expect(useUIStore.getState().localChangeVersion).toBe(1);
  });

  it("defaults translatedFields to an empty object when omitted", async () => {
    const { result } = renderHook(() => useRepositories());

    await act(async () => {
      await result.current.createTextbook({
        sourceType: "manual",
        title: "Default Translation Fields",
        grade: "10",
        subject: "Biology",
        edition: "1",
        publicationYear: 2026,
        isbnRaw: "9781402891002",
        isbnNormalized: "9781402891002",
      });
    });

    expect(repositoryMocks.saveTextbook).toHaveBeenCalledWith(
      expect.objectContaining({
        translatedFields: {},
      })
    );
  });
});

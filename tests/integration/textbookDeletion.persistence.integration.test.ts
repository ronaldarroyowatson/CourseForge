import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Textbook } from "../../src/core/models";

const repositoryMocks = vi.hoisted(() => ({
  listTextbooks: vi.fn(async () => []),
  saveTextbook: vi.fn(async () => "tb-1"),
  deleteTextbook: vi.fn(async () => undefined),
  getTextbookById: vi.fn<(id: string) => Promise<Textbook | undefined>>(async () => undefined),
  findDuplicateTextbookCandidate: vi.fn(async () => undefined),
  findTextbookByIsbn: vi.fn(async () => undefined),
  updateTextbook: vi.fn(async () => {
    throw new Error("not implemented");
  }),
  updateTextbookFlags: vi.fn(async () => {
    throw new Error("not implemented");
  }),
  listChaptersByTextbookId: vi.fn(async () => []),
  listSectionsByChapterId: vi.fn(async () => []),
  listVocabTermsBySectionId: vi.fn(async () => []),
  listEquationsBySectionId: vi.fn(async () => []),
  listConceptsBySectionId: vi.fn(async () => []),
  listKeyIdeasBySectionId: vi.fn(async () => []),
  saveChapter: vi.fn(async () => "ch-1"),
  saveSection: vi.fn(async () => "sec-1"),
  saveVocabTerm: vi.fn(async () => "vocab-1"),
  saveEquation: vi.fn(async () => "eq-1"),
  saveConcept: vi.fn(async () => "concept-1"),
  saveKeyIdea: vi.fn(async () => "keyidea-1"),
  getChapterById: vi.fn(async () => undefined),
  getSectionById: vi.fn(async () => undefined),
  deleteChapter: vi.fn(async () => undefined),
  deleteSection: vi.fn(async () => undefined),
  deleteVocabTerm: vi.fn(async () => undefined),
  deleteEquation: vi.fn(async () => undefined),
  deleteConcept: vi.fn(async () => undefined),
  deleteKeyIdea: vi.fn(async () => undefined),
}));

const syncMocks = vi.hoisted(() => ({
  hardDeleteTextbookFromCloud: vi.fn(async () => undefined),
}));

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => { uid: string } | null>(() => ({ uid: "user-1" })),
}));

const uiStoreMocks = vi.hoisted(() => ({
  markLocalChange: vi.fn(),
}));

vi.mock("../../src/core/services/repositories", () => repositoryMocks);

vi.mock("../../src/core/services/coverImageService", () => ({
  uploadTextbookCoverFromDataUrl: vi.fn(async () => "https://example.invalid/cover.png"),
  uploadTextbookCoverImage: vi.fn(async () => "https://example.invalid/cover.png"),
}));

vi.mock("../../src/core/services/syncService", () => syncMocks);

vi.mock("../../src/firebase/auth", () => authMocks);

vi.mock("../../src/webapp/store/uiStore", () => ({
  useUIStore: (selector: (state: { markLocalChange: () => void }) => unknown) =>
    selector({ markLocalChange: uiStoreMocks.markLocalChange }),
}));

import { useRepositories } from "../../src/webapp/hooks/useRepositories";

function buildTextbook(overrides: Partial<Textbook> = {}): Textbook {
  const now = "2026-04-26T00:00:00.000Z";
  return {
    id: "tb-1",
    sourceType: "manual",
    originalLanguage: "en",
    title: "Biology",
    grade: "8",
    subject: "Science",
    edition: "1",
    publicationYear: 2025,
    isbnRaw: "",
    isbnNormalized: "",
    createdAt: now,
    updatedAt: now,
    lastModified: now,
    pendingSync: false,
    source: "local",
    isFavorite: false,
    isArchived: false,
    ...overrides,
  };
}

describe("textbook deletion persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.getCurrentUser.mockReturnValue({ uid: "user-1" });
    syncMocks.hardDeleteTextbookFromCloud.mockResolvedValue(undefined);
    repositoryMocks.getTextbookById.mockResolvedValue(buildTextbook());
  });

  it("stores a local tombstone when cloud hard-delete fails so refresh cannot resurrect textbook", async () => {
    syncMocks.hardDeleteTextbookFromCloud.mockRejectedValueOnce(new Error("permission-denied"));

    const { result } = renderHook(() => useRepositories());

    await result.current.removeTextbook("tb-1");

    expect(repositoryMocks.deleteTextbook).toHaveBeenCalledWith("tb-1");
    expect(repositoryMocks.saveTextbook).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.saveTextbook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tb-1",
        isDeleted: true,
        pendingSync: true,
        source: "local",
      })
    );
  });

  it("does not write a tombstone when cloud hard-delete succeeds", async () => {
    const { result } = renderHook(() => useRepositories());

    await result.current.removeTextbook("tb-1");

    expect(repositoryMocks.deleteTextbook).toHaveBeenCalledWith("tb-1");
    expect(repositoryMocks.saveTextbook).not.toHaveBeenCalled();
  });

  it("stores a local tombstone when auth is unavailable for a cloud-owned textbook", async () => {
    authMocks.getCurrentUser.mockReturnValue(null);
    repositoryMocks.getTextbookById.mockResolvedValue(buildTextbook({ userId: "user-1" }));

    const { result } = renderHook(() => useRepositories());

    await result.current.removeTextbook("tb-1");

    expect(syncMocks.hardDeleteTextbookFromCloud).not.toHaveBeenCalled();
    expect(repositoryMocks.deleteTextbook).toHaveBeenCalledWith("tb-1");
    expect(repositoryMocks.saveTextbook).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.saveTextbook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tb-1",
        isDeleted: true,
        pendingSync: true,
        source: "local",
      })
    );
  });

  it("rejects delete when textbook belongs to a different author", async () => {
    authMocks.getCurrentUser.mockReturnValue({ uid: "user-1" });
    repositoryMocks.getTextbookById.mockResolvedValue(buildTextbook({ userId: "user-2" }));

    const { result } = renderHook(() => useRepositories());

    await expect(result.current.removeTextbook("tb-1")).rejects.toThrow(
      "You can only delete textbooks that you authored."
    );

    expect(syncMocks.hardDeleteTextbookFromCloud).not.toHaveBeenCalled();
    expect(repositoryMocks.deleteTextbook).not.toHaveBeenCalled();
    expect(repositoryMocks.saveTextbook).not.toHaveBeenCalled();
  });
});

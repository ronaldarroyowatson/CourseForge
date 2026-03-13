import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Edge-case coverage for the extension's section-scoped content creation
 * (createEquation, createConcept, createKeyIdea).
 *
 * Each create function guards against a missing parent section or missing
 * hierarchy IDs (chapterId / textbookId). These tests verify that the
 * guard throws with a helpful message and that the happy path enriches
 * the saved record with the correct hierarchy IDs.
 */

const repositoryMocks = vi.hoisted(() => {
  const getSectionById = vi.fn<() => Promise<unknown>>();
  const saveEquation = vi.fn(async () => "eq-id-1");
  const saveConcept = vi.fn(async () => "concept-id-1");
  const saveKeyIdea = vi.fn(async () => "keyidea-id-1");
  const saveVocabTerm = vi.fn(async () => "vocab-id-1");
  // Provide safe no-op stubs for list/get helpers used in the hook.
  const listTextbooks = vi.fn(async () => []);
  const listChaptersByTextbookId = vi.fn(async () => []);
  const listSectionsByChapterId = vi.fn(async () => []);
  const getTextbookById = vi.fn(async () => undefined);
  const getChapterById = vi.fn(async () => undefined);

  return {
    getSectionById,
    saveEquation,
    saveConcept,
    saveKeyIdea,
    saveVocabTerm,
    listTextbooks,
    listChaptersByTextbookId,
    listSectionsByChapterId,
    getTextbookById,
    getChapterById,
  };
});

vi.mock("../../src/core/services/repositories", () => repositoryMocks);

import { useRepositories } from "../../src/extension/hooks/useRepositories";

function renderRepositoryHook() {
  const { result } = renderHook(() => useRepositories());
  return result.current;
}

describe("extension useRepositories — section-scoped create guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── createEquation ────────────────────────────────────────────────────────

  describe("createEquation", () => {
    it("throws when parent section is not found", async () => {
      repositoryMocks.getSectionById.mockResolvedValueOnce(undefined);

      const { createEquation } = renderRepositoryHook();

      await expect(
        createEquation({ sectionId: "sec-missing", name: "E = mc²", latex: "E = mc^2" })
      ).rejects.toThrow("Cannot create an equation because the parent section is missing hierarchy IDs.");
    });

    it("throws when parent section is missing chapterId", async () => {
      repositoryMocks.getSectionById.mockResolvedValueOnce({
        id: "sec-1",
        textbookId: "tb-1",
        chapterId: undefined, // missing
      });

      const { createEquation } = renderRepositoryHook();

      await expect(
        createEquation({ sectionId: "sec-1", name: "E = mc²", latex: "E = mc^2" })
      ).rejects.toThrow("Cannot create an equation because the parent section is missing hierarchy IDs.");
    });

    it("throws when parent section is missing textbookId", async () => {
      repositoryMocks.getSectionById.mockResolvedValueOnce({
        id: "sec-1",
        chapterId: "ch-1",
        textbookId: undefined, // missing
      });

      const { createEquation } = renderRepositoryHook();

      await expect(
        createEquation({ sectionId: "sec-1", name: "E = mc²", latex: "E = mc^2" })
      ).rejects.toThrow("Cannot create an equation because the parent section is missing hierarchy IDs.");
    });

    it("saves equation with correct hierarchy IDs on happy path", async () => {
      repositoryMocks.getSectionById.mockResolvedValueOnce({
        id: "sec-1",
        chapterId: "ch-1",
        textbookId: "tb-1",
      });

      const { createEquation } = renderRepositoryHook();

      const id = await createEquation({ sectionId: "sec-1", name: "E = mc²", latex: "E = mc^2" });

      expect(id).toBe("eq-id-1");
      const savedArgs = (repositoryMocks.saveEquation.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(savedArgs.sectionId).toBe("sec-1");
      expect(savedArgs.chapterId).toBe("ch-1");
      expect(savedArgs.textbookId).toBe("tb-1");
      expect(savedArgs.pendingSync).toBe(true);
      expect(savedArgs.source).toBe("local");
      expect(savedArgs.lastModified).toBeTruthy();
    });
  });

  // ─── createConcept ─────────────────────────────────────────────────────────

  describe("createConcept", () => {
    it("throws when parent section is not found", async () => {
      repositoryMocks.getSectionById.mockResolvedValueOnce(undefined);

      const { createConcept } = renderRepositoryHook();

      await expect(
        createConcept({ sectionId: "sec-missing", name: "Entropy" })
      ).rejects.toThrow("Cannot create a concept because the parent section is missing hierarchy IDs.");
    });

    it("saves concept with correct hierarchy IDs on happy path", async () => {
      repositoryMocks.getSectionById.mockResolvedValueOnce({
        id: "sec-2",
        chapterId: "ch-2",
        textbookId: "tb-2",
      });

      const { createConcept } = renderRepositoryHook();

      const id = await createConcept({ sectionId: "sec-2", name: "Entropy", explanation: "Disorder measure" });

      expect(id).toBe("concept-id-1");
      const savedArgs = (repositoryMocks.saveConcept.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(savedArgs.sectionId).toBe("sec-2");
      expect(savedArgs.chapterId).toBe("ch-2");
      expect(savedArgs.textbookId).toBe("tb-2");
      expect(savedArgs.pendingSync).toBe(true);
      expect(savedArgs.source).toBe("local");
    });
  });

  // ─── createKeyIdea ─────────────────────────────────────────────────────────

  describe("createKeyIdea", () => {
    it("throws when parent section is not found", async () => {
      repositoryMocks.getSectionById.mockResolvedValueOnce(undefined);

      const { createKeyIdea } = renderRepositoryHook();

      await expect(
        createKeyIdea({ sectionId: "sec-missing", text: "The universe is expanding." })
      ).rejects.toThrow("Cannot create a key idea because the parent section is missing hierarchy IDs.");
    });

    it("saves key idea with correct hierarchy IDs on happy path", async () => {
      repositoryMocks.getSectionById.mockResolvedValueOnce({
        id: "sec-3",
        chapterId: "ch-3",
        textbookId: "tb-3",
      });

      const { createKeyIdea } = renderRepositoryHook();

      const id = await createKeyIdea({ sectionId: "sec-3", text: "The universe is expanding." });

      expect(id).toBe("keyidea-id-1");
      const savedArgs = (repositoryMocks.saveKeyIdea.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(savedArgs.sectionId).toBe("sec-3");
      expect(savedArgs.chapterId).toBe("ch-3");
      expect(savedArgs.textbookId).toBe("tb-3");
      expect(savedArgs.pendingSync).toBe(true);
      expect(savedArgs.source).toBe("local");
    });
  });
});

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import type { Chapter, Concept, Equation, KeyIdea, Section, Textbook, VocabTerm } from "../../src/core/models";
import { getStore, STORE_NAMES } from "../../src/core/services/db";
import {
  deleteTextbook,
  findDuplicateTextbookCandidate,
  listTextbooks,
  saveChapter,
  saveConcept,
  saveEquation,
  saveKeyIdea,
  saveSection,
  saveTextbook,
  saveVocabTerm,
} from "../../src/core/services/repositories";

async function clearStore(storeName: (typeof STORE_NAMES)[keyof typeof STORE_NAMES]): Promise<void> {
  const { store, tx } = await getStore(storeName, "readwrite");
  await store.clear();
  await tx.done;
}

function buildTextbook(id: string): Textbook {
  const now = new Date().toISOString();
  return {
    id,
    sourceType: "manual",
    originalLanguage: "en",
    title: "Ghostbook",
    grade: "8",
    subject: "Science",
    edition: "1",
    publicationYear: 2025,
    isbnRaw: "",
    isbnNormalized: "",
    createdAt: now,
    updatedAt: now,
    lastModified: now,
    pendingSync: true,
    source: "local",
    isFavorite: false,
    isArchived: false,
  };
}

function buildChapter(id: string, textbookId: string): Chapter {
  return {
    id,
    sourceType: "manual",
    textbookId,
    index: 1,
    name: "Chapter",
    lastModified: new Date().toISOString(),
    pendingSync: true,
    source: "local",
  };
}

function buildSection(id: string, chapterId: string, textbookId: string): Section {
  return {
    id,
    sourceType: "manual",
    textbookId,
    chapterId,
    index: 1,
    title: "Section",
    lastModified: new Date().toISOString(),
    pendingSync: true,
    source: "local",
  };
}

function buildVocab(id: string, sectionId: string, chapterId: string, textbookId: string): VocabTerm {
  return {
    id,
    sectionId,
    chapterId,
    textbookId,
    word: "atom",
    lastModified: new Date().toISOString(),
    pendingSync: true,
    source: "local",
  };
}

function buildEquation(id: string, sectionId: string, chapterId: string, textbookId: string): Equation {
  return {
    id,
    sectionId,
    chapterId,
    textbookId,
    name: "E=mc^2",
    latex: "E=mc^2",
    lastModified: new Date().toISOString(),
    pendingSync: true,
    source: "local",
  };
}

function buildConcept(id: string, sectionId: string, chapterId: string, textbookId: string): Concept {
  return {
    id,
    sectionId,
    chapterId,
    textbookId,
    name: "Mass-energy equivalence",
    lastModified: new Date().toISOString(),
    pendingSync: true,
    source: "local",
  };
}

function buildKeyIdea(id: string, sectionId: string, chapterId: string, textbookId: string): KeyIdea {
  return {
    id,
    sectionId,
    chapterId,
    textbookId,
    text: "Energy and mass are interchangeable.",
    lastModified: new Date().toISOString(),
    pendingSync: true,
    source: "local",
  };
}

describe("textbookRepository deletion persistence", () => {
  beforeEach(async () => {
    await Promise.all([
      clearStore(STORE_NAMES.textbooks),
      clearStore(STORE_NAMES.chapters),
      clearStore(STORE_NAMES.sections),
      clearStore(STORE_NAMES.vocabTerms),
      clearStore(STORE_NAMES.equations),
      clearStore(STORE_NAMES.concepts),
      clearStore(STORE_NAMES.keyIdeas),
    ]);
  });

  it("removes textbook hierarchy from local stores and hides textbook from list", async () => {
    const textbookId = "tb-delete-1";
    const chapterId = "ch-delete-1";
    const sectionId = "sec-delete-1";

    await saveTextbook(buildTextbook(textbookId));
    await saveChapter(buildChapter(chapterId, textbookId));
    await saveSection(buildSection(sectionId, chapterId, textbookId));
    await saveVocabTerm(buildVocab("vocab-delete-1", sectionId, chapterId, textbookId));
    await saveEquation(buildEquation("eq-delete-1", sectionId, chapterId, textbookId));
    await saveConcept(buildConcept("concept-delete-1", sectionId, chapterId, textbookId));
    await saveKeyIdea(buildKeyIdea("idea-delete-1", sectionId, chapterId, textbookId));

    await deleteTextbook(textbookId);

    const visibleTextbooks = await listTextbooks();
    expect(visibleTextbooks.some((item) => item.id === textbookId)).toBe(false);

    const textbookStore = await getStore(STORE_NAMES.textbooks, "readonly");
    expect(await textbookStore.store.get(textbookId)).toBeUndefined();

    const chapterStore = await getStore(STORE_NAMES.chapters, "readonly");
    expect(await chapterStore.store.get(chapterId)).toBeUndefined();

    const sectionStore = await getStore(STORE_NAMES.sections, "readonly");
    expect(await sectionStore.store.get(sectionId)).toBeUndefined();

    const vocabStore = await getStore(STORE_NAMES.vocabTerms, "readonly");
    expect(await vocabStore.store.get("vocab-delete-1")).toBeUndefined();

    const equationStore = await getStore(STORE_NAMES.equations, "readonly");
    expect(await equationStore.store.get("eq-delete-1")).toBeUndefined();

    const conceptStore = await getStore(STORE_NAMES.concepts, "readonly");
    expect(await conceptStore.store.get("concept-delete-1")).toBeUndefined();

    const keyIdeaStore = await getStore(STORE_NAMES.keyIdeas, "readonly");
    expect(await keyIdeaStore.store.get("idea-delete-1")).toBeUndefined();
  });

  it("hard-deletes textbook hierarchy from local stores and remains idempotent", async () => {
    const textbookId = "tb-delete-hard-1";
    const chapterId = "ch-delete-hard-1";
    const sectionId = "sec-delete-hard-1";

    await saveTextbook(buildTextbook(textbookId));
    await saveChapter(buildChapter(chapterId, textbookId));
    await saveSection(buildSection(sectionId, chapterId, textbookId));
    await saveVocabTerm(buildVocab("vocab-delete-hard-1", sectionId, chapterId, textbookId));
    await saveEquation(buildEquation("eq-delete-hard-1", sectionId, chapterId, textbookId));
    await saveConcept(buildConcept("concept-delete-hard-1", sectionId, chapterId, textbookId));
    await saveKeyIdea(buildKeyIdea("idea-delete-hard-1", sectionId, chapterId, textbookId));

    await deleteTextbook(textbookId);
    await deleteTextbook(textbookId);

    const textbookStore = await getStore(STORE_NAMES.textbooks, "readonly");
    expect(await textbookStore.store.get(textbookId)).toBeUndefined();

    const chapterStore = await getStore(STORE_NAMES.chapters, "readonly");
    expect(await chapterStore.store.get(chapterId)).toBeUndefined();

    const sectionStore = await getStore(STORE_NAMES.sections, "readonly");
    expect(await sectionStore.store.get(sectionId)).toBeUndefined();

    const vocabStore = await getStore(STORE_NAMES.vocabTerms, "readonly");
    expect(await vocabStore.store.get("vocab-delete-hard-1")).toBeUndefined();

    const equationStore = await getStore(STORE_NAMES.equations, "readonly");
    expect(await equationStore.store.get("eq-delete-hard-1")).toBeUndefined();

    const conceptStore = await getStore(STORE_NAMES.concepts, "readonly");
    expect(await conceptStore.store.get("concept-delete-hard-1")).toBeUndefined();

    const keyIdeaStore = await getStore(STORE_NAMES.keyIdeas, "readonly");
    expect(await keyIdeaStore.store.get("idea-delete-hard-1")).toBeUndefined();
  });

  it("finds fallback duplicate when ISBN is missing by title+grade+publisher+series+year", async () => {
    const now = new Date().toISOString();
    await saveTextbook({
      ...buildTextbook("tb-fallback-dup-1"),
      title: "Physical Science",
      grade: "8",
      publisher: "McGraw Hill",
      seriesName: "Inspire",
      publicationYear: 2021,
      isbnRaw: "",
      isbnNormalized: "",
      createdAt: now,
      updatedAt: now,
      lastModified: now,
    });

    const duplicate = await findDuplicateTextbookCandidate({
      isbnRaw: "",
      title: "Physical Science",
      grade: "8",
      publisher: "McGraw Hill",
      seriesName: "Inspire",
      publicationYear: 2021,
    });

    expect(duplicate?.id).toBe("tb-fallback-dup-1");
  });
});

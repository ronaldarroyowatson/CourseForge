import { useCallback } from "react";

import type { Chapter, Concept, DifficultyLevel, Equation, KeyIdea, RelatedIsbn, Section, SourceMetadata, Textbook, VocabTerm } from "../../core/models";
import {
  deleteConcept,
  deleteEquation,
  deleteChapter,
  deleteKeyIdea,
  deleteSection,
  deleteTextbook,
  findDuplicateTextbookCandidate,
  deleteVocabTerm,
  updateChapter,
  updateSection,
  findTextbookByIsbn,
  getTextbookById,
  getChapterById,
  getSectionById,
  listChaptersByTextbookId,
  listConceptsBySectionId,
  listEquationsBySectionId,
  listKeyIdeasBySectionId,
  listSectionsByChapterId,
  listTextbooks,
  listVocabTermsBySectionId,
  saveChapter,
  saveConcept,
  saveEquation,
  saveKeyIdea,
  saveSection,
  saveTextbook,
  saveVocabTerm,
  updateTextbook,
  updateTextbookFlags,
} from "../../core/services/repositories";
import { uploadTextbookCoverFromDataUrl, uploadTextbookCoverImage } from "../../core/services/coverImageService";
import { hardDeleteTextbookFromCloud } from "../../core/services/syncService";
import { getCurrentUser } from "../../firebase/auth";
import { useUIStore } from "../store/uiStore";

export interface CreateTextbookInput {
  sourceType: "auto" | "manual";
  originalLanguage?: string;
  translatedFields?: Record<string, { title?: string; subtitle?: string; chapters?: string[]; sections?: string[] }>;
  title: string;
  subtitle?: string;
  grade: string;
  gradeBand?: string;
  subject: string;
  edition: string;
  publicationYear: number;
  copyrightYear?: number;
  isbnRaw: string;
  isbnNormalized: string;
  additionalIsbns?: string[];
  relatedIsbns?: RelatedIsbn[];
  seriesName?: string;
  publisher?: string;
  publisherLocation?: string;
  mhid?: string;
  authors?: string[];
  tocExtractionConfidence?: number;
  imageModerationState?: "clear" | "pending_admin_review" | "blocked";
  imageModerationReason?: string;
  imageModerationConfidence?: number;
  cloudSyncBlockedReason?: "pending_admin_review" | "user_blocked" | "blocked_content";
  requiresAdminReview?: boolean;
  platformUrl?: string;
  coverImageUrl?: string | null;
  /** Pass a File to have it uploaded during createTextbook. */
  coverFile?: File;
  /** Pass a data-URL to have it uploaded during createTextbook. */
  coverDataUrl?: string;
}

export interface CreateChapterInput {
  sourceType?: "auto" | "manual";
  textbookId: string;
  index: number;
  name: string;
  description?: string;
}

export interface CreateSectionInput {
  sourceType?: "auto" | "manual";
  chapterId: string;
  index: number;
  title: string;
  notes?: string;
}

export interface CreateVocabTermInput {
  sectionId: string;
  word: string;
  definition?: string;
  languageTag?: string;
  difficultyLevel?: DifficultyLevel;
  isOriginal?: boolean;
  variationOf?: string | null;
  questionStem?: string;
  correctAnswer?: string;
  distractors?: string[];
  sourceMetadata?: SourceMetadata;
}

export interface CreateEquationInput {
  sectionId: string;
  name: string;
  latex: string;
  description?: string;
}

export interface CreateConceptInput {
  sectionId: string;
  name: string;
  explanation?: string;
  languageTag?: string;
  difficultyLevel?: DifficultyLevel;
  isOriginal?: boolean;
  variationOf?: string | null;
  questionStem?: string;
  correctAnswer?: string;
  distractors?: string[];
  sourceMetadata?: SourceMetadata;
}

export interface CreateKeyIdeaInput {
  sectionId: string;
  text: string;
}

function buildTextbookFromInput(input: CreateTextbookInput, resolvedCoverUrl?: string | null): Textbook {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sourceType: input.sourceType,
    originalLanguage: input.originalLanguage ?? "en",
    translatedFields: input.translatedFields,
    title: input.title,
    subtitle: input.subtitle,
    grade: input.grade,
    gradeBand: input.gradeBand,
    subject: input.subject,
    edition: input.edition,
    publicationYear: input.publicationYear,
    copyrightYear: input.copyrightYear,
    isbnRaw: input.isbnRaw,
    isbnNormalized: input.isbnNormalized,
    additionalIsbns: input.additionalIsbns,
    relatedIsbns: input.relatedIsbns,
    seriesName: input.seriesName,
    publisher: input.publisher,
    publisherLocation: input.publisherLocation,
    mhid: input.mhid,
    authors: input.authors,
    tocExtractionConfidence: input.tocExtractionConfidence,
    imageModerationState: input.imageModerationState,
    imageModerationReason: input.imageModerationReason,
    imageModerationConfidence: input.imageModerationConfidence,
    cloudSyncBlockedReason: input.cloudSyncBlockedReason,
    requiresAdminReview: input.requiresAdminReview,
    platformUrl: input.platformUrl,
    coverImageUrl: resolvedCoverUrl ?? input.coverImageUrl ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
    isFavorite: false,
    isArchived: false,
  };
}

function buildChapterFromInput(input: CreateChapterInput): Chapter {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sourceType: input.sourceType ?? "manual",
    textbookId: input.textbookId,
    index: input.index,
    name: input.name,
    description: input.description,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildSectionFromInput(input: CreateSectionInput, textbookId: string): Section {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sourceType: input.sourceType ?? "manual",
    textbookId,
    chapterId: input.chapterId,
    index: input.index,
    title: input.title,
    notes: input.notes,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildVocabTermFromInput(input: CreateVocabTermInput, chapterId: string, textbookId: string): VocabTerm {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    textbookId,
    chapterId,
    sectionId: input.sectionId,
    word: input.word,
    definition: input.definition,
    languageTag: input.languageTag,
    difficultyLevel: input.difficultyLevel ?? 1,
    isOriginal: input.isOriginal ?? true,
    variationOf: input.variationOf ?? null,
    questionStem: input.questionStem,
    correctAnswer: input.correctAnswer,
    distractors: input.distractors,
    sourceMetadata: input.sourceMetadata,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildEquationFromInput(input: CreateEquationInput, chapterId: string, textbookId: string): Equation {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    textbookId,
    chapterId,
    sectionId: input.sectionId,
    name: input.name,
    latex: input.latex,
    description: input.description,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildConceptFromInput(input: CreateConceptInput, chapterId: string, textbookId: string): Concept {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    textbookId,
    chapterId,
    sectionId: input.sectionId,
    name: input.name,
    explanation: input.explanation,
    languageTag: input.languageTag,
    difficultyLevel: input.difficultyLevel ?? 1,
    isOriginal: input.isOriginal ?? true,
    variationOf: input.variationOf ?? null,
    questionStem: input.questionStem,
    correctAnswer: input.correctAnswer,
    distractors: input.distractors,
    sourceMetadata: input.sourceMetadata,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildKeyIdeaFromInput(input: CreateKeyIdeaInput, chapterId: string, textbookId: string): KeyIdea {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    textbookId,
    chapterId,
    sectionId: input.sectionId,
    text: input.text,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

/**
 * Centralizes repository calls so UI components stay focused on rendering and form state.
 */
export function useRepositories() {
  const markLocalChange = useUIStore((state) => state.markLocalChange);

  const fetchTextbooks = useCallback(async (): Promise<Textbook[]> => {
    return listTextbooks();
  }, []);

  const createTextbook = useCallback(async (input: CreateTextbookInput): Promise<string> => {
    const textbook = buildTextbookFromInput(input);

    // Upload cover image if provided as a file or data-URL
    if (input.coverFile) {
      textbook.coverImageUrl = await uploadTextbookCoverImage(textbook.id, input.coverFile);
    } else if (input.coverDataUrl) {
      textbook.coverImageUrl = await uploadTextbookCoverFromDataUrl(textbook.id, input.coverDataUrl);
    }

    const id = await saveTextbook(textbook);
    markLocalChange();
    return id;
  }, [markLocalChange]);

  const removeTextbook = useCallback(async (id: string): Promise<void> => {
    console.info("[CourseForge][TextbookDelete] Request received.", { textbookId: id });

    const existingTextbook = await getTextbookById(id);
    let cloudDeleteFailed = false;

    if (typeof window !== "undefined") {
      const selectedTextbookId = window.localStorage.getItem("courseforge-selectedTextbookId");
      if (selectedTextbookId === id) {
        window.localStorage.removeItem("courseforge-selectedTextbookId");
        window.localStorage.removeItem("courseforge-selectedChapterId");
        window.localStorage.removeItem("courseforge-selectedSectionId");
      }
    }

    const currentUser = getCurrentUser();
    if (currentUser?.uid) {
      try {
        await hardDeleteTextbookFromCloud(currentUser.uid, id);
      } catch (error) {
        cloudDeleteFailed = true;
        console.warn("[CourseForge][TextbookDelete] Cloud hard-delete failed; local delete will still proceed.", {
          textbookId: id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await deleteTextbook(id);

    if (cloudDeleteFailed && existingTextbook) {
      await saveTextbook({
        ...existingTextbook,
        isDeleted: true,
        pendingSync: true,
        source: "local",
        lastModified: new Date().toISOString(),
      });
      console.info("[CourseForge][TextbookDelete] Local deletion tombstone persisted for cloud retry.", { textbookId: id });
    }

    console.info("[CourseForge][TextbookDelete] Hard delete completed for local hierarchy.", { textbookId: id });
    markLocalChange();
  }, [markLocalChange]);

  const findTextbookByISBN = useCallback(async (isbnInput: string): Promise<Textbook | undefined> => {
    return findTextbookByIsbn(isbnInput);
  }, []);

  const findDuplicateTextbook = useCallback(async (input: {
    isbnRaw?: string;
    title?: string;
    grade?: string;
    publisher?: string;
    seriesName?: string;
    publicationYear?: number;
  }): Promise<Textbook | undefined> => {
    return findDuplicateTextbookCandidate(input);
  }, []);

  const editTextbook = useCallback(async (id: string, changes: Partial<Textbook>): Promise<Textbook> => {
    const updated = await updateTextbook(id, changes);
    markLocalChange();
    return updated;
  }, [markLocalChange]);

  const toggleTextbookFavorite = useCallback(async (id: string, isFavorite: boolean): Promise<Textbook> => {
    const updated = await updateTextbookFlags(id, { isFavorite });
    markLocalChange();
    return updated;
  }, [markLocalChange]);

  const toggleTextbookArchive = useCallback(async (id: string, isArchived: boolean): Promise<Textbook> => {
    const updated = await updateTextbookFlags(id, { isArchived });
    markLocalChange();
    return updated;
  }, [markLocalChange]);

  const fetchChaptersByTextbookId = useCallback(async (textbookId: string): Promise<Chapter[]> => {
    return listChaptersByTextbookId(textbookId);
  }, []);

  const createChapter = useCallback(async (input: CreateChapterInput): Promise<string> => {
    const chapter = buildChapterFromInput(input);
    const id = await saveChapter(chapter);
    markLocalChange();
    return id;
  }, [markLocalChange]);

  const removeChapter = useCallback(async (id: string): Promise<void> => {
    await deleteChapter(id);
    markLocalChange();
  }, [markLocalChange]);

  const editChapter = useCallback(async (id: string, changes: Partial<Chapter>): Promise<Chapter> => {
    const updated = await updateChapter(id, changes);
    markLocalChange();
    return updated;
  }, [markLocalChange]);

  const fetchSectionsByChapterId = useCallback(async (chapterId: string): Promise<Section[]> => {
    return listSectionsByChapterId(chapterId);
  }, []);

  const createSection = useCallback(async (input: CreateSectionInput): Promise<string> => {
    const chapter = await getChapterById(input.chapterId);
    if (!chapter?.textbookId) {
      throw new Error("Cannot create section because the parent chapter is missing textbookId.");
    }

    const section = buildSectionFromInput(input, chapter.textbookId);
    const id = await saveSection(section);
    markLocalChange();
    return id;
  }, [markLocalChange]);

  const removeSection = useCallback(async (id: string): Promise<void> => {
    await deleteSection(id);
    markLocalChange();
  }, [markLocalChange]);

  const editSection = useCallback(async (id: string, changes: Partial<Section>): Promise<Section> => {
    const updated = await updateSection(id, changes);
    markLocalChange();
    return updated;
  }, [markLocalChange]);

  const fetchVocabTermsBySectionId = useCallback(async (sectionId: string): Promise<VocabTerm[]> => {
    return listVocabTermsBySectionId(sectionId);
  }, []);

  const createVocabTerm = useCallback(async (input: CreateVocabTermInput): Promise<string> => {
    const section = await getSectionById(input.sectionId);
    if (!section?.chapterId || !section.textbookId) {
      throw new Error("Cannot create vocab because the parent section is missing hierarchy IDs.");
    }

    const term = buildVocabTermFromInput(input, section.chapterId, section.textbookId);
    const id = await saveVocabTerm(term);
    markLocalChange();
    return id;
  }, [markLocalChange]);

  const removeVocabTerm = useCallback(async (id: string): Promise<void> => {
    await deleteVocabTerm(id);
    markLocalChange();
  }, [markLocalChange]);

  const fetchEquationsBySectionId = useCallback(async (sectionId: string): Promise<Equation[]> => {
    return listEquationsBySectionId(sectionId);
  }, []);

  const createEquation = useCallback(async (input: CreateEquationInput): Promise<string> => {
    const section = await getSectionById(input.sectionId);
    if (!section?.chapterId || !section.textbookId) {
      throw new Error("Cannot create equation because the parent section is missing hierarchy IDs.");
    }

    const equation = buildEquationFromInput(input, section.chapterId, section.textbookId);
    const id = await saveEquation(equation);
    markLocalChange();
    return id;
  }, [markLocalChange]);

  const removeEquation = useCallback(async (id: string): Promise<void> => {
    await deleteEquation(id);
    markLocalChange();
  }, [markLocalChange]);

  const fetchConceptsBySectionId = useCallback(async (sectionId: string): Promise<Concept[]> => {
    return listConceptsBySectionId(sectionId);
  }, []);

  const createConcept = useCallback(async (input: CreateConceptInput): Promise<string> => {
    const section = await getSectionById(input.sectionId);
    if (!section?.chapterId || !section.textbookId) {
      throw new Error("Cannot create concept because the parent section is missing hierarchy IDs.");
    }

    const concept = buildConceptFromInput(input, section.chapterId, section.textbookId);
    const id = await saveConcept(concept);
    markLocalChange();
    return id;
  }, [markLocalChange]);

  const removeConcept = useCallback(async (id: string): Promise<void> => {
    await deleteConcept(id);
    markLocalChange();
  }, [markLocalChange]);

  const fetchKeyIdeasBySectionId = useCallback(async (sectionId: string): Promise<KeyIdea[]> => {
    return listKeyIdeasBySectionId(sectionId);
  }, []);

  const createKeyIdea = useCallback(async (input: CreateKeyIdeaInput): Promise<string> => {
    const section = await getSectionById(input.sectionId);
    if (!section?.chapterId || !section.textbookId) {
      throw new Error("Cannot create key idea because the parent section is missing hierarchy IDs.");
    }

    const keyIdea = buildKeyIdeaFromInput(input, section.chapterId, section.textbookId);
    const id = await saveKeyIdea(keyIdea);
    markLocalChange();
    return id;
  }, [markLocalChange]);

  const removeKeyIdea = useCallback(async (id: string): Promise<void> => {
    await deleteKeyIdea(id);
    markLocalChange();
  }, [markLocalChange]);

  return {
    fetchTextbooks,
    createTextbook,
    removeTextbook,
    findDuplicateTextbook,
    findTextbookByISBN,
    editTextbook,
    toggleTextbookFavorite,
    toggleTextbookArchive,
    fetchChaptersByTextbookId,
    createChapter,
    removeChapter,
    editChapter,
    fetchSectionsByChapterId,
    createSection,
    removeSection,
    editSection,
    fetchVocabTermsBySectionId,
    createVocabTerm,
    removeVocabTerm,
    fetchEquationsBySectionId,
    createEquation,
    removeEquation,
    fetchConceptsBySectionId,
    createConcept,
    removeConcept,
    fetchKeyIdeasBySectionId,
    createKeyIdea,
    removeKeyIdea,
  };
}

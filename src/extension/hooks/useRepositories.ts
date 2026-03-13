import { useCallback } from "react";

import type { Chapter, Concept, Equation, KeyIdea, Section, Textbook, VocabTerm } from "../../core/models";
import {
  getChapterById,
  getSectionById,
  getTextbookById,
  listChaptersByTextbookId,
  listSectionsByChapterId,
  listTextbooks,
  saveConcept,
  saveEquation,
  saveKeyIdea,
  saveVocabTerm,
} from "../../core/services/repositories";

export interface QuickVocabInput {
  sectionId: string;
  word: string;
  definition?: string;
}

export interface QuickEquationInput {
  sectionId: string;
  name: string;
  latex: string;
  description?: string;
}

export interface QuickConceptInput {
  sectionId: string;
  name: string;
  explanation?: string;
}

export interface QuickKeyIdeaInput {
  sectionId: string;
  text: string;
}

function buildVocabTerm(input: QuickVocabInput, chapterId: string, textbookId: string): VocabTerm {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    textbookId,
    chapterId,
    sectionId: input.sectionId,
    word: input.word,
    definition: input.definition,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildEquation(input: QuickEquationInput): Equation {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    name: input.name,
    latex: input.latex,
    description: input.description,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildConcept(input: QuickConceptInput): Concept {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    name: input.name,
    explanation: input.explanation,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildKeyIdea(input: QuickKeyIdeaInput): KeyIdea {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    text: input.text,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

/**
 * Keeps extension data access small and repository-driven.
 */
export function useRepositories() {
  const fetchTextbooks = useCallback(async (): Promise<Textbook[]> => {
    return listTextbooks();
  }, []);

  const fetchChaptersByTextbookId = useCallback(async (textbookId: string): Promise<Chapter[]> => {
    return listChaptersByTextbookId(textbookId);
  }, []);

  const fetchSectionsByChapterId = useCallback(async (chapterId: string): Promise<Section[]> => {
    return listSectionsByChapterId(chapterId);
  }, []);

  const fetchTextbookById = useCallback(async (id: string): Promise<Textbook | undefined> => {
    return getTextbookById(id);
  }, []);

  const fetchChapterById = useCallback(async (id: string): Promise<Chapter | undefined> => {
    return getChapterById(id);
  }, []);

  const fetchSectionById = useCallback(async (id: string): Promise<Section | undefined> => {
    return getSectionById(id);
  }, []);

  const createVocabTerm = useCallback(async (input: QuickVocabInput): Promise<string> => {
    const section = await getSectionById(input.sectionId);
    if (!section?.chapterId || !section.textbookId) {
      throw new Error("Cannot create vocab because the parent section is missing hierarchy IDs.");
    }

    return saveVocabTerm(buildVocabTerm(input, section.chapterId, section.textbookId));
  }, []);

  const createEquation = useCallback(async (input: QuickEquationInput): Promise<string> => {
    const section = await getSectionById(input.sectionId);
    if (!section?.chapterId || !section.textbookId) {
      throw new Error("Cannot create an equation because the parent section is missing hierarchy IDs.");
    }

    return saveEquation({
      ...buildEquation(input),
      chapterId: section.chapterId,
      textbookId: section.textbookId,
    });
  }, []);

  const createConcept = useCallback(async (input: QuickConceptInput): Promise<string> => {
    const section = await getSectionById(input.sectionId);
    if (!section?.chapterId || !section.textbookId) {
      throw new Error("Cannot create a concept because the parent section is missing hierarchy IDs.");
    }

    return saveConcept({
      ...buildConcept(input),
      chapterId: section.chapterId,
      textbookId: section.textbookId,
    });
  }, []);

  const createKeyIdea = useCallback(async (input: QuickKeyIdeaInput): Promise<string> => {
    const section = await getSectionById(input.sectionId);
    if (!section?.chapterId || !section.textbookId) {
      throw new Error("Cannot create a key idea because the parent section is missing hierarchy IDs.");
    }

    return saveKeyIdea({
      ...buildKeyIdea(input),
      chapterId: section.chapterId,
      textbookId: section.textbookId,
    });
  }, []);

  return {
    fetchTextbooks,
    fetchChaptersByTextbookId,
    fetchSectionsByChapterId,
    fetchTextbookById,
    fetchChapterById,
    fetchSectionById,
    createVocabTerm,
    createEquation,
    createConcept,
    createKeyIdea,
  };
}

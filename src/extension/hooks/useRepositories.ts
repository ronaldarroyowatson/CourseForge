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

function buildVocabTerm(input: QuickVocabInput): VocabTerm {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    word: input.word,
    definition: input.definition,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
  };
}

function buildEquation(input: QuickEquationInput): Equation {
  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    name: input.name,
    latex: input.latex,
    description: input.description,
  };
}

function buildConcept(input: QuickConceptInput): Concept {
  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    name: input.name,
    explanation: input.explanation,
  };
}

function buildKeyIdea(input: QuickKeyIdeaInput): KeyIdea {
  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    text: input.text,
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
    return saveVocabTerm(buildVocabTerm(input));
  }, []);

  const createEquation = useCallback(async (input: QuickEquationInput): Promise<string> => {
    return saveEquation(buildEquation(input));
  }, []);

  const createConcept = useCallback(async (input: QuickConceptInput): Promise<string> => {
    return saveConcept(buildConcept(input));
  }, []);

  const createKeyIdea = useCallback(async (input: QuickKeyIdeaInput): Promise<string> => {
    return saveKeyIdea(buildKeyIdea(input));
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

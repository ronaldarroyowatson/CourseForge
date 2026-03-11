import { useCallback } from "react";

import type { Chapter, Concept, Equation, KeyIdea, Section, Textbook, VocabTerm } from "../../core/models";
import {
  deleteConcept,
  deleteEquation,
  deleteChapter,
  deleteKeyIdea,
  deleteSection,
  deleteTextbook,
  deleteVocabTerm,
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
} from "../../core/services/repositories";

export interface CreateTextbookInput {
  title: string;
  grade: string;
  subject: string;
  edition: string;
  publicationYear: number;
  platformUrl?: string;
}

export interface CreateChapterInput {
  textbookId: string;
  index: number;
  name: string;
  description?: string;
}

export interface CreateSectionInput {
  chapterId: string;
  index: number;
  title: string;
  notes?: string;
}

export interface CreateVocabTermInput {
  sectionId: string;
  word: string;
  definition?: string;
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
}

export interface CreateKeyIdeaInput {
  sectionId: string;
  text: string;
}

function buildTextbookFromInput(input: CreateTextbookInput): Textbook {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: input.title,
    grade: input.grade,
    subject: input.subject,
    edition: input.edition,
    publicationYear: input.publicationYear,
    platformUrl: input.platformUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildChapterFromInput(input: CreateChapterInput): Chapter {
  return {
    id: crypto.randomUUID(),
    textbookId: input.textbookId,
    index: input.index,
    name: input.name,
    description: input.description,
  };
}

function buildSectionFromInput(input: CreateSectionInput): Section {
  return {
    id: crypto.randomUUID(),
    chapterId: input.chapterId,
    index: input.index,
    title: input.title,
    notes: input.notes,
  };
}

function buildVocabTermFromInput(input: CreateVocabTermInput): VocabTerm {
  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    word: input.word,
    definition: input.definition,
  };
}

function buildEquationFromInput(input: CreateEquationInput): Equation {
  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    name: input.name,
    latex: input.latex,
    description: input.description,
  };
}

function buildConceptFromInput(input: CreateConceptInput): Concept {
  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    name: input.name,
    explanation: input.explanation,
  };
}

function buildKeyIdeaFromInput(input: CreateKeyIdeaInput): KeyIdea {
  return {
    id: crypto.randomUUID(),
    sectionId: input.sectionId,
    text: input.text,
  };
}

/**
 * Centralizes repository calls so UI components stay focused on rendering and form state.
 */
export function useRepositories() {
  const fetchTextbooks = useCallback(async (): Promise<Textbook[]> => {
    return listTextbooks();
  }, []);

  const createTextbook = useCallback(async (input: CreateTextbookInput): Promise<string> => {
    const textbook = buildTextbookFromInput(input);
    return saveTextbook(textbook);
  }, []);

  const removeTextbook = useCallback(async (id: string): Promise<void> => {
    await deleteTextbook(id);
  }, []);

  const fetchChaptersByTextbookId = useCallback(async (textbookId: string): Promise<Chapter[]> => {
    return listChaptersByTextbookId(textbookId);
  }, []);

  const createChapter = useCallback(async (input: CreateChapterInput): Promise<string> => {
    const chapter = buildChapterFromInput(input);
    return saveChapter(chapter);
  }, []);

  const removeChapter = useCallback(async (id: string): Promise<void> => {
    await deleteChapter(id);
  }, []);

  const fetchSectionsByChapterId = useCallback(async (chapterId: string): Promise<Section[]> => {
    return listSectionsByChapterId(chapterId);
  }, []);

  const createSection = useCallback(async (input: CreateSectionInput): Promise<string> => {
    const section = buildSectionFromInput(input);
    return saveSection(section);
  }, []);

  const removeSection = useCallback(async (id: string): Promise<void> => {
    await deleteSection(id);
  }, []);

  const fetchVocabTermsBySectionId = useCallback(async (sectionId: string): Promise<VocabTerm[]> => {
    return listVocabTermsBySectionId(sectionId);
  }, []);

  const createVocabTerm = useCallback(async (input: CreateVocabTermInput): Promise<string> => {
    const term = buildVocabTermFromInput(input);
    return saveVocabTerm(term);
  }, []);

  const removeVocabTerm = useCallback(async (id: string): Promise<void> => {
    await deleteVocabTerm(id);
  }, []);

  const fetchEquationsBySectionId = useCallback(async (sectionId: string): Promise<Equation[]> => {
    return listEquationsBySectionId(sectionId);
  }, []);

  const createEquation = useCallback(async (input: CreateEquationInput): Promise<string> => {
    const equation = buildEquationFromInput(input);
    return saveEquation(equation);
  }, []);

  const removeEquation = useCallback(async (id: string): Promise<void> => {
    await deleteEquation(id);
  }, []);

  const fetchConceptsBySectionId = useCallback(async (sectionId: string): Promise<Concept[]> => {
    return listConceptsBySectionId(sectionId);
  }, []);

  const createConcept = useCallback(async (input: CreateConceptInput): Promise<string> => {
    const concept = buildConceptFromInput(input);
    return saveConcept(concept);
  }, []);

  const removeConcept = useCallback(async (id: string): Promise<void> => {
    await deleteConcept(id);
  }, []);

  const fetchKeyIdeasBySectionId = useCallback(async (sectionId: string): Promise<KeyIdea[]> => {
    return listKeyIdeasBySectionId(sectionId);
  }, []);

  const createKeyIdea = useCallback(async (input: CreateKeyIdeaInput): Promise<string> => {
    const keyIdea = buildKeyIdeaFromInput(input);
    return saveKeyIdea(keyIdea);
  }, []);

  const removeKeyIdea = useCallback(async (id: string): Promise<void> => {
    await deleteKeyIdea(id);
  }, []);

  return {
    fetchTextbooks,
    createTextbook,
    removeTextbook,
    fetchChaptersByTextbookId,
    createChapter,
    removeChapter,
    fetchSectionsByChapterId,
    createSection,
    removeSection,
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

import {
  getChapterById,
  getSectionById,
  getTextbookById,
  listChaptersByTextbookId,
  listConceptsBySectionId,
  listEquationsBySectionId,
  listKeyIdeasBySectionId,
  listSectionsByChapterId,
  listVocabTermsBySectionId,
} from "../repositories";
import type { Chapter, Section } from "../../models";
import type { ChapterExportNode, SectionExportNode, TextbookExportNode } from "./types";
import { XmlExportNotFoundError } from "./errors";

function ensureFound<T>(value: T | undefined, label: string, id: string): T {
  if (!value) {
    throw new XmlExportNotFoundError(label, id);
  }

  return value;
}

async function loadSectionNode(section: Section): Promise<SectionExportNode> {
  const [concepts, equations, vocabTerms, keyIdeas] = await Promise.all([
    listConceptsBySectionId(section.id),
    listEquationsBySectionId(section.id),
    listVocabTermsBySectionId(section.id),
    listKeyIdeasBySectionId(section.id),
  ]);

  return {
    section,
    concepts,
    equations,
    vocabTerms,
    keyIdeas,
  };
}

async function loadChapterNode(chapter: Chapter): Promise<ChapterExportNode> {
  const sections = await listSectionsByChapterId(chapter.id);
  const sectionNodes = await Promise.all(sections.map((section) => loadSectionNode(section)));

  return {
    chapter,
    sections: sectionNodes,
  };
}

export async function loadTextbookExportNode(textbookId: string): Promise<TextbookExportNode> {
  const textbook = ensureFound(await getTextbookById(textbookId), "Textbook", textbookId);
  const chapters = await listChaptersByTextbookId(textbookId);
  const chapterNodes = await Promise.all(chapters.map((chapter) => loadChapterNode(chapter)));

  return {
    textbook,
    chapters: chapterNodes,
  };
}

export async function loadChapterExportNode(chapterId: string): Promise<TextbookExportNode> {
  const chapter = ensureFound(await getChapterById(chapterId), "Chapter", chapterId);
  const textbook = ensureFound(
    await getTextbookById(chapter.textbookId),
    "Textbook",
    chapter.textbookId
  );
  const chapterNode = await loadChapterNode(chapter);

  return {
    textbook,
    chapters: [chapterNode],
  };
}

export async function loadSectionExportNode(sectionId: string): Promise<TextbookExportNode> {
  const section = ensureFound(await getSectionById(sectionId), "Section", sectionId);
  const chapter = ensureFound(await getChapterById(section.chapterId), "Chapter", section.chapterId);
  const textbook = ensureFound(
    await getTextbookById(chapter.textbookId),
    "Textbook",
    chapter.textbookId
  );
  const sectionNode = await loadSectionNode(section);

  return {
    textbook,
    chapters: [
      {
        chapter,
        sections: [sectionNode],
      },
    ],
  };
}

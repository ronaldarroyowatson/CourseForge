import "fake-indexeddb/auto";

import { saveChapter, saveConcept, saveEquation, saveKeyIdea, saveSection, saveTextbook, saveVocabTerm } from "../../src/core/services/repositories";
import { exportChapterXml, exportSectionXml, exportTextbookXml } from "../../src/core/services/xml";
import { XmlExportNotFoundError, XmlExportValidationError } from "../../src/core/services/xml";
import type { Chapter, Concept, Equation, KeyIdea, Section, Textbook, VocabTerm } from "../../src/core/models";

function assertMatch(value: string, pattern: RegExp): void {
  if (!pattern.test(value)) {
    throw new Error(`Expected pattern not found: ${pattern}`);
  }
}

async function assertRejects(
  fn: () => Promise<unknown>,
  errorCtor: new (...args: never[]) => Error
): Promise<void> {
  try {
    await fn();
    throw new Error("Expected async function to throw.");
  } catch (error) {
    if (!(error instanceof errorCtor)) {
      throw new Error(`Expected error type ${errorCtor.name}.`);
    }
  }
}

function buildTextbook(id: string): Textbook {
  return {
    id,
    originalLanguage: "en",
    title: "Chemistry Basics",
    grade: "10",
    subject: "Chemistry",
    edition: "2024",
    publicationYear: 2024,
    isbnRaw: "978-0-13-468599-1",
    isbnNormalized: "9780134685991",
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    lastModified: "2026-03-10T00:00:00.000Z",
    pendingSync: false,
    source: "local",
    sourceType: "manual",
      isFavorite: false,
      isArchived: false,
  };
}

function buildChapter(id: string, textbookId: string, index: number): Chapter {
  return {
    id,
    textbookId,
    index,
    name: `Chapter ${index}`,
    lastModified: "2026-03-10T00:00:00.000Z",
    pendingSync: false,
    source: "local",
      sourceType: "manual",
  };
}

function buildSection(id: string, chapterId: string, index: number): Section {
  return {
    id,
    chapterId,
    index,
    title: `Section ${index}`,
    lastModified: "2026-03-10T00:00:00.000Z",
    pendingSync: false,
    source: "local",
      sourceType: "manual",
  };
}

async function seedBasicGraph(seedId: string): Promise<{
  textbookId: string;
  chapterId: string;
  sectionId: string;
}> {
  const textbookId = `tb-${seedId}`;
  const chapterId = `ch-${seedId}`;
  const sectionId = `sec-${seedId}`;

  await saveTextbook(buildTextbook(textbookId));
  await saveChapter(buildChapter(chapterId, textbookId, 1));
  await saveSection(buildSection(sectionId, chapterId, 1));

  const concept: Concept = {
    id: `concept-${seedId}`,
    sectionId,
    name: "Atoms",
    explanation: "Matter is composed of atoms.",
  };
  const equation: Equation = {
    id: `equation-${seedId}`,
    sectionId,
    name: "Density",
    latex: "rho = m/V",
  };
  const vocabTerm: VocabTerm = {
    id: `vocab-${seedId}`,
    sectionId,
    word: "Molecule",
    definition: "Two or more bonded atoms",
    lastModified: "2026-03-10T00:00:00.000Z",
    pendingSync: false,
    source: "local",
  };
  const keyIdea: KeyIdea = {
    id: `idea-${seedId}`,
    sectionId,
    text: "Particles are in constant motion.",
  };

  await saveConcept(concept);
  await saveEquation(equation);
  await saveVocabTerm(vocabTerm);
  await saveKeyIdea(keyIdea);

  return { textbookId, chapterId, sectionId };
}

export async function testExportTextbookXmlIncludesAllHierarchy(): Promise<void> {
  const ids = await seedBasicGraph("textbook");
  const xml = await exportTextbookXml(ids.textbookId, {
    generatedBy: "CourseForge",
    generatedAt: "2026-03-10T12:00:00Z",
    version: "1.0.0",
  });

  assertMatch(xml, /<textbook id="tb-textbook">/);
  assertMatch(xml, /<chapter id="ch-textbook" index="1">/);
  assertMatch(xml, /<section id="sec-textbook" index="1">/);
  assertMatch(xml, /<concept id="concept-textbook">/);
  assertMatch(xml, /<equation id="equation-textbook">/);
  assertMatch(xml, /<term id="vocab-textbook">/);
  assertMatch(xml, /<keyIdea id="idea-textbook">/);
}

export async function testExportChapterXmlScopesToSingleChapter(): Promise<void> {
  const ids = await seedBasicGraph("chapter");
  const xml = await exportChapterXml(ids.chapterId);

  assertMatch(xml, /<chapter id="ch-chapter" index="1">/);
  assertMatch(xml, /<section id="sec-chapter" index="1">/);
}

export async function testExportSectionXmlScopesToSingleSection(): Promise<void> {
  const ids = await seedBasicGraph("section");
  const xml = await exportSectionXml(ids.sectionId);

  assertMatch(xml, /<section id="sec-section" index="1">/);
  assertMatch(xml, /<concept id="concept-section">/);
}

export async function testExportTextbookXmlRejectsBlankId(): Promise<void> {
  await assertRejects(() => exportTextbookXml("   "), XmlExportValidationError);
}

export async function testExportChapterXmlRejectsUnknownId(): Promise<void> {
  await assertRejects(() => exportChapterXml("missing-chapter"), XmlExportNotFoundError);
}

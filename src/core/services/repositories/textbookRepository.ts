import type { Textbook } from "../../models";
import { delete as deleteRecord, getAll as getAllRecords, getById, save, STORE_NAMES } from "../db";
import { normalizeISBN } from "../isbnService";

export async function saveTextbook(textbook: Textbook): Promise<string> {
  return save(STORE_NAMES.textbooks, textbook);
}

export async function getTextbookById(id: string): Promise<Textbook | undefined> {
  const textbook = await getById(STORE_NAMES.textbooks, id);
  if (!textbook || textbook.isDeleted) {
    return undefined;
  }

  return textbook;
}

export async function getAll(): Promise<Textbook[]> {
  return getAllRecords(STORE_NAMES.textbooks);
}

export async function listTextbooks(): Promise<Textbook[]> {
  const textbooks = await getAll();
  return textbooks.filter((textbook) => !textbook.isDeleted);
}

export async function findTextbookByIsbn(isbnInput: string): Promise<Textbook | undefined> {
  const raw = isbnInput.trim();
  const normalized = normalizeISBN(raw);

  if (!raw) {
    return undefined;
  }

  const textbooks = await getAll();

  return textbooks.find((textbook) => {
    const textbookRaw = textbook.isbnRaw?.trim() ?? "";
    const textbookNormalized = textbook.isbnNormalized ?? "";

    // Check primary ISBN
    if (textbookRaw === raw || (normalized.length > 0 && textbookNormalized === normalized)) {
      return true;
    }

    // Check relatedIsbns
    if (textbook.relatedIsbns && normalized.length > 0) {
      return textbook.relatedIsbns.some(
        (related) => normalizeISBN(related.isbn) === normalized
      );
    }

    return false;
  });
}

export interface DuplicateTextbookLookup {
  isbnRaw?: string;
  title?: string;
  grade?: string;
  publisher?: string;
  seriesName?: string;
  publicationYear?: number;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export async function findDuplicateTextbookCandidate(input: DuplicateTextbookLookup): Promise<Textbook | undefined> {
  const byIsbn = await findTextbookByIsbn(input.isbnRaw ?? "");
  if (byIsbn) {
    return byIsbn;
  }

  const title = normalizeText(input.title);
  const grade = normalizeText(input.grade);
  const publisher = normalizeText(input.publisher);
  const seriesName = normalizeText(input.seriesName);
  const publicationYear = typeof input.publicationYear === "number" ? input.publicationYear : null;

  if (!title || !grade || !publisher || !seriesName || !publicationYear) {
    return undefined;
  }

  const textbooks = await getAll();
  return textbooks.find((textbook) => {
    if (textbook.isDeleted) {
      return false;
    }

    return normalizeText(textbook.title) === title
      && normalizeText(textbook.grade) === grade
      && normalizeText(textbook.publisher) === publisher
      && normalizeText(textbook.seriesName) === seriesName
      && textbook.publicationYear === publicationYear;
  });
}

export async function deleteTextbook(id: string): Promise<void> {
  const textbook = await getById(STORE_NAMES.textbooks, id);
  if (!textbook) {
    return;
  }

  const chapters = await getAllRecords(STORE_NAMES.chapters);
  const chapterIds = new Set(chapters.filter((chapter) => chapter.textbookId === id).map((chapter) => chapter.id));

  const chaptersToDelete = chapters.filter((chapter) => chapter.textbookId === id);

  const sections = await getAllRecords(STORE_NAMES.sections);
  const sectionsToDelete = sections.filter((section) => section.textbookId === id || chapterIds.has(section.chapterId));
  const sectionIds = new Set(sectionsToDelete.map((section) => section.id));

  const [vocabTerms, equations, concepts, keyIdeas] = await Promise.all([
    getAllRecords(STORE_NAMES.vocabTerms),
    getAllRecords(STORE_NAMES.equations),
    getAllRecords(STORE_NAMES.concepts),
    getAllRecords(STORE_NAMES.keyIdeas),
  ]);

  const vocabToDelete = vocabTerms.filter((item) => item.textbookId === id || sectionIds.has(item.sectionId));
  const equationsToDelete = equations.filter((item) => item.textbookId === id || sectionIds.has(item.sectionId));
  const conceptsToDelete = concepts.filter((item) => item.textbookId === id || sectionIds.has(item.sectionId));
  const keyIdeasToDelete = keyIdeas.filter((item) => item.textbookId === id || sectionIds.has(item.sectionId));

  await Promise.all([
    ...vocabToDelete.map((item) => deleteRecord(STORE_NAMES.vocabTerms, item.id)),
    ...equationsToDelete.map((item) => deleteRecord(STORE_NAMES.equations, item.id)),
    ...conceptsToDelete.map((item) => deleteRecord(STORE_NAMES.concepts, item.id)),
    ...keyIdeasToDelete.map((item) => deleteRecord(STORE_NAMES.keyIdeas, item.id)),
    ...sectionsToDelete.map((section) => deleteRecord(STORE_NAMES.sections, section.id)),
    ...chaptersToDelete.map((chapter) => deleteRecord(STORE_NAMES.chapters, chapter.id)),
  ]);

  await deleteRecord(STORE_NAMES.textbooks, id);
}

  /**
   * Update an existing textbook with partial changes.
   * Marks the record as pendingSync and updates lastModified.
   */
  export async function updateTextbook(id: string, changes: Partial<Textbook>): Promise<Textbook> {
    const existing = await getTextbookById(id);
    if (!existing) {
      throw new Error(`Textbook with id ${id} not found.`);
    }

    const updated: Textbook = {
      ...existing,
      ...changes,
      id: existing.id, // Never change the ID
      lastModified: new Date().toISOString(),
      pendingSync: true,
    };

    await saveTextbook(updated);
    return updated;
  }

  /**
   * Toggle favorite or archive status on a textbook.
   */
  export async function updateTextbookFlags(
    id: string,
    flags: { isFavorite?: boolean; isArchived?: boolean }
  ): Promise<Textbook> {
    return updateTextbook(id, flags);
  }

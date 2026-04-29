import type { Textbook } from "../../models";
import { delete as deleteRecord, getAll as getAllRecords, getById, save, STORE_NAMES } from "../db";
import { normalizeISBN } from "../isbnService";

const LOCALHOST_SHARED_TEXTBOOK_ENDPOINT = "/api/local-textbooks-state";
const LOCALHOST_SHARED_REQUEST_TIMEOUT_MS = 1200;

let hasAttemptedLocalhostHydration = false;
let localhostSharedSnapshotAvailable: boolean | null = null;

function isLikelyLocalhostRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  if (protocol !== "http:" && protocol !== "https:") {
    return false;
  }

  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isTextbookRecord(value: unknown): value is Textbook {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Textbook>;
  return typeof candidate.id === "string" && typeof candidate.title === "string";
}

async function fetchLocalhostSharedTextbooks(): Promise<Textbook[] | null> {
  if (!isLikelyLocalhostRuntime()) {
    return null;
  }

  try {
    const response = await fetch(LOCALHOST_SHARED_TEXTBOOK_ENDPOINT, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(LOCALHOST_SHARED_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      localhostSharedSnapshotAvailable = false;
      return null;
    }

    const payload = await response.json() as { textbooks?: unknown };
    if (!Array.isArray(payload.textbooks)) {
      localhostSharedSnapshotAvailable = false;
      return null;
    }

    const textbooks = payload.textbooks.filter(isTextbookRecord);
    localhostSharedSnapshotAvailable = true;
    return textbooks;
  } catch {
    localhostSharedSnapshotAvailable = false;
    return null;
  }
}

async function hydrateFromLocalhostSharedSnapshotIfNeeded(): Promise<void> {
  if (hasAttemptedLocalhostHydration) {
    return;
  }

  hasAttemptedLocalhostHydration = true;
  if (!isLikelyLocalhostRuntime()) {
    return;
  }

  const existing = await getAllRecords(STORE_NAMES.textbooks);
  if (existing.length > 0) {
    return;
  }

  const shared = await fetchLocalhostSharedTextbooks();
  if (!shared || shared.length === 0) {
    return;
  }

  await Promise.all(shared.map((textbook) => save(STORE_NAMES.textbooks, textbook)));
}

async function publishLocalhostSharedSnapshotBestEffort(): Promise<void> {
  if (!isLikelyLocalhostRuntime()) {
    return;
  }

  if (localhostSharedSnapshotAvailable === false) {
    return;
  }

  try {
    const textbooks = await getAllRecords(STORE_NAMES.textbooks);
    const response = await fetch(LOCALHOST_SHARED_TEXTBOOK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textbooks }),
      signal: AbortSignal.timeout(LOCALHOST_SHARED_REQUEST_TIMEOUT_MS),
    });
    localhostSharedSnapshotAvailable = response.ok;
  } catch {
    localhostSharedSnapshotAvailable = false;
  }
}

export async function saveTextbook(textbook: Textbook): Promise<string> {
  const id = await save(STORE_NAMES.textbooks, textbook);
  void publishLocalhostSharedSnapshotBestEffort();
  return id;
}

export async function getTextbookById(id: string): Promise<Textbook | undefined> {
  const textbook = await getById(STORE_NAMES.textbooks, id);
  if (!textbook || textbook.isDeleted) {
    return undefined;
  }

  return textbook;
}

export async function getAll(): Promise<Textbook[]> {
  await hydrateFromLocalhostSharedSnapshotIfNeeded();
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
  void publishLocalhostSharedSnapshotBestEffort();
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

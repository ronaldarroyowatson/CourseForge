import type { Textbook } from "../../models";
import { delete as deleteRecord, getAll as getAllRecords, getById, save, STORE_NAMES } from "../db";
import { normalizeISBN } from "../isbnService";

export async function saveTextbook(textbook: Textbook): Promise<string> {
  return save(STORE_NAMES.textbooks, textbook);
}

export async function getTextbookById(id: string): Promise<Textbook | undefined> {
  return getById(STORE_NAMES.textbooks, id);
}

export async function getAll(): Promise<Textbook[]> {
  return getAllRecords(STORE_NAMES.textbooks);
}

export async function listTextbooks(): Promise<Textbook[]> {
  return getAll();
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

    return textbookRaw === raw || (normalized.length > 0 && textbookNormalized === normalized);
  });
}

export async function deleteTextbook(id: string): Promise<void> {
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

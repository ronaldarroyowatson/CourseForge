import type { TranslationMemoryEntry } from "../../models";
import { getAll as getAllRecords, getById, save, STORE_NAMES } from "../db";

function buildEntryId(language: string, termId: string): string {
  return `${language.toLowerCase()}:${termId}`;
}

export async function saveTranslationMemoryEntry(entry: TranslationMemoryEntry): Promise<string> {
  const normalized = {
    ...entry,
    id: buildEntryId(entry.language, entry.termId),
    language: entry.language.toLowerCase(),
  };
  return save(STORE_NAMES.translationMemory, normalized);
}

export async function getTranslationMemoryEntry(
  language: string,
  termId: string
): Promise<TranslationMemoryEntry | undefined> {
  return getById(STORE_NAMES.translationMemory, buildEntryId(language, termId));
}

export async function listTranslationMemoryEntries(language?: string): Promise<TranslationMemoryEntry[]> {
  const all = await getAllRecords(STORE_NAMES.translationMemory);
  if (!language) {
    return all;
  }

  const normalizedLanguage = language.toLowerCase();
  return all.filter((entry) => entry.language.toLowerCase() === normalizedLanguage);
}

export async function findTranslationMemoryBySourceText(
  language: string,
  sourceText: string
): Promise<TranslationMemoryEntry | undefined> {
  const normalizedLanguage = language.toLowerCase();
  const normalizedSource = sourceText.trim().toLowerCase();
  const all = await listTranslationMemoryEntries(normalizedLanguage);
  return all.find((entry) => entry.sourceText.trim().toLowerCase() === normalizedSource);
}

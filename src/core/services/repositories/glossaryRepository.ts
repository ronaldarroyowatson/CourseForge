import type { GlossaryEntry } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

function normalizeLanguage(input: string): string {
  const primary = input.trim().toLowerCase().split(/[-_]/)[0];
  return primary || "en";
}

function normalizeTerm(input: string): string {
  return input.trim().toLowerCase();
}

function buildGlossaryId(subject: string, sourceLanguage: string, targetLanguage: string, sourceTerm: string): string {
  return `${subject.toLowerCase()}:${normalizeLanguage(sourceLanguage)}-${normalizeLanguage(targetLanguage)}:${normalizeTerm(sourceTerm)}`;
}

export interface GlossaryFilter {
  subject?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export async function saveGlossaryEntry(entry: GlossaryEntry): Promise<string> {
  const normalized: GlossaryEntry = {
    ...entry,
    id: buildGlossaryId(entry.subject, entry.sourceLanguage, entry.targetLanguage, entry.sourceTerm),
    subject: entry.subject.trim().toLowerCase(),
    sourceLanguage: normalizeLanguage(entry.sourceLanguage),
    targetLanguage: normalizeLanguage(entry.targetLanguage),
    sourceTerm: entry.sourceTerm.trim(),
    preferredTranslation: entry.preferredTranslation.trim(),
    usageRefs: entry.usageRefs ?? [],
  };

  return save(STORE_NAMES.glossaries, normalized);
}

export async function getGlossaryEntry(id: string): Promise<GlossaryEntry | undefined> {
  return getById(STORE_NAMES.glossaries, id);
}

export async function listGlossaryEntries(filter?: GlossaryFilter): Promise<GlossaryEntry[]> {
  const all = await getAll(STORE_NAMES.glossaries);
  if (!filter) {
    return all;
  }

  return all.filter((entry) => {
    if (filter.subject && entry.subject !== filter.subject.trim().toLowerCase()) {
      return false;
    }

    if (filter.sourceLanguage && entry.sourceLanguage !== normalizeLanguage(filter.sourceLanguage)) {
      return false;
    }

    if (filter.targetLanguage && entry.targetLanguage !== normalizeLanguage(filter.targetLanguage)) {
      return false;
    }

    return true;
  });
}

export async function findGlossaryMatch(
  subject: string,
  sourceLanguage: string,
  targetLanguage: string,
  sourceText: string
): Promise<GlossaryEntry[]> {
  const normalizedSubject = subject.trim().toLowerCase();
  const normalizedSourceLanguage = normalizeLanguage(sourceLanguage);
  const normalizedTargetLanguage = normalizeLanguage(targetLanguage);
  const haystack = sourceText.trim().toLowerCase();

  const pool = await listGlossaryEntries({
    subject: normalizedSubject,
    sourceLanguage: normalizedSourceLanguage,
    targetLanguage: normalizedTargetLanguage,
  });

  return pool.filter((entry) => {
    const normalizedSourceTerm = entry.sourceTerm.trim().toLowerCase();
    if (!normalizedSourceTerm) {
      return false;
    }

    return haystack.includes(normalizedSourceTerm)
      || normalizedSourceTerm.includes(haystack)
      || levenshteinDistance(normalizedSourceTerm, haystack) <= 2;
  });
}

export async function deleteGlossaryEntry(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.glossaries, id);
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const matrix: number[][] = [];

  for (let i = 0; i <= right.length; i += 1) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= left.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= right.length; i += 1) {
    for (let j = 1; j <= left.length; j += 1) {
      const substitutionCost = left[j - 1] === right[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + substitutionCost
      );
    }
  }

  return matrix[right.length][left.length];
}

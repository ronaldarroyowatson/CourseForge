import { doc, getDoc, setDoc } from "firebase/firestore";

import type { TranslationMemoryEntry } from "../models";
import { getCurrentUser } from "../../firebase/auth";
import { firestoreDb } from "../../firebase/firestore";

export type TranslationMemoryCloudScope = "shared" | "user";

function normalizeLanguage(input: string): string {
  const primary = input.trim().toLowerCase().split(/[-_]/)[0];
  return primary || "en";
}

function getSharedTranslationDoc(language: string, termId: string) {
  return doc(firestoreDb, "translationMemory", normalizeLanguage(language), "terms", termId);
}

function getUserTranslationDoc(userId: string, language: string, termId: string) {
  return doc(firestoreDb, "users", userId, "translationMemory", `${normalizeLanguage(language)}:${termId}`);
}

function pickCloudDoc(scope: TranslationMemoryCloudScope, language: string, termId: string, userId?: string) {
  if (scope === "shared") {
    return getSharedTranslationDoc(language, termId);
  }

  const resolvedUserId = userId ?? getCurrentUser()?.uid;
  if (!resolvedUserId) {
    throw new Error("A signed-in user is required for user-scoped translation memory.");
  }

  return getUserTranslationDoc(resolvedUserId, language, termId);
}

function toCloudPayload(entry: TranslationMemoryEntry): TranslationMemoryEntry {
  return {
    ...entry,
    language: normalizeLanguage(entry.language),
    lastUpdated: Date.now(),
  };
}

export async function fetchTranslationMemoryCloudEntry(
  language: string,
  termId: string,
  scope: TranslationMemoryCloudScope = "shared",
  userId?: string
): Promise<TranslationMemoryEntry | undefined> {
  try {
    const snapshot = await getDoc(pickCloudDoc(scope, language, termId, userId));
    if (!snapshot.exists()) {
      return undefined;
    }

    const data = snapshot.data() as TranslationMemoryEntry;
    return {
      ...data,
      language: normalizeLanguage(data.language ?? language),
      id: data.id || `${normalizeLanguage(language)}:${termId}`,
      termId: data.termId || termId,
      sourceText: data.sourceText || "",
      translatedText: data.translatedText || "",
      updatedBy: data.updatedBy || "ai",
      confidence: typeof data.confidence === "number" ? data.confidence : 0,
      lastUpdated: typeof data.lastUpdated === "number" ? data.lastUpdated : Date.now(),
    };
  } catch {
    return undefined;
  }
}

export async function upsertTranslationMemoryCloudEntry(
  entry: TranslationMemoryEntry,
  scope: TranslationMemoryCloudScope = "shared",
  userId?: string
): Promise<void> {
  const payload = toCloudPayload(entry);
  const ref = pickCloudDoc(scope, payload.language, payload.termId, userId);
  await setDoc(ref, payload, { merge: true });
}

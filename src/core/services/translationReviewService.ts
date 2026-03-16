import type { TranslationMemoryEntry, TranslationReviewItem } from "../models";
import {
  getTranslationMemoryEntry,
  listTranslationMemoryEntries,
  saveTranslationMemoryEntry,
} from "./repositories";
import {
  applyTranslationOverride,
  normalizeLanguageTag,
  type TranslationActor,
  type TranslationTermRequest,
  resolveTranslation,
} from "./translationWorkflowService";

export interface TranslationReviewQueueFilter {
  language?: string;
  subject?: string;
  maxConfidence?: number;
  recentlyChangedWithinMs?: number;
  highlightZomi?: boolean;
}

interface ReviewActionRequest {
  language: string;
  termId: string;
  actor: Extract<TranslationActor, "teacher" | "admin">;
  actorId?: string;
}

interface ReviewEditRequest extends ReviewActionRequest {
  sourceText: string;
  translatedText: string;
}

interface RejectAndRegenerateRequest {
  language: string;
  termId: string;
  sourceText: string;
  actorId?: string;
  contextTags?: string[];
  partOfSpeech?: string;
  aiTranslator?: (request: TranslationTermRequest) => Promise<
    { kind: "literal" | "contextual" | "academic"; text: string; confidence: number }[]
  >;
}

function toReviewItem(entry: TranslationMemoryEntry, reason: TranslationReviewItem["reason"]): TranslationReviewItem {
  return {
    id: entry.id,
    termId: entry.termId,
    sourceText: entry.sourceText,
    translatedText: entry.translatedText,
    language: entry.language,
    confidence: entry.confidence,
    updatedBy: entry.updatedBy,
    contextTags: entry.contextTags ?? [],
    lastUpdated: entry.lastUpdated,
    reason,
  };
}

function appendHistory(
  existing: TranslationMemoryEntry,
  nextValue: string,
  updatedBy: string
): NonNullable<TranslationMemoryEntry["history"]> {
  if (existing.translatedText === nextValue) {
    return existing.history ?? [];
  }

  return [
    ...(existing.history ?? []),
    {
      timestamp: Date.now(),
      oldValue: existing.translatedText,
      newValue: nextValue,
      updatedBy,
    },
  ].slice(-20);
}

export async function listTranslationReviewQueue(filter: TranslationReviewQueueFilter = {}): Promise<TranslationReviewItem[]> {
  const entries = await listTranslationMemoryEntries(filter.language ? normalizeLanguageTag(filter.language) : undefined);
  const now = Date.now();
  const maxConfidence = filter.maxConfidence ?? 0.8;
  const recentWindow = filter.recentlyChangedWithinMs ?? 14 * 24 * 60 * 60 * 1000;

  const queue = entries.flatMap((entry) => {
    const reasons: TranslationReviewItem["reason"][] = [];
    if (entry.updatedBy === "ai") {
      reasons.push("new-ai");
    }
    if (entry.confidence < maxConfidence) {
      reasons.push("low-confidence");
    }
    if (now - entry.lastUpdated <= recentWindow) {
      reasons.push("recently-changed");
    }

    if (!reasons.length) {
      return [];
    }

    if (filter.subject) {
      const normalizedSubject = filter.subject.trim().toLowerCase();
      const hasSubject = (entry.contextTags ?? []).some((tag) => tag.trim().toLowerCase() === normalizedSubject);
      if (!hasSubject) {
        return [];
      }
    }

    if (filter.highlightZomi && normalizeLanguageTag(entry.language) !== "zm") {
      return [];
    }

    return [toReviewItem(entry, reasons[0])];
  });

  queue.sort((left, right) => right.lastUpdated - left.lastUpdated);
  return queue;
}

export async function approveTranslationForReview(request: ReviewActionRequest): Promise<TranslationMemoryEntry | undefined> {
  const language = normalizeLanguageTag(request.language);
  const existing = await getTranslationMemoryEntry(language, request.termId);
  if (!existing) {
    return undefined;
  }

  const updatedByLabel = request.actorId ? `${request.actor}:${request.actorId}` : request.actor;

  const approved: TranslationMemoryEntry = {
    ...existing,
    updatedBy: request.actor,
    confidence: 1,
    locked: true,
    lastUpdated: Date.now(),
    history: appendHistory(existing, existing.translatedText, updatedByLabel),
  };

  await saveTranslationMemoryEntry(approved);
  return approved;
}

export async function editTranslationForReview(request: ReviewEditRequest): Promise<TranslationMemoryEntry> {
  const updated = await applyTranslationOverride({
    language: request.language,
    termId: request.termId,
    sourceText: request.sourceText,
    translatedText: request.translatedText,
    actor: request.actor,
    actorId: request.actorId,
  });

  const next: TranslationMemoryEntry = {
    ...updated,
    confidence: 1,
    locked: true,
    lastUpdated: Date.now(),
  };

  await saveTranslationMemoryEntry(next);
  return next;
}

export async function rejectAndRegenerateTranslation(request: RejectAndRegenerateRequest): Promise<TranslationMemoryEntry> {
  const regenerated = await resolveTranslation(
    {
      termId: request.termId,
      sourceText: request.sourceText,
      targetLanguage: request.language,
      contextTags: request.contextTags,
      partOfSpeech: request.partOfSpeech,
    },
    {
      aiTranslator: request.aiTranslator,
      forceAiRegeneration: true,
    }
  );

  const updated: TranslationMemoryEntry = {
    ...regenerated.entry,
    updatedBy: "ai",
    confidence: Math.min(0.89, regenerated.entry.confidence),
    locked: false,
    lastUpdated: Date.now(),
  };

  await saveTranslationMemoryEntry(updated);
  return updated;
}

export async function getTranslationHistory(language: string, termId: string) {
  const entry = await getTranslationMemoryEntry(normalizeLanguageTag(language), termId);
  return entry?.history ?? [];
}

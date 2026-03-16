import type { TranslationHistoryEntry, TranslationMemoryEntry } from "../models";
import {
  findTranslationMemoryBySourceText,
  getTranslationMemoryEntry,
  saveTranslationMemoryEntry,
} from "./repositories/translationMemoryRepository";

const BUILTIN_SUPPORTED_LANGUAGES = ["en", "es", "pt", "zm", "fr", "de"] as const;
const BUILTIN_LANGUAGE_ROADMAP = [
  "Chinese (Simplified)",
  "Chinese (Traditional)",
  "Hindi",
  "Arabic",
  "Bengali",
  "Russian",
  "Japanese",
  "Korean",
  "Italian",
  "Dutch",
] as const;

export type TranslationActor = "ai" | "teacher" | "admin";

export interface TranslationTermRequest {
  termId: string;
  sourceText: string;
  targetLanguage: string;
  partOfSpeech?: string;
  contextTags?: string[];
}

export interface TranslationBatchRequest {
  terms: TranslationTermRequest[];
  targetLanguage: string;
  actorId?: string;
}

export interface AiTranslationCandidate {
  kind: "literal" | "contextual" | "academic";
  text: string;
  confidence: number;
}

export interface TranslationResolutionResult {
  entry: TranslationMemoryEntry;
  source: "memory" | "cloud" | "ai";
}

export interface TranslationLanguageRegistry {
  supported: string[];
  roadmap: string[];
}

interface TranslationResolutionOptions {
  actorId?: string;
  forceAiRegeneration?: boolean;
  lookupCloudEntry?: (language: string, termId: string) => Promise<TranslationMemoryEntry | undefined>;
  persistCloudEntry?: (entry: TranslationMemoryEntry) => Promise<void>;
  aiTranslator?: (request: TranslationTermRequest) => Promise<AiTranslationCandidate[]>;
}

interface TranslationOverrideRequest {
  language: string;
  termId: string;
  sourceText: string;
  translatedText: string;
  actor: Extract<TranslationActor, "teacher" | "admin">;
  actorId?: string;
}

export function normalizeLanguageTag(input: string | null | undefined): string {
  const primary = (input ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return primary || "en";
}

export function getBuiltinLanguageRegistry(): TranslationLanguageRegistry {
  return {
    supported: [...BUILTIN_SUPPORTED_LANGUAGES],
    roadmap: [...BUILTIN_LANGUAGE_ROADMAP],
  };
}

export function isBuiltInLanguageSupported(language: string): boolean {
  const normalized = normalizeLanguageTag(language);
  return BUILTIN_SUPPORTED_LANGUAGES.includes(normalized as (typeof BUILTIN_SUPPORTED_LANGUAGES)[number]);
}

export function mergeLanguageRegistry(candidate: Partial<TranslationLanguageRegistry> | null | undefined): TranslationLanguageRegistry {
  const builtIn = getBuiltinLanguageRegistry();
  if (!candidate) {
    return builtIn;
  }

  const supported = Array.isArray(candidate.supported)
    ? [...new Set(candidate.supported.map((item) => normalizeLanguageTag(item)).filter(Boolean))]
    : builtIn.supported;

  const roadmap = Array.isArray(candidate.roadmap)
    ? [...new Set(candidate.roadmap.map((item) => item.trim()).filter(Boolean))]
    : builtIn.roadmap;

  return {
    supported: supported.length > 0 ? supported : builtIn.supported,
    roadmap,
  };
}

export async function fetchLanguageRegistryFromUrl(
  url = "/languages.json",
  fetchImpl: typeof fetch | undefined = typeof fetch === "function" ? fetch : undefined
): Promise<TranslationLanguageRegistry> {
  if (!fetchImpl) {
    return getBuiltinLanguageRegistry();
  }

  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return getBuiltinLanguageRegistry();
    }

    const payload = (await response.json()) as Partial<TranslationLanguageRegistry>;
    return mergeLanguageRegistry(payload);
  } catch {
    return getBuiltinLanguageRegistry();
  }
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function computeHeuristicConfidence(sourceText: string, language: string, variant: AiTranslationCandidate["kind"]): number {
  const base = variant === "literal" ? 0.62 : variant === "contextual" ? 0.71 : 0.78;
  const lengthBoost = Math.min(0.12, sourceText.trim().length / 200);
  const languageBoost = isBuiltInLanguageSupported(language) ? 0.05 : 0;
  return clampConfidence(base + lengthBoost + languageBoost);
}

export async function generateAiTranslationCandidates(request: TranslationTermRequest): Promise<AiTranslationCandidate[]> {
  const normalizedLanguage = normalizeLanguageTag(request.targetLanguage);
  const normalizedText = request.sourceText.trim();

  if (!normalizedText) {
    return [
      { kind: "literal", text: "", confidence: 0 },
      { kind: "contextual", text: "", confidence: 0 },
      { kind: "academic", text: "", confidence: 0 },
    ];
  }

  const localeTag = normalizedLanguage.toUpperCase();
  return [
    {
      kind: "literal",
      text: `${normalizedText} [${localeTag}:literal]`,
      confidence: computeHeuristicConfidence(normalizedText, normalizedLanguage, "literal"),
    },
    {
      kind: "contextual",
      text: `${normalizedText} [${localeTag}:contextual]`,
      confidence: computeHeuristicConfidence(normalizedText, normalizedLanguage, "contextual"),
    },
    {
      kind: "academic",
      text: `${normalizedText} [${localeTag}:academic]`,
      confidence: computeHeuristicConfidence(normalizedText, normalizedLanguage, "academic"),
    },
  ];
}

function selectBestCandidate(candidates: AiTranslationCandidate[]): AiTranslationCandidate {
  if (!candidates.length) {
    return { kind: "academic", text: "", confidence: 0 };
  }

  const sorted = [...candidates].sort((left, right) => right.confidence - left.confidence);
  return sorted[0];
}

function actorLabel(updatedBy: TranslationActor, actorId?: string): string {
  return actorId ? `${updatedBy}:${actorId}` : updatedBy;
}

function appendHistory(
  existing: TranslationMemoryEntry | undefined,
  nextValue: string,
  updatedBy: string
): TranslationHistoryEntry[] {
  if (!existing || existing.translatedText === nextValue) {
    return existing?.history ?? [];
  }

  const nextHistoryEntry: TranslationHistoryEntry = {
    timestamp: Date.now(),
    oldValue: existing.translatedText,
    newValue: nextValue,
    updatedBy,
  };

  return [...(existing.history ?? []), nextHistoryEntry].slice(-20);
}

function buildEntryId(language: string, termId: string): string {
  return `${normalizeLanguageTag(language)}:${termId}`;
}

export async function resolveTranslation(
  request: TranslationTermRequest,
  options: TranslationResolutionOptions = {}
): Promise<TranslationResolutionResult> {
  const normalizedLanguage = normalizeLanguageTag(request.targetLanguage);
  if (!options.forceAiRegeneration) {
    const existingByTermId = await getTranslationMemoryEntry(normalizedLanguage, request.termId);
    if (existingByTermId) {
      return {
        entry: existingByTermId,
        source: "memory",
      };
    }

    const existingBySource = await findTranslationMemoryBySourceText(normalizedLanguage, request.sourceText);
    if (existingBySource) {
      return {
        entry: existingBySource,
        source: "memory",
      };
    }
  }

  if (options.lookupCloudEntry) {
    const cloudEntry = await options.lookupCloudEntry(normalizedLanguage, request.termId);
    if (cloudEntry) {
      await saveTranslationMemoryEntry({
        ...cloudEntry,
        id: buildEntryId(normalizedLanguage, request.termId),
        language: normalizedLanguage,
      });

      return {
        entry: {
          ...cloudEntry,
          id: buildEntryId(normalizedLanguage, request.termId),
          language: normalizedLanguage,
        },
        source: "cloud",
      };
    }
  }

  const aiTranslator = options.aiTranslator ?? generateAiTranslationCandidates;
  const candidates = await aiTranslator({
    ...request,
    targetLanguage: normalizedLanguage,
  });

  const literal = candidates.find((candidate) => candidate.kind === "literal")?.text;
  const contextual = candidates.find((candidate) => candidate.kind === "contextual")?.text;
  const academic = candidates.find((candidate) => candidate.kind === "academic")?.text;
  const winner = selectBestCandidate(candidates);

  const entry: TranslationMemoryEntry = {
    id: buildEntryId(normalizedLanguage, request.termId),
    termId: request.termId,
    sourceText: request.sourceText,
    translatedText: winner.text,
    language: normalizedLanguage,
    partOfSpeech: request.partOfSpeech,
    contextTags: request.contextTags,
    lastUpdated: Date.now(),
    updatedBy: "ai",
    confidence: clampConfidence(winner.confidence),
    locked: false,
    literalTranslation: literal,
    contextualTranslation: contextual,
    academicTranslation: academic,
    history: [],
  };

  await saveTranslationMemoryEntry(entry);

  if (options.persistCloudEntry) {
    await options.persistCloudEntry(entry);
  }

  return {
    entry,
    source: "ai",
  };
}

export async function applyTranslationOverride(request: TranslationOverrideRequest): Promise<TranslationMemoryEntry> {
  const language = normalizeLanguageTag(request.language);
  const existing = await getTranslationMemoryEntry(language, request.termId);
  const updatedBy = actorLabel(request.actor, request.actorId);

  const updated: TranslationMemoryEntry = {
    id: buildEntryId(language, request.termId),
    termId: request.termId,
    sourceText: existing?.sourceText ?? request.sourceText,
    translatedText: request.translatedText.trim(),
    language,
    partOfSpeech: existing?.partOfSpeech,
    contextTags: existing?.contextTags,
    lastUpdated: Date.now(),
    updatedBy: request.actor,
    confidence: 1,
    locked: true,
    literalTranslation: existing?.literalTranslation,
    contextualTranslation: existing?.contextualTranslation,
    academicTranslation: existing?.academicTranslation,
    history: appendHistory(existing, request.translatedText.trim(), updatedBy),
  };

  await saveTranslationMemoryEntry(updated);
  return updated;
}

export async function resetTranslationToAi(
  language: string,
  termId: string,
  actorId?: string
): Promise<TranslationMemoryEntry | undefined> {
  const normalizedLanguage = normalizeLanguageTag(language);
  const existing = await getTranslationMemoryEntry(normalizedLanguage, termId);
  if (!existing) {
    return undefined;
  }

  const resetValue = existing.academicTranslation
    ?? existing.contextualTranslation
    ?? existing.literalTranslation
    ?? existing.sourceText;

  const updatedBy = actorLabel("ai", actorId);

  const updated: TranslationMemoryEntry = {
    ...existing,
    translatedText: resetValue,
    updatedBy: "ai",
    confidence: clampConfidence(Math.max(existing.confidence, 0.76)),
    locked: false,
    lastUpdated: Date.now(),
    history: appendHistory(existing, resetValue, updatedBy),
  };

  await saveTranslationMemoryEntry(updated);
  return updated;
}

export async function batchResolveTranslations(
  request: TranslationBatchRequest,
  options: TranslationResolutionOptions = {}
): Promise<TranslationResolutionResult[]> {
  const normalizedLanguage = normalizeLanguageTag(request.targetLanguage);
  const results: TranslationResolutionResult[] = [];

  for (const term of request.terms) {
    const result = await resolveTranslation(
      {
        ...term,
        targetLanguage: normalizedLanguage,
      },
      {
        ...options,
        actorId: request.actorId,
      }
    );
    results.push(result);
  }

  return results;
}

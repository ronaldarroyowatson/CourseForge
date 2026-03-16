import type { AiTranslationCandidate, TranslationActor, TranslationTermRequest } from "./translationWorkflowService";
import type { GlossaryEntry } from "../models";
import {
  findGlossaryMatch,
  listGlossaryEntries,
  saveGlossaryEntry,
} from "./repositories";

interface GlossaryLookupRequest {
  subject: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceText: string;
}

interface AddGlossaryFromOverrideRequest {
  subject: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTerm: string;
  preferredTranslation: string;
  notes?: string;
  usageRef?: string;
  actor: Extract<TranslationActor, "teacher" | "admin">;
}

function normalizeLanguage(input: string): string {
  const primary = input.trim().toLowerCase().split(/[-_]/)[0];
  return primary || "en";
}

function normalizeSubject(input: string): string {
  return input.trim().toLowerCase() || "general";
}

export async function lookupGlossaryHints(request: GlossaryLookupRequest): Promise<GlossaryEntry[]> {
  return findGlossaryMatch(
    normalizeSubject(request.subject),
    normalizeLanguage(request.sourceLanguage),
    normalizeLanguage(request.targetLanguage),
    request.sourceText
  );
}

export function applyGlossaryBoost(
  candidates: AiTranslationCandidate[],
  sourceText: string,
  glossaryMatches: GlossaryEntry[]
): AiTranslationCandidate[] {
  if (!glossaryMatches.length) {
    return candidates;
  }

  const preferred = glossaryMatches[0];
  const normalizedSourceText = sourceText.trim().toLowerCase();
  const normalizedSourceTerm = preferred.sourceTerm.trim().toLowerCase();
  const confidenceBonus = Math.min(0.2, glossaryMatches.length * 0.05);

  const boosted = candidates.map((candidate) => {
    const next = { ...candidate };
    if (normalizedSourceText === normalizedSourceTerm) {
      next.text = preferred.preferredTranslation;
    } else if (normalizedSourceTerm && normalizedSourceText.includes(normalizedSourceTerm)) {
      const pattern = new RegExp(preferred.sourceTerm, "ig");
      next.text = sourceText.replace(pattern, preferred.preferredTranslation);
    }

    next.confidence = Math.min(1, next.confidence + confidenceBonus);
    return next;
  });

  const hasPreferredCandidate = boosted.some(
    (candidate) => candidate.text.trim().toLowerCase() === preferred.preferredTranslation.trim().toLowerCase()
  );

  if (!hasPreferredCandidate) {
    boosted.push({
      kind: "academic",
      text: preferred.preferredTranslation,
      confidence: 0.95,
    });
  }

  return boosted;
}

export async function buildGlossaryAwareTranslator(
  request: TranslationTermRequest,
  subject: string,
  sourceLanguage: string,
  baseTranslator: (input: TranslationTermRequest) => Promise<AiTranslationCandidate[]>
): Promise<AiTranslationCandidate[]> {
  const matches = await lookupGlossaryHints({
    subject,
    sourceLanguage,
    targetLanguage: request.targetLanguage,
    sourceText: request.sourceText,
  });

  const candidates = await baseTranslator(request);
  return applyGlossaryBoost(candidates, request.sourceText, matches);
}

export async function addGlossaryFromOverride(request: AddGlossaryFromOverrideRequest): Promise<GlossaryEntry> {
  const now = Date.now();
  const existing = await listGlossaryEntries({
    subject: request.subject,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
  });

  const duplicate = existing.find(
    (entry) => entry.sourceTerm.trim().toLowerCase() === request.sourceTerm.trim().toLowerCase()
  );

  const usageRefs = duplicate?.usageRefs ?? [];
  if (request.usageRef && !usageRefs.includes(request.usageRef)) {
    usageRefs.push(request.usageRef);
  }

  const glossaryEntry: GlossaryEntry = {
    id: duplicate?.id ?? "",
    subject: normalizeSubject(request.subject),
    sourceLanguage: normalizeLanguage(request.sourceLanguage),
    targetLanguage: normalizeLanguage(request.targetLanguage),
    sourceTerm: request.sourceTerm.trim(),
    preferredTranslation: request.preferredTranslation.trim(),
    notes: request.notes,
    usageRefs,
    createdAt: duplicate?.createdAt ?? now,
    updatedAt: now,
    updatedBy: request.actor,
  };

  await saveGlossaryEntry(glossaryEntry);
  const savedId = `${glossaryEntry.subject}:${glossaryEntry.sourceLanguage}-${glossaryEntry.targetLanguage}:${glossaryEntry.sourceTerm.trim().toLowerCase()}`;

  return {
    ...glossaryEntry,
    id: savedId,
  };
}

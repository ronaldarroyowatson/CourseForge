import type { GameTextEntry } from "../models";
import {
  getGameTextEntry,
  listGameTextEntries,
  saveGameTextEntry,
} from "./repositories";
import { buildGlossaryAwareTranslator } from "./glossaryService";
import {
  generateAiTranslationCandidates,
  normalizeLanguageTag,
  resolveTranslation,
  type TranslationTermRequest,
} from "./translationWorkflowService";

export interface CreateGameTextEntryRequest {
  gameId: string;
  entryId: string;
  key: string;
  sourceText: string;
  defaultLanguage?: string;
  targetLanguages: string[];
  contextTags?: string[];
  subject?: string;
  sourceLanguage?: string;
}

function buildGameTextId(gameId: string, entryId: string): string {
  return `${gameId}:${entryId}`;
}

export async function upsertGameTextEntry(request: CreateGameTextEntryRequest): Promise<GameTextEntry> {
  const defaultLanguage = normalizeLanguageTag(request.defaultLanguage ?? "en");
  const subject = request.subject ?? "general";
  const sourceLanguage = request.sourceLanguage ?? defaultLanguage;
  const texts: Record<string, string> = {
    [defaultLanguage]: request.sourceText,
  };

  for (const language of request.targetLanguages) {
    const normalizedLanguage = normalizeLanguageTag(language);
    if (normalizedLanguage === defaultLanguage) {
      continue;
    }

    const translated = await resolveTranslation(
      {
        termId: request.key,
        sourceText: request.sourceText,
        targetLanguage: normalizedLanguage,
        contextTags: request.contextTags,
      },
      {
        aiTranslator: async (translationRequest: TranslationTermRequest) => buildGlossaryAwareTranslator(
          translationRequest,
          subject,
          sourceLanguage,
          generateAiTranslationCandidates
        ),
      }
    );

    texts[normalizedLanguage] = translated.entry.translatedText;
  }

  const gameEntry: GameTextEntry = {
    id: buildGameTextId(request.gameId, request.entryId),
    gameId: request.gameId,
    key: request.key,
    defaultLanguage,
    texts,
    contextTags: request.contextTags,
    lastUpdated: Date.now(),
    updatedBy: "system",
  };

  await saveGameTextEntry(gameEntry);
  return gameEntry;
}

export async function batchUpsertGameTextEntries(requests: CreateGameTextEntryRequest[]): Promise<GameTextEntry[]> {
  const output: GameTextEntry[] = [];
  for (const request of requests) {
    output.push(await upsertGameTextEntry(request));
  }
  return output;
}

export async function resolveGameText(gameId: string, entryId: string, language: string): Promise<string | undefined> {
  const entry = await getGameTextEntry(gameId, entryId);
  if (!entry) {
    return undefined;
  }

  const normalizedLanguage = normalizeLanguageTag(language);
  return entry.texts[normalizedLanguage] ?? entry.texts.en ?? entry.texts[entry.defaultLanguage];
}

export function resolveGameTextFromEntry(entry: GameTextEntry, language: string): string {
  const normalizedLanguage = normalizeLanguageTag(language);
  return entry.texts[normalizedLanguage] ?? entry.texts.en ?? entry.texts[entry.defaultLanguage] ?? "";
}

export async function listGameTextForLanguage(gameId: string, language: string): Promise<Array<{ key: string; text: string }>> {
  const entries = await listGameTextEntries(gameId);
  return entries.map((entry) => ({
    key: entry.key,
    text: resolveGameTextFromEntry(entry, language),
  }));
}

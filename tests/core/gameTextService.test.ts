import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { getStore, STORE_NAMES } from "../../src/core/services/db";
import { saveTranslationMemoryEntry } from "../../src/core/services/repositories";
import {
  batchUpsertGameTextEntries,
  resolveGameText,
  resolveGameTextFromEntry,
  upsertGameTextEntry,
} from "../../src/core/services/gameTextService";

async function clearStores(): Promise<void> {
  const translationStore = await getStore(STORE_NAMES.translationMemory, "readwrite");
  await translationStore.store.clear();
  await translationStore.tx.done;

  const gameStore = await getStore(STORE_NAMES.gameText, "readwrite");
  await gameStore.store.clear();
  await gameStore.tx.done;
}

describe("gameTextService", () => {
  beforeEach(async () => {
    await clearStores();
  });

  it("loads game text in selected language and falls back to english", async () => {
    const entry = await upsertGameTextEntry({
      gameId: "quiz-1",
      entryId: "start",
      key: "game.startButton",
      sourceText: "Start",
      defaultLanguage: "en",
      targetLanguages: ["es"],
      contextTags: ["ui"],
    });

    const es = await resolveGameText("quiz-1", "start", "es");
    expect(es).toBeTruthy();

    const jaFallback = resolveGameTextFromEntry(entry, "ja");
    expect(jaFallback).toBe("Start");
  });

  it("prefills game text from translation memory when available", async () => {
    await saveTranslationMemoryEntry({
      id: "es:quiz.correctAnswer",
      termId: "quiz.correctAnswer",
      sourceText: "Correct answer",
      translatedText: "respuesta correcta",
      language: "es",
      contextTags: ["feedback"],
      lastUpdated: Date.now(),
      updatedBy: "teacher",
      confidence: 1,
      history: [],
    });

    const entry = await upsertGameTextEntry({
      gameId: "quiz-2",
      entryId: "correct",
      key: "quiz.correctAnswer",
      sourceText: "Correct answer",
      defaultLanguage: "en",
      targetLanguages: ["es"],
      contextTags: ["feedback"],
    });

    expect(entry.texts.es).toBe("respuesta correcta");
  });

  it("batch translates game text keys", async () => {
    const entries = await batchUpsertGameTextEntries([
      {
        gameId: "quiz-3",
        entryId: "start",
        key: "game.startButton",
        sourceText: "Start",
        defaultLanguage: "en",
        targetLanguages: ["fr", "de"],
      },
      {
        gameId: "quiz-3",
        entryId: "next",
        key: "game.nextButton",
        sourceText: "Next",
        defaultLanguage: "en",
        targetLanguages: ["fr", "de"],
      },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.texts.fr).toBeTruthy();
    expect(entries[1]?.texts.de).toBeTruthy();
  });
});

import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStore, STORE_NAMES } from "../../src/core/services/db";
import { saveTranslationMemoryEntry } from "../../src/core/services/repositories";
import {
  approveTranslationForReview,
  editTranslationForReview,
  listTranslationReviewQueue,
  rejectAndRegenerateTranslation,
} from "../../src/core/services/translationReviewService";

async function clearTranslationMemory(): Promise<void> {
  const { store, tx } = await getStore(STORE_NAMES.translationMemory, "readwrite");
  await store.clear();
  await tx.done;
}

describe("translationReviewService", () => {
  beforeEach(async () => {
    await clearTranslationMemory();
  });

  it("approves translation and locks confidence at 1.0", async () => {
    await saveTranslationMemoryEntry({
      id: "es:term-approve",
      termId: "term-approve",
      sourceText: "cell",
      translatedText: "celula",
      language: "es",
      lastUpdated: Date.now(),
      updatedBy: "ai",
      confidence: 0.68,
      history: [],
    });

    const approved = await approveTranslationForReview({
      language: "es",
      termId: "term-approve",
      actor: "teacher",
    });

    expect(approved).toBeDefined();
    expect(approved?.updatedBy).toBe("teacher");
    expect(approved?.confidence).toBe(1);
    expect(approved?.locked).toBe(true);
  });

  it("edits translation and keeps history while updating memory", async () => {
    await saveTranslationMemoryEntry({
      id: "fr:term-edit",
      termId: "term-edit",
      sourceText: "slope",
      translatedText: "pente",
      language: "fr",
      lastUpdated: Date.now(),
      updatedBy: "ai",
      confidence: 0.74,
      history: [],
    });

    const updated = await editTranslationForReview({
      language: "fr",
      termId: "term-edit",
      sourceText: "slope",
      translatedText: "inclinaison",
      actor: "admin",
      actorId: "admin-1",
    });

    expect(updated.translatedText).toBe("inclinaison");
    expect(updated.confidence).toBe(1);
    expect(updated.history?.length).toBe(1);
    expect(updated.history?.[0]?.oldValue).toBe("pente");
  });

  it("rejects and regenerates translation by calling AI pipeline", async () => {
    await saveTranslationMemoryEntry({
      id: "de:term-reject",
      termId: "term-reject",
      sourceText: "equation",
      translatedText: "gleichung-alt",
      language: "de",
      lastUpdated: Date.now(),
      updatedBy: "teacher",
      confidence: 1,
      history: [],
    });

    const aiTranslator = vi.fn(async () => [
      { kind: "literal" as const, text: "gleichung-neu", confidence: 0.6 },
      { kind: "contextual" as const, text: "gleichung-neu-kontext", confidence: 0.7 },
      { kind: "academic" as const, text: "gleichung-neu-akademisch", confidence: 0.83 },
    ]);

    const regenerated = await rejectAndRegenerateTranslation({
      language: "de",
      termId: "term-reject",
      sourceText: "equation",
      aiTranslator,
    });

    expect(aiTranslator).toHaveBeenCalled();
    expect(regenerated.updatedBy).toBe("ai");
    expect(regenerated.translatedText).toBe("gleichung-neu-akademisch");
    expect(regenerated.locked).toBe(false);
    expect(regenerated.confidence).toBeLessThan(0.9);
  });

  it("filters review queue by language and subject", async () => {
    await saveTranslationMemoryEntry({
      id: "es:term-bio",
      termId: "term-bio",
      sourceText: "cell",
      translatedText: "celula",
      language: "es",
      contextTags: ["biology"],
      lastUpdated: Date.now(),
      updatedBy: "ai",
      confidence: 0.66,
      history: [],
    });

    await saveTranslationMemoryEntry({
      id: "zm:term-zomi",
      termId: "term-zomi",
      sourceText: "welcome",
      translatedText: "welcome [ZM:literal]",
      language: "zm",
      contextTags: ["ui"],
      lastUpdated: Date.now(),
      updatedBy: "ai",
      confidence: 0.65,
      history: [],
    });

    const subjectFiltered = await listTranslationReviewQueue({ language: "es", subject: "biology" });
    expect(subjectFiltered).toHaveLength(1);
    expect(subjectFiltered[0]?.termId).toBe("term-bio");

    const zomiOnly = await listTranslationReviewQueue({ highlightZomi: true });
    expect(zomiOnly.every((item) => item.language === "zm")).toBe(true);
  });
});

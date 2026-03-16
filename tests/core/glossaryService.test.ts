import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { getStore, STORE_NAMES } from "../../src/core/services/db";
import {
  addGlossaryFromOverride,
  applyGlossaryBoost,
  buildGlossaryAwareTranslator,
  lookupGlossaryHints,
} from "../../src/core/services/glossaryService";

async function clearGlossaries(): Promise<void> {
  const { store, tx } = await getStore(STORE_NAMES.glossaries, "readwrite");
  await store.clear();
  await tx.done;
}

describe("glossaryService", () => {
  beforeEach(async () => {
    await clearGlossaries();
  });

  it("uses glossary entries to influence translation output", async () => {
    await addGlossaryFromOverride({
      subject: "biology",
      sourceLanguage: "en",
      targetLanguage: "es",
      sourceTerm: "photosynthesis",
      preferredTranslation: "fotosintesis",
      actor: "teacher",
      usageRef: "textbook:bio-1",
    });

    const translated = await buildGlossaryAwareTranslator(
      {
        termId: "bio.photosynthesis",
        sourceText: "photosynthesis",
        targetLanguage: "es",
      },
      "biology",
      "en",
      async () => [
        { kind: "literal", text: "fotosintesis literal", confidence: 0.5 },
        { kind: "contextual", text: "fotosintesis contextual", confidence: 0.65 },
        { kind: "academic", text: "fotosintesis academica", confidence: 0.7 },
      ]
    );

    expect(translated.some((candidate) => candidate.text === "fotosintesis")).toBe(true);
  });

  it("supports add-to-glossary workflow from override UI", async () => {
    const entry = await addGlossaryFromOverride({
      subject: "physics",
      sourceLanguage: "en",
      targetLanguage: "fr",
      sourceTerm: "acceleration",
      preferredTranslation: "acceleration",
      notes: "Preferred by teacher panel override.",
      usageRef: "translationMemory:physics.acceleration",
      actor: "admin",
    });

    expect(entry.id).toContain("physics:en-fr:acceleration");
    expect(entry.usageRefs).toContain("translationMemory:physics.acceleration");
  });

  it("reuses glossary entries across multiple translations", async () => {
    await addGlossaryFromOverride({
      subject: "biology",
      sourceLanguage: "en",
      targetLanguage: "es",
      sourceTerm: "cell membrane",
      preferredTranslation: "membrana celular",
      actor: "teacher",
    });

    const hintsA = await lookupGlossaryHints({
      subject: "biology",
      sourceLanguage: "en",
      targetLanguage: "es",
      sourceText: "cell membrane",
    });

    const hintsB = await lookupGlossaryHints({
      subject: "biology",
      sourceLanguage: "en",
      targetLanguage: "es",
      sourceText: "The cell membrane controls transport.",
    });

    expect(hintsA.length).toBeGreaterThan(0);
    expect(hintsB.length).toBeGreaterThan(0);

    const boosted = applyGlossaryBoost(
      [{ kind: "literal", text: "cell membrane", confidence: 0.5 }],
      "The cell membrane controls transport.",
      hintsB
    );

    expect(boosted[0]?.confidence).toBeGreaterThan(0.5);
  });
});

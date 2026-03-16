import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStore, STORE_NAMES } from "../../src/core/services/db";
import { saveTranslationMemoryEntry } from "../../src/core/services/repositories";
import {
  applyTranslationOverride,
  batchResolveTranslations,
  fetchLanguageRegistryFromUrl,
  resolveTranslation,
  resetTranslationToAi,
} from "../../src/core/services/translationWorkflowService";

async function clearTranslationMemory(): Promise<void> {
  const { store, tx } = await getStore(STORE_NAMES.translationMemory, "readwrite");
  await store.clear();
  await tx.done;
}

describe("translationWorkflowService", () => {
  beforeEach(async () => {
    await clearTranslationMemory();
  });

  it("prefers local translation memory before AI fallback", async () => {
    await saveTranslationMemoryEntry({
      id: "es:term-1",
      termId: "term-1",
      sourceText: "fraction",
      translatedText: "fraccion",
      language: "es",
      lastUpdated: Date.now(),
      updatedBy: "teacher",
      confidence: 0.95,
      history: [],
    });

    const aiTranslator = vi.fn(async () => [
      { kind: "literal" as const, text: "fraccion-literal", confidence: 0.5 },
      { kind: "contextual" as const, text: "fraccion-contextual", confidence: 0.6 },
      { kind: "academic" as const, text: "fraccion-academic", confidence: 0.8 },
    ]);

    const result = await resolveTranslation(
      {
        termId: "term-1",
        sourceText: "fraction",
        targetLanguage: "es",
      },
      { aiTranslator }
    );

    expect(result.source).toBe("memory");
    expect(result.entry.translatedText).toBe("fraccion");
    expect(aiTranslator).not.toHaveBeenCalled();
  });

  it("falls back to AI and persists candidate variants", async () => {
    const result = await resolveTranslation(
      {
        termId: "term-2",
        sourceText: "equation",
        targetLanguage: "de",
      },
      {
        aiTranslator: async () => [
          { kind: "literal", text: "gleichung", confidence: 0.72 },
          { kind: "contextual", text: "gleichung-kontext", confidence: 0.81 },
          { kind: "academic", text: "gleichung-akademisch", confidence: 0.88 },
        ],
      }
    );

    expect(result.source).toBe("ai");
    expect(result.entry.updatedBy).toBe("ai");
    expect(result.entry.translatedText).toBe("gleichung-akademisch");
    expect(result.entry.literalTranslation).toBe("gleichung");
    expect(result.entry.contextualTranslation).toBe("gleichung-kontext");
    expect(result.entry.academicTranslation).toBe("gleichung-akademisch");
  });

  it("records history when admin overrides and reset to ai baseline", async () => {
    await resolveTranslation(
      {
        termId: "term-3",
        sourceText: "slope",
        targetLanguage: "fr",
      },
      {
        aiTranslator: async () => [
          { kind: "literal", text: "pente", confidence: 0.7 },
          { kind: "contextual", text: "inclinaison", confidence: 0.75 },
          { kind: "academic", text: "pente academique", confidence: 0.83 },
        ],
      }
    );

    const override = await applyTranslationOverride({
      language: "fr",
      termId: "term-3",
      sourceText: "slope",
      translatedText: "pente admin",
      actor: "admin",
      actorId: "admin-user",
    });

    expect(override.updatedBy).toBe("admin");
    expect(override.history?.length).toBe(1);

    const reset = await resetTranslationToAi("fr", "term-3", "system");
    expect(reset).toBeDefined();
    expect(reset?.updatedBy).toBe("ai");
    expect(reset?.translatedText).toBe("pente academique");
    expect((reset?.history?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("supports batch resolution and reports each source", async () => {
    await saveTranslationMemoryEntry({
      id: "pt:term-4",
      termId: "term-4",
      sourceText: "volume",
      translatedText: "volume",
      language: "pt",
      lastUpdated: Date.now(),
      updatedBy: "teacher",
      confidence: 0.96,
      history: [],
    });

    const results = await batchResolveTranslations(
      {
        targetLanguage: "pt",
        terms: [
          { termId: "term-4", sourceText: "volume", targetLanguage: "pt" },
          { termId: "term-5", sourceText: "area", targetLanguage: "pt" },
        ],
      },
      {
        aiTranslator: async () => [
          { kind: "literal", text: "area literal", confidence: 0.62 },
          { kind: "contextual", text: "area contextual", confidence: 0.73 },
          { kind: "academic", text: "area academica", confidence: 0.79 },
        ],
      }
    );

    expect(results).toHaveLength(2);
    expect(results[0].source).toBe("memory");
    expect(results[1].source).toBe("ai");
  });

  it("falls back to built-in language registry when fetch fails", async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error("network");
    });

    const registry = await fetchLanguageRegistryFromUrl("/languages.json", failingFetch as unknown as typeof fetch);
    expect(registry.supported).toContain("en");
    expect(registry.roadmap.length).toBeGreaterThan(0);
  });
});

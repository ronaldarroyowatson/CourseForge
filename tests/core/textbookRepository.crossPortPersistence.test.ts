import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Textbook } from "../../src/core/models";

const dbState = {
  textbooks: [] as Textbook[],
};

vi.mock("../../src/core/services/db", () => ({
  STORE_NAMES: {
    textbooks: "textbooks",
    chapters: "chapters",
    sections: "sections",
    vocabTerms: "vocabTerms",
    equations: "equations",
    concepts: "concepts",
    keyIdeas: "keyIdeas",
    translationMemory: "translationMemory",
    gameText: "gameText",
    glossaries: "glossaries",
    ingestFingerprints: "ingestFingerprints",
    extractedPresentations: "extractedPresentations",
  },
  save: vi.fn(async (_storeName: string, value: Textbook) => {
    const existingIndex = dbState.textbooks.findIndex((entry) => entry.id === value.id);
    if (existingIndex >= 0) {
      dbState.textbooks[existingIndex] = value;
    } else {
      dbState.textbooks.push(value);
    }
    return value.id;
  }),
  getById: vi.fn(async (_storeName: string, id: string) => dbState.textbooks.find((entry) => entry.id === id)),
  getAll: vi.fn(async (_storeName: string) => [...dbState.textbooks]),
  delete: vi.fn(async (_storeName: string, id: string) => {
    const next = dbState.textbooks.filter((entry) => entry.id !== id);
    dbState.textbooks.length = 0;
    dbState.textbooks.push(...next);
  }),
}));

import { listTextbooks, saveTextbook } from "../../src/core/services/repositories/textbookRepository";

function createTextbook(id: string): Textbook {
  const timestamp = "2026-04-28T00:00:00.000Z";
  return {
    id,
    sourceType: "manual",
     originalLanguage: "en",
    title: "Inspire Physical Science",
    grade: "8",
    subject: "Science",
    edition: "Student",
    publicationYear: 2021,
    isbnRaw: "9780076716852",
    isbnNormalized: "9780076716852",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
    isFavorite: true,
    isArchived: false,
  };
}

describe("textbookRepository cross-port persistence", () => {
  beforeEach(() => {
    dbState.textbooks.length = 0;
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/local-textbooks-state") && (!init || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({ textbooks: [createTextbook("tb-shared")] }),
        } as Response;
      }

      if (url.endsWith("/api/local-textbooks-state") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({}),
      } as Response;
    }));
  });

  it("hydrates local textbook list from shared localhost snapshot when local store is empty", async () => {
    const textbooks = await listTextbooks();
    expect(textbooks).toHaveLength(1);
    expect(textbooks[0]?.id).toBe("tb-shared");
    expect(textbooks[0]?.isFavorite).toBe(true);
  });

  it("publishes textbook snapshot after save so other localhost ports can read the same data", async () => {
    const fetchSpy = vi.mocked(fetch);
    await saveTextbook(createTextbook("tb-local"));

    const postCall = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
    expect(String(postCall?.[0])).toContain("/api/local-textbooks-state");
    expect(String(postCall?.[1]?.body ?? "")).toContain("tb-local");
  });
});

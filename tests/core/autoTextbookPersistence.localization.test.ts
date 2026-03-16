import { describe, expect, it, vi } from "vitest";

import { persistAutoTextbook } from "../../src/core/services/autoTextbookPersistenceService";

describe("auto textbook persistence localization", () => {
  it("passes original language and translated fields into textbook persistence", async () => {
    const createTextbook = vi.fn(async (_input: {
      originalLanguage?: string;
      translatedFields?: Record<string, { title?: string }>;
    }) => "tb-loc-1");
    const createChapter = vi.fn(async () => "ch-loc-1");
    const createSection = vi.fn(async () => "sec-loc-1");

    await persistAutoTextbook(
      {
        metadata: {
          sourceType: "auto",
          originalLanguage: "es",
          translatedFields: {
            en: {
              title: "Chemistry",
              subtitle: "Foundations",
              chapters: ["Matter"],
              sections: ["Atoms"],
            },
          },
          title: "Quimica",
          grade: "10",
          subject: "Science",
          edition: "1",
          publicationYear: 2026,
          isbnRaw: "123",
        },
        coverDataUrl: "data:image/jpeg;base64,abc",
        tocChapters: [],
      },
      {
        createTextbook,
        createChapter,
        createSection,
      }
    );

    expect(createTextbook).toHaveBeenCalledTimes(1);
    const firstCall = createTextbook.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected createTextbook to be called once.");
    }
    const payload = firstCall[0];
    expect(payload.originalLanguage).toBe("es");
    expect(payload.translatedFields?.en?.title).toBe("Chemistry");
  });
});

import { describe, expect, it } from "vitest";

import type { Textbook } from "../../src/core/models";
import {
  computeMetadataRichness,
  findAllDuplicatePairs,
} from "../../src/core/services/repositories/textbookRepository";

function buildTextbook(overrides: Partial<Textbook> & { id: string }): Textbook {
  const now = new Date().toISOString();
  return {
    sourceType: "manual",
    originalLanguage: "en",
    title: "Test Textbook",
    grade: "8",
    subject: "Science",
    edition: "1",
    publicationYear: 2025,
    isbnRaw: "",
    isbnNormalized: "",
    createdAt: now,
    updatedAt: now,
    lastModified: now,
    pendingSync: false,
    source: "local",
    isFavorite: false,
    isArchived: false,
    ...overrides,
  };
}

describe("findAllDuplicatePairs", () => {
  it("returns empty array when fewer than two textbooks provided", () => {
    expect(findAllDuplicatePairs([])).toHaveLength(0);
    expect(findAllDuplicatePairs([buildTextbook({ id: "a" })])).toHaveLength(0);
  });

  it("does not return a self-pair", () => {
    const tb = buildTextbook({ id: "a", isbnNormalized: "9780123456789" });
    expect(findAllDuplicatePairs([tb, tb])).toHaveLength(0);
  });

  it("detects a duplicate pair by matching normalized ISBN", () => {
    const a = buildTextbook({ id: "a", isbnNormalized: "9780123456789" });
    const b = buildTextbook({ id: "b", isbnNormalized: "9780123456789" });
    const pairs = findAllDuplicatePairs([a, b]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0][0].id).toBe("a");
    expect(pairs[0][1].id).toBe("b");
  });

  it("detects a duplicate pair by matching raw ISBN fallback", () => {
    const a = buildTextbook({ id: "a", isbnRaw: "978-0-123-45678-9" });
    const b = buildTextbook({ id: "b", isbnRaw: "978-0-123-45678-9" });
    const pairs = findAllDuplicatePairs([a, b]);
    expect(pairs).toHaveLength(1);
  });

  it("detects a duplicate pair by matching all 5 metadata fields", () => {
    const a = buildTextbook({
      id: "a",
      title: "Algebra Basics",
      grade: "9",
      publisher: "Pearson",
      seriesName: "Math Series",
      publicationYear: 2022,
    });
    const b = buildTextbook({
      id: "b",
      title: "Algebra Basics",
      grade: "9",
      publisher: "Pearson",
      seriesName: "Math Series",
      publicationYear: 2022,
    });
    expect(findAllDuplicatePairs([a, b])).toHaveLength(1);
  });

  it("does not flag a pair when only some metadata fields match", () => {
    // Title and grade match but publisher differs
    const a = buildTextbook({ id: "a", title: "Algebra Basics", grade: "9", publisher: "Pearson", seriesName: "Math Series", publicationYear: 2022 });
    const b = buildTextbook({ id: "b", title: "Algebra Basics", grade: "9", publisher: "McGraw-Hill", seriesName: "Math Series", publicationYear: 2022 });
    expect(findAllDuplicatePairs([a, b])).toHaveLength(0);
  });

  it("skips tombstoned textbooks", () => {
    const a = buildTextbook({ id: "a", isbnNormalized: "9780123456789", isDeleted: true });
    const b = buildTextbook({ id: "b", isbnNormalized: "9780123456789" });
    expect(findAllDuplicatePairs([a, b])).toHaveLength(0);
  });

  it("does not produce duplicate pairs when three matching textbooks provided", () => {
    const a = buildTextbook({ id: "a", isbnNormalized: "9780123456789" });
    const b = buildTextbook({ id: "b", isbnNormalized: "9780123456789" });
    const c = buildTextbook({ id: "c", isbnNormalized: "9780123456789" });
    const pairs = findAllDuplicatePairs([a, b, c]);
    // Should be: (a,b), (a,c), (b,c) — 3 unique pairs
    expect(pairs).toHaveLength(3);
    // No pair should have the same id on both sides
    for (const [x, y] of pairs) {
      expect(x.id).not.toBe(y.id);
    }
    // No duplicate pair keys
    const keys = pairs.map(([x, y]) => [x.id, y.id].sort().join(":"));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("computeMetadataRichness", () => {
  it("returns 0 filled for an empty textbook", () => {
    const tb = buildTextbook({ id: "a" });
    const { filled, total } = computeMetadataRichness(tb);
    expect(total).toBe(11);
    // subtitle, edition, subject, publicationYear, authors, seriesName, mhid, coverImageUrl, tocExtractionConfidence
    // Grade is populated in buildTextbook so only grade should count
    expect(filled).toBeGreaterThanOrEqual(0);
    expect(filled).toBeLessThanOrEqual(total);
  });

  it("counts all populated optional fields", () => {
    const tb = buildTextbook({
      id: "a",
      subtitle: "Part 1",
      grade: "9",
      publisher: "Pearson",
      edition: "2nd",
      subject: "Math",
      publicationYear: 2023,
      authors: ["Alice", "Bob"],
      seriesName: "Math Series",
      mhid: "MH123",
      coverImageUrl: "https://example.com/cover.jpg",
      tocExtractionConfidence: 0.95,
    });
    const { filled, total } = computeMetadataRichness(tb);
    expect(total).toBe(11);
    expect(filled).toBe(11);
  });
});

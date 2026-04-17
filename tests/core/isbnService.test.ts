import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchFromGoogleBooks,
  fetchFromOpenLibrary,
  fetchMetadataByAnyISBN,
  fetchMetadataByISBN,
  normalizeISBN,
} from "../../src/core/services/isbnService";

const originalFetch = globalThis.fetch;

describe("isbnService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes ISBN by removing non-digits", () => {
    expect(normalizeISBN("978-1-4028-9462-6")).toBe("9781402894626");
    expect(normalizeISBN(" 0-19-852663-6 ")).toBe("0198526636");
  });

  it("returns null for invalid ISBN and skips network calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchMetadataByISBN("not-an-isbn")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns metadata from Google Books when present", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({
        items: [{
          volumeInfo: {
            title: "Physics",
            authors: ["A. Author"],
            publisher: "CF Press",
            publishedDate: "2024",
            imageLinks: { thumbnail: "https://img.example/cover.jpg" },
          },
        }],
      }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchFromGoogleBooks("9781402894626")).resolves.toEqual({
      title: "Physics",
      authors: ["A. Author"],
      publisher: "CF Press",
      publicationDate: "2024",
      coverImageUrl: "https://img.example/cover.jpg",
    });
  });

  it("returns null for malformed Google Books payload", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ items: [{ volumeInfo: { title: 123 } }] })));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchFromGoogleBooks("9781402894626")).resolves.toBeNull();
  });

  it("falls back to Open Library when Google Books misses", async () => {
    const fetchSpy = vi.fn(async (url: string | URL) => {
      const value = String(url);
      if (value.includes("googleapis")) {
        return new Response(JSON.stringify({ items: [] }));
      }

      return new Response(JSON.stringify({
        title: "Chemistry",
        publishers: ["Open Publisher"],
        publish_date: "2022",
        covers: [12345],
      }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchMetadataByISBN("9781402894626")).resolves.toEqual({
      title: "Chemistry",
      authors: null,
      publisher: "Open Publisher",
      publicationDate: "2022",
      coverImageUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
    });
  });

  it("returns null from Open Library when response is not ok", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchFromOpenLibrary("9781402894626")).resolves.toBeNull();
  });

  it("tries related ISBNs when primary does not resolve", async () => {
    const fetchSpy = vi.fn(async (url: string | URL) => {
      const value = String(url);

      if (value.includes("isbn:9781402894626")) {
        return new Response(JSON.stringify({ items: [] }));
      }

      if (value.includes("isbn:9780131103627")) {
        return new Response(JSON.stringify({
          items: [{ volumeInfo: { title: "C Programming", authors: ["K&R"] } }],
        }));
      }

      return new Response(JSON.stringify({ items: [] }));
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchMetadataByAnyISBN("9781402894626", [
      { isbn: "bad", type: "other" },
      { isbn: "9780131103627", type: "teacher" },
    ])).resolves.toMatchObject({
      matchedIsbn: "9780131103627",
      matchedType: "teacher",
      metadata: { title: "C Programming" },
    });
  });

  it("returns null when fetch throws", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchMetadataByISBN("9781402894626")).resolves.toBeNull();
  });

  it("handles unexpected publisher list types from Open Library", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({
        title: "History",
        publishers: [null, 42, "Valid Publisher", "   "],
        publish_date: "2020",
      }))
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchFromOpenLibrary("9781402894626")).resolves.toEqual({
      title: "History",
      authors: null,
      publisher: "Valid Publisher",
      publicationDate: "2020",
      coverImageUrl: null,
    });
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

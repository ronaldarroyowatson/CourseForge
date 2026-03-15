/**
 * ISBN lookup service with Google Books first, then Open Library fallback.
 */

export interface ISBNMetadata {
  title: string | null;
  authors: string[] | null;
  publisher: string | null;
  publicationDate: string | null;
  coverImageUrl: string | null;
}

/**
 * Normalize ISBN by removing all non-digit characters.
 */
export function normalizeISBN(isbn: string): string {
  return isbn.replace(/\D/g, "");
}

function isValidISBN(isbn: string): boolean {
  return /^\d{10}$|^\d{13}$/.test(isbn);
}

function hasUsefulMetadata(metadata: ISBNMetadata): boolean {
  return Boolean(metadata.title || metadata.authors || metadata.publisher || metadata.publicationDate || metadata.coverImageUrl);
}

function toArrayOfStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const list = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return list.length > 0 ? list : null;
}

/**
 * Fetch ISBN metadata from Google Books.
 * Returns null if no results are available or request fails.
 */
export async function fetchFromGoogleBooks(isbn: string): Promise<ISBNMetadata | null> {
  try {
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      items?: Array<{
        volumeInfo?: {
          title?: string;
          authors?: string[];
          publisher?: string;
          publishedDate?: string;
          imageLinks?: {
            thumbnail?: string;
            smallThumbnail?: string;
          };
        };
      }>;
    };

    const volumeInfo = data.items?.[0]?.volumeInfo;
    if (!volumeInfo) {
      return null;
    }

    const metadata: ISBNMetadata = {
      title: typeof volumeInfo.title === "string" ? volumeInfo.title : null,
      authors: toArrayOfStrings(volumeInfo.authors),
      publisher: typeof volumeInfo.publisher === "string" ? volumeInfo.publisher : null,
      publicationDate: typeof volumeInfo.publishedDate === "string" ? volumeInfo.publishedDate : null,
      coverImageUrl:
        typeof volumeInfo.imageLinks?.thumbnail === "string"
          ? volumeInfo.imageLinks.thumbnail
          : typeof volumeInfo.imageLinks?.smallThumbnail === "string"
            ? volumeInfo.imageLinks.smallThumbnail
            : null,
    };

    return hasUsefulMetadata(metadata) ? metadata : null;
  } catch {
    return null;
  }
}

/**
 * Fetch ISBN metadata from Open Library.
 * Returns null if no results are available or request fails.
 */
export async function fetchFromOpenLibrary(isbn: string): Promise<ISBNMetadata | null> {
  try {
    const response = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      title?: unknown;
      authors?: unknown;
      publishers?: unknown;
      publish_date?: unknown;
      covers?: unknown;
    };

    const publishers = toArrayOfStrings(data.publishers);
    const coverIds = Array.isArray(data.covers)
      ? data.covers.filter((id): id is number => typeof id === "number")
      : [];

    const metadata: ISBNMetadata = {
      title: typeof data.title === "string" ? data.title : null,
      authors: null,
      publisher: publishers ? publishers[0] : null,
      publicationDate: typeof data.publish_date === "string" ? data.publish_date : null,
      coverImageUrl: coverIds.length > 0 ? `https://covers.openlibrary.org/b/id/${coverIds[0]}-M.jpg` : null,
    };

    return hasUsefulMetadata(metadata) ? metadata : null;
  } catch {
    return null;
  }
}

/**
 * Fetch metadata by ISBN using Google Books first, then Open Library fallback.
 * Returns null when no metadata could be resolved from either source.
 */
export async function fetchMetadataByISBN(isbn: string): Promise<ISBNMetadata | null> {
  const normalizedIsbn = normalizeISBN(isbn);
  if (!isValidISBN(normalizedIsbn)) {
    return null;
  }

  const googleMetadata = await fetchFromGoogleBooks(normalizedIsbn);
  if (googleMetadata) {
    return googleMetadata;
  }

  const openLibraryMetadata = await fetchFromOpenLibrary(normalizedIsbn);
  if (openLibraryMetadata) {
    return openLibraryMetadata;
  }

  return null;
}

import type { RelatedIsbn, RelatedIsbnType } from "../models";

/** The result of a multi-ISBN lookup — includes which ISBN matched and its role. */
export interface ISBNMatchResult {
  metadata: ISBNMetadata;
  /** The normalized ISBN that actually matched. */
  matchedIsbn: string;
  /** "primary" when the main isbnNormalized matched; otherwise the relatedIsbn type. */
  matchedType: RelatedIsbnType | "primary";
}

/**
 * Look up metadata for a textbook that might be indexed under one of several related ISBNs.
 * Tries the primary ISBN first, then falls back through each related ISBN in order.
 * Returns the first successful match with the matched ISBN context included.
 */
export async function fetchMetadataByAnyISBN(
  primaryIsbn: string,
  relatedIsbns: RelatedIsbn[] = []
): Promise<ISBNMatchResult | null> {
  const primary = normalizeISBN(primaryIsbn);
  if (primary && isValidISBN(primary)) {
    const metadata = await fetchMetadataByISBN(primary);
    if (metadata) {
      return { metadata, matchedIsbn: primary, matchedType: "primary" };
    }
  }

  for (const related of relatedIsbns) {
    const normalized = normalizeISBN(related.isbn);
    if (!normalized || !isValidISBN(normalized)) continue;
    const metadata = await fetchMetadataByISBN(normalized);
    if (metadata) {
      return { metadata, matchedIsbn: normalized, matchedType: related.type };
    }
  }

  return null;
}

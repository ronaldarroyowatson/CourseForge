/**
 * ISBN lookup service using Open Library API.
 * Fetches textbook metadata by ISBN to prefill form fields.
 */

export interface ISBNMetadata {
  title?: string;
  authors?: string[];
  publisher?: string;
  publishDate?: string;
  coverImageUrl?: string;
}

/**
 * Normalize ISBN by removing hyphens and spaces.
 */
function normalizeISBN(isbn: string): string {
  return isbn.replace(/[-\s]/g, "").trim();
}

/**
 * Validate ISBN-10 or ISBN-13 format.
 */
function isValidISBN(isbn: string): boolean {
  const normalized = normalizeISBN(isbn);
  // Accept 10 or 13 digit ISBNs
  return /^\d{10}$|^\d{13}$/.test(normalized);
}

/**
 * Fetch metadata from Open Library API by ISBN.
 * Returns title, authors, publisher, publish date, and cover image URL.
 *
 * @param isbn - ISBN-10 or ISBN-13
 * @returns ISBNMetadata object with fetched data
 * @throws Error if ISBN is invalid, API fails, or no results found
 */
export async function fetchMetadataByISBN(isbn: string): Promise<ISBNMetadata> {
  const normalized = normalizeISBN(isbn);

  if (!isValidISBN(normalized)) {
    throw new Error("Invalid ISBN format. Please enter a valid ISBN-10 or ISBN-13.");
  }

  try {
    const url = `https://openlibrary.org/isbn/${normalized}.json`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });

    if (response.status === 404) {
      throw new Error("ISBN not found in the Open Library database.");
    }

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;

    const metadata: ISBNMetadata = {};

    // Extract title
    if (typeof data.title === "string") {
      metadata.title = data.title;
    }

    // Extract authors
    if (Array.isArray(data.authors)) {
      metadata.authors = data.authors
        .map((author) => {
          if (typeof author === "object" && author !== null && "name" in author) {
            return (author as Record<string, unknown>).name;
          }
          return author;
        })
        .filter((name) => typeof name === "string") as string[];
    }

    // Extract publisher
    if (Array.isArray(data.publishers)) {
      const publisherArray = data.publishers as unknown[];
      const firstPublisher = publisherArray[0];
      if (typeof firstPublisher === "string") {
        metadata.publisher = firstPublisher;
      }
    }

    // Extract publish date
    if (typeof data.publish_date === "string") {
      metadata.publishDate = data.publish_date;
    }

    // Extract cover image URL
    if (Array.isArray(data.covers)) {
      const coverArray = data.covers as unknown[];
      const firstCoverId = coverArray[0];
      if (typeof firstCoverId === "number") {
        metadata.coverImageUrl = `https://covers.openlibrary.org/b/id/${firstCoverId}-S.jpg`;
      }
    }

    // Ensure we got at least a title
    if (!metadata.title) {
      throw new Error("No textbook metadata found for this ISBN.");
    }

    return metadata;
  } catch (error) {
    if (error instanceof Error) {
      // Re-throw our custom errors as-is
      if (
        error.message.includes("Invalid ISBN") ||
        error.message.includes("ISBN not found") ||
        error.message.includes("No textbook metadata")
      ) {
        throw error;
      }
      // Network or other errors
      throw new Error(`Unable to fetch ISBN metadata: ${error.message}`);
    }
    throw new Error("Unable to fetch ISBN metadata due to an unexpected error.");
  }
}

/**
 * Blob Creation & Upload
 *
 * Creates a single JSON blob from the fully parsed textbook and uploads it to
 * Firebase Cloud Storage at `textbooks/{textbookId}/full.json`.
 */

import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "../../firebase/storage";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ParsedTextbookSection {
  id: string;
  title: string;
  notes?: string;
  vocab?: Array<{ word: string; definition?: string }>;
  equations?: string[];
  concepts?: string[];
  keyIdeas?: string[];
}

export interface ParsedTextbookChapter {
  id: string;
  name: string;
  index: number;
  pageStart?: number;
  pageEnd?: number;
  sections: ParsedTextbookSection[];
}

/**
 * The complete parsed representation of a textbook used as the blob payload.
 * The pipeline that builds this type is responsible for populating all fields
 * it has available; missing optional fields are safely omitted from the JSON.
 */
export interface ParsedTextbook {
  id: string;
  title: string;
  publisher?: string;
  isbn?: string;
  mhid?: string;
  relatedIsbns?: string[];
  relatedMhids?: string[];
  subject?: string;
  gradeLevel?: string;
  edition?: string;
  chapters: ParsedTextbookChapter[];
  /** Base64-encoded cover image, if available. */
  coverImageBase64?: string;
  /** Any raw images attached to sections, keyed by section id. */
  sectionImages?: Record<string, string>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialises the entire parsed textbook to a UTF-8 JSON Blob.
 */
export function createTextbookBlob(textbookData: ParsedTextbook): Blob {
  const json = JSON.stringify(textbookData);
  return new Blob([json], { type: "application/json" });
}

/**
 * Uploads a textbook blob to `textbooks/{textbookId}/full.json` in Firebase
 * Cloud Storage and returns the public download URL.
 *
 * @param blob       The blob produced by `createTextbookBlob`.
 * @param textbookId The unique textbook identifier (used as the storage path segment).
 * @returns          The Firebase Storage download URL.
 */
export async function uploadTextbookBlob(blob: Blob, textbookId: string): Promise<string> {
  const storagePath = `textbooks/${textbookId}/full.json`;
  const storageRef = ref(firebaseStorage, storagePath);

  await uploadBytes(storageRef, blob, {
    contentType: "application/json",
    customMetadata: {
      textbookId,
      uploadedAt: new Date().toISOString(),
    },
  });

  const downloadUrl = await getDownloadURL(storageRef);
  return downloadUrl;
}

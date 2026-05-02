/**
 * Firestore Textbook Metadata Writer
 *
 * Writes a single atomic metadata document to `/textbooks/{textbookId}`.
 * One write per textbook ingestion — no batching.
 */

import { doc, setDoc } from "firebase/firestore";
import { firestoreDb } from "../../firebase/firestore";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * The minimal, indexable metadata set written to Firestore for each textbook.
 * The full content lives in Cloud Storage; only fields needed for search,
 * deduplication, and cross-reference are stored here.
 */
export interface TextbookMetadata {
  /** Firestore document id — also used as the Cloud Storage path segment. */
  textbookId: string;
  title: string;
  publisher?: string;
  /** Primary ISBN (normalised, digits only). */
  isbn?: string;
  /** Primary McGraw-Hill identifier. */
  mhid?: string;
  /** Additional ISBNs (student edition, teacher edition, digital, etc.). */
  relatedIsbns?: string[];
  /** Additional MHIDs related to the same work. */
  relatedMhids?: string[];
  subject?: string;
  gradeLevel?: string;
  edition?: string;
  /** Firebase Storage download URL or path returned by `uploadTextbookBlob`. */
  storagePath: string;
  /** ISO-8601 timestamp set at ingestion time. */
  uploadedAt: string;
  /** UID of the user who triggered the upload. */
  uploadedBy: string;
  /** Set when a newer/stronger version supersedes this document. */
  supersededBy?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Writes (or overwrites) the metadata document for a textbook in a single
 * atomic Firestore `setDoc` call.
 *
 * Firestore path: `/textbooks/{textbookId}`
 */
export async function writeTextbookMetadata(meta: TextbookMetadata): Promise<void> {
  const docRef = doc(firestoreDb, "textbooks", meta.textbookId);

  // Strip undefined fields so Firestore doesn't store explicit nulls.
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  await setDoc(docRef, payload);
}

/**
 * Hybrid Textbook Ingestion Pipeline
 *
 * Orchestrates the full blob-first ingestion flow:
 *  1. Parse → ParsedTextbook  (provided by caller)
 *  2. Extract → TextbookMetadata
 *  3. findDuplicateTextbook()
 *  4. Abort if candidate is the weaker version
 *  5. createTextbookBlob()
 *  6. uploadTextbookBlob()
 *  7. writeTextbookMetadata()
 *  8. Emit UI events and return success
 *
 * Incremental updates after the initial upload use applyIncrementalUpdates().
 * The full blob is never re-uploaded unless `forceReupload` is set.
 */

import { getCurrentUser } from "../../firebase/auth";
import {
  createTextbookBlob,
  uploadTextbookBlob,
  type ParsedTextbook,
} from "../storage/uploadTextbookBlob";
import {
  writeTextbookMetadata,
  type TextbookMetadata,
} from "../firestore/writeTextbookMetadata";
import {
  findDuplicateTextbook,
  type DuplicateResult,
} from "../firestore/findDuplicateTextbook";
import {
  applyIncrementalUpdates,
  type UpdateChunk,
} from "../storage/applyIncrementalUpdates";
import {
  onTextbookUploadStart,
  onTextbookUploadComplete,
  onDuplicateDetected,
  onUploadAborted,
  onIncrementalUpdateApplied,
} from "./textbookIngestionEvents";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface HybridIngestionOptions {
  /** When `true`, re-upload the blob even if one already exists. Default: false. */
  forceReupload?: boolean;
}

export interface HybridIngestionResult {
  textbookId: string;
  storagePath: string;
  /** Present when an older/weaker duplicate was found and superseded. */
  supersededId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a minimal `TextbookMetadata` object from a `ParsedTextbook`.
 * The `storagePath` and `uploadedAt` fields are filled in after the upload.
 */
function buildMetadata(
  parsed: ParsedTextbook,
  storagePath: string,
  uploadedBy: string,
): TextbookMetadata {
  return {
    textbookId: parsed.id,
    title: parsed.title,
    publisher: parsed.publisher,
    isbn: parsed.isbn,
    mhid: parsed.mhid,
    relatedIsbns: parsed.relatedIsbns,
    relatedMhids: parsed.relatedMhids,
    subject: parsed.subject,
    gradeLevel: parsed.gradeLevel,
    edition: parsed.edition,
    storagePath,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the full hybrid ingestion pipeline for a parsed textbook.
 *
 * @throws  An `Error` with a user-visible message when ingestion is aborted
 *          because the candidate is a weaker version of an existing record.
 */
export async function runHybridIngestion(
  parsed: ParsedTextbook,
  options: HybridIngestionOptions = {},
): Promise<HybridIngestionResult> {
  const user = getCurrentUser();
  const uploadedBy = user?.uid ?? "anonymous";

  onTextbookUploadStart({ textbookId: parsed.id });

  // Step 1 — Build a preliminary metadata snapshot (storagePath placeholder).
  const preliminaryMeta: TextbookMetadata = buildMetadata(parsed, "", uploadedBy);

  // Step 2 — Duplicate / weaker-version check.
  let duplicateResult: DuplicateResult | null = null;
  try {
    duplicateResult = await findDuplicateTextbook(preliminaryMeta);
  } catch (err) {
    // Non-fatal: log and continue.  A failed duplicate check must not block
    // ingestion, but we surface it so the operator can investigate.
    console.warn("[runHybridIngestion] Duplicate check failed (proceeding anyway):", err);
  }

  if (duplicateResult !== null) {
    onDuplicateDetected({
      textbookId: parsed.id,
      duplicateId: duplicateResult.duplicateId,
      isWeakerVersion: duplicateResult.isWeakerVersion,
    });

    if (duplicateResult.isWeakerVersion) {
      const msg =
        `Ingestion aborted: a stronger version of this textbook already exists ` +
        `(id=${duplicateResult.duplicateId}).`;
      console.warn("[runHybridIngestion]", msg);
      onUploadAborted({ textbookId: parsed.id, reason: msg });
      throw new Error(msg);
    }
  }

  // Step 3 — Create & upload the blob.
  const blob = createTextbookBlob(parsed);
  let storagePath: string;
  try {
    storagePath = await uploadTextbookBlob(blob, parsed.id);
  } catch (err) {
    const msg = `Blob upload failed for textbook ${parsed.id}: ${String(err)}`;
    console.error("[runHybridIngestion]", msg);
    onUploadAborted({ textbookId: parsed.id, reason: msg });
    throw new Error(msg);
  }

  // Step 4 — Write Firestore metadata (single atomic write).
  const finalMeta = buildMetadata(parsed, storagePath, uploadedBy);
  await writeTextbookMetadata(finalMeta);

  onTextbookUploadComplete({ textbookId: parsed.id, storagePath });

  return {
    textbookId: parsed.id,
    storagePath,
    supersededId: duplicateResult?.isWeakerVersion === false ? duplicateResult.duplicateId : undefined,
  };
}

/**
 * Applies incremental updates to an already-ingested textbook.
 * Delegates entirely to `applyIncrementalUpdates` so blob + primary metadata
 * are never touched.
 */
export async function runIncrementalUpdate(
  textbookId: string,
  updates: UpdateChunk[],
): Promise<void> {
  try {
    await applyIncrementalUpdates(textbookId, updates);
    onIncrementalUpdateApplied({ textbookId, updateCount: updates.length });
  } catch (err) {
    const msg = `Incremental update aborted for textbook ${textbookId}: ${String(err)}`;
    console.error("[runIncrementalUpdate]", msg);
    onUploadAborted({ textbookId, reason: msg });
    throw err;
  }
}

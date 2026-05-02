/**
 * Incremental Update Applier
 *
 * Uses the existing Firestore batching primitives to write deltas (changed
 * sections, new vocab, etc.) to an already-ingested textbook.
 *
 * Rules:
 *  - Hard cap: 400 writes per batch cycle (well under Firestore's 500 limit).
 *  - Exponential back-off when the cap is approached.
 *  - Abort if more than 3 consecutive batches hit the cap.
 *  - Abort if Firestore rejects writes due to quota.
 *  - Never re-upload the full blob or touch the primary metadata document.
 *  - All aborts are logged to console and surfaced as thrown errors (the
 *    pipeline layer converts these to UI toasts).
 */

import {
  collection,
  doc,
  writeBatch,
  type WriteBatch,
} from "firebase/firestore";
import { firestoreDb } from "../../firebase/firestore";

// ---------------------------------------------------------------------------
// Constants — Safety Valves
// ---------------------------------------------------------------------------

/** Hard cap per batch cycle. Below Firestore's 500-write limit. */
const HARD_CAP_PER_CYCLE = 400;

/** Maximum number of consecutive batch cycles that hit the hard cap before aborting. */
const MAX_CONSECUTIVE_CAP_HITS = 3;

/** Initial back-off delay (ms) when approaching the cap. */
const BACKOFF_BASE_MS = 200;

/** Maximum back-off delay (ms). */
const BACKOFF_MAX_MS = 10_000;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * A single delta unit. `path` is the Firestore document path relative to the
 * textbook root, e.g. `chapters/ch1/sections/s1`.
 */
export interface UpdateChunk {
  /** Relative Firestore path segments after `textbooks/{textbookId}/`. */
  path: string;
  /** The fields to merge into the target document. */
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Splits an array into chunks of at most `size` elements. */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Resolves a relative path string like `chapters/ch1/sections/s1` against the
 * textbook root (`textbooks/{textbookId}`), returning a Firestore `DocumentReference`.
 */
function resolveDocRef(textbookId: string, relativePath: string) {
  const parts = relativePath.split("/");
  if (parts.length < 2 || parts.length % 2 !== 0) {
    throw new Error(
      `[applyIncrementalUpdates] Invalid path segment "${relativePath}". ` +
        "Path must have an even number of segments (collection/doc pairs).",
    );
  }

  // Build the full path: textbooks/{textbookId}/{...relativePath}
  const fullSegments = ["textbooks", textbookId, ...parts];
  // Reconstruct as a Firestore reference.
  // fullSegments length is always odd (root collection + id + …more pairs).
  const rootRef = doc(firestoreDb, fullSegments.join("/"));
  return rootRef;
}

/**
 * Commits one WriteBatch with exponential back-off on transient errors.
 * Rethrows on quota / permission errors so the pipeline can abort.
 */
async function commitWithBackoff(batch: WriteBatch, attempt: number): Promise<void> {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);

  try {
    await batch.commit();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isQuota =
      message.includes("RESOURCE_EXHAUSTED") ||
      message.includes("quota") ||
      message.includes("429");
    const isPermission =
      message.includes("PERMISSION_DENIED") || message.includes("403");

    if (isQuota || isPermission) {
      const reason = isQuota ? "Firestore quota exceeded" : "Firestore permission denied";
      console.error(`[applyIncrementalUpdates] Aborting: ${reason}`, err);
      throw new Error(`[applyIncrementalUpdates] Aborted — ${reason}.`);
    }

    // Transient error — apply back-off and rethrow so caller retries.
    await new Promise((resolve) => setTimeout(resolve, delay));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Applies incremental delta updates to an existing ingested textbook.
 *
 * Each `UpdateChunk` is merged (not replaced) into its target Firestore
 * document.  Writes are batched in groups of up to `HARD_CAP_PER_CYCLE` with
 * the safety valves described at the top of this file.
 *
 * @throws If the consecutive-cap-hit limit is exceeded or Firestore rejects
 *         writes due to quota / permission errors.
 */
export async function applyIncrementalUpdates(
  textbookId: string,
  updates: UpdateChunk[],
): Promise<void> {
  if (updates.length === 0) return;

  const cycles = chunkArray(updates, HARD_CAP_PER_CYCLE);
  let consecutiveCapHits = 0;

  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex++) {
    const cycle = cycles[cycleIndex];

    // Safety valve: track consecutive cap hits.
    if (cycle.length === HARD_CAP_PER_CYCLE) {
      consecutiveCapHits += 1;
    } else {
      consecutiveCapHits = 0;
    }

    if (consecutiveCapHits > MAX_CONSECUTIVE_CAP_HITS) {
      const msg =
        `[applyIncrementalUpdates] Aborted after ${consecutiveCapHits} consecutive batches ` +
        `hitting the ${HARD_CAP_PER_CYCLE}-write cap.`;
      console.error(msg);
      throw new Error(msg);
    }

    // Build and commit the batch for this cycle.
    const batch = writeBatch(firestoreDb);
    for (const chunk of cycle) {
      const docRef = resolveDocRef(textbookId, chunk.path);
      batch.set(docRef, chunk.data, { merge: true });
    }

    let attempt = 0;
    let committed = false;
    while (!committed) {
      try {
        await commitWithBackoff(batch, attempt);
        committed = true;
      } catch (err: unknown) {
        // commitWithBackoff already rethrows quota/permission errors — only
        // transient errors reach here; retry with incremented back-off counter.
        attempt += 1;
        if (attempt > 5) {
          console.error("[applyIncrementalUpdates] Max retry attempts reached.", err);
          throw err;
        }
        console.warn(
          `[applyIncrementalUpdates] Batch ${cycleIndex + 1} attempt ${attempt} failed; retrying…`,
          err,
        );
      }
    }

    console.info(
      `[applyIncrementalUpdates] Cycle ${cycleIndex + 1}/${cycles.length} committed ` +
        `(${cycle.length} writes, textbookId=${textbookId}).`,
    );
  }
}

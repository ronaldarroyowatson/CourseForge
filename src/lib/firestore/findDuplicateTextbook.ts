/**
 * Duplicate / Weaker-Version Detection
 *
 * Queries Firestore for existing textbooks that share an ISBN or MHID with the
 * candidate.  When a match is found the function evaluates which record is
 * "stronger" and optionally marks the older one as superseded.
 */

import { collection, doc, getDocs, or, query, updateDoc, where } from "firebase/firestore";
import { firestoreDb } from "../../firebase/firestore";
import type { TextbookMetadata } from "./writeTextbookMetadata";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DuplicateResult {
  /** Firestore document id of the existing (potentially duplicate) textbook. */
  duplicateId: string;
  /**
   * `true`  — the candidate being ingested is weaker than the existing record
   *            (ingestion should be aborted).
   * `false` — the candidate is stronger; the existing record will be marked as
   *            superseded and ingestion can proceed.
   */
  isWeakerVersion: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a numeric "strength" score for a metadata document.
 * More fields filled + blob already uploaded + more recent → higher score.
 */
function scoreMetadata(data: Record<string, unknown>): number {
  let score = 0;

  const fieldWeights: Array<[string, number]> = [
    ["title", 2],
    ["publisher", 1],
    ["isbn", 2],
    ["mhid", 2],
    ["subject", 1],
    ["gradeLevel", 1],
    ["edition", 1],
    ["storagePath", 5], // blob already uploaded
  ];

  for (const [field, weight] of fieldWeights) {
    const val = data[field];
    if (val !== undefined && val !== null && val !== "") {
      score += weight;
    }
  }

  // Recency bonus: newer uploadedAt is stronger.
  const uploadedAt = data["uploadedAt"] as string | undefined;
  if (uploadedAt) {
    const ms = new Date(uploadedAt).getTime();
    if (!Number.isNaN(ms)) {
      // Normalise to a small bonus (1 point per day since epoch, capped at 30).
      const daysSinceEpoch = ms / 86_400_000;
      score += Math.min(daysSinceEpoch / 1_000, 30);
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Searches Firestore for any textbook whose primary or related ISBN / MHID
 * overlaps with `meta`.
 *
 * Returns `null` when no duplicate is found.
 * Returns a `DuplicateResult` when a match exists, along with a strength
 * comparison so the pipeline can decide whether to abort or proceed.
 *
 * Side-effect: when the candidate is stronger, the weaker existing record is
 * updated with `supersededBy: meta.textbookId`.
 */
export async function findDuplicateTextbook(meta: TextbookMetadata): Promise<DuplicateResult | null> {
  const textbooksRef = collection(firestoreDb, "textbooks");

  // Build an array of OR clauses for every available identifier.
  const clauses: ReturnType<typeof where>[] = [];

  if (meta.isbn) {
    clauses.push(where("isbn", "==", meta.isbn));
    clauses.push(where("relatedIsbns", "array-contains", meta.isbn));
  }

  if (meta.mhid) {
    clauses.push(where("mhid", "==", meta.mhid));
    clauses.push(where("relatedMhids", "array-contains", meta.mhid));
  }

  if (clauses.length === 0) {
    // No identifiers to match against — skip duplicate check.
    return null;
  }

  const q = query(textbooksRef, or(...clauses));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    return null;
  }

  // Collect all matching documents, excluding the candidate itself.
  const matches = snapshot.docs
    .filter((d) => d.id !== meta.textbookId)
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));

  if (matches.length === 0) {
    return null;
  }

  // Pick the "strongest" existing record among all matches.
  let best = matches[0];
  for (const m of matches.slice(1)) {
    if (scoreMetadata(m.data) > scoreMetadata(best.data)) {
      best = m;
    }
  }

  const existingScore = scoreMetadata(best.data);
  const candidateScore = scoreMetadata(meta as unknown as Record<string, unknown>);

  if (candidateScore <= existingScore) {
    // Existing record is at least as strong — candidate is the weaker version.
    return { duplicateId: best.id, isWeakerVersion: true };
  }

  // Candidate is stronger — mark the existing record as superseded.
  try {
    await updateDoc(doc(firestoreDb, "textbooks", best.id), {
      supersededBy: meta.textbookId,
    });
  } catch (err) {
    // Non-fatal: log and continue so the ingestion itself is not blocked.
    console.warn("[findDuplicateTextbook] Failed to mark superseded record:", err);
  }

  return { duplicateId: best.id, isWeakerVersion: false };
}

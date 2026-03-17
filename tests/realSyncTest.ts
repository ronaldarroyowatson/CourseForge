/**
 * Real sync integration test against existing textbook data.
 *
 * Run options:
 * 1) ts-node tests/realSyncTest.ts
 * 2) npm run test:real-sync
 *
 * Notes:
 * - This test reads an existing textbook from local IndexedDB and compares it with Firebase and Azure.
 * - It only adds/removes a temporary `_syncTestTimestamp` field.
 * - If IndexedDB is unavailable in your runtime (for example plain Node without browser APIs),
 *   the script will stop with a clear error.
 */

import "fake-indexeddb/auto";

import { doc, getDoc } from "firebase/firestore";

import * as firebaseSyncService from "../src/core/services/syncService";
import { deleteTextbook, getTextbookById, listTextbooks, saveTextbook } from "../src/core/services/repositories/textbookRepository";
import { firestoreDb } from "../src/firebase/firestore";
import * as azureSyncService from "../src/services/azureSyncService";
import * as syncService from "../src/services/syncService";

type AnyRecord = Record<string, unknown>;

interface SourceSnapshot {
  local: AnyRecord | null;
  firebase: AnyRecord | null;
  azure: AnyRecord | null;
}

interface SelectionResult {
  textbookId: string;
  textbook: AnyRecord;
  seeded: boolean;
}

function assertIndexedDbRuntime(): void {
  const hasIndexedDb = typeof indexedDB !== "undefined";
  if (!hasIndexedDb) {
    throw new Error(
      "IndexedDB is not available in this runtime. Run this script where your real CourseForge local IndexedDB exists."
    );
  }
}

function toTimestamp(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function getBestTimestamp(record: AnyRecord | null): number {
  if (!record) {
    return 0;
  }

  return (
    toTimestamp(record.updatedAt) ||
    toTimestamp(record.lastModified) ||
    toTimestamp(record.modifiedAt) ||
    toTimestamp(record.createdAt) ||
    0
  );
}

function detectNewest(snapshot: SourceSnapshot): string {
  const candidates: Array<{ source: "local" | "firebase" | "azure"; timestamp: number }> = [
    { source: "local", timestamp: getBestTimestamp(snapshot.local) },
    { source: "firebase", timestamp: getBestTimestamp(snapshot.firebase) },
    { source: "azure", timestamp: getBestTimestamp(snapshot.azure) },
  ];

  const newest = candidates.sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!newest || newest.timestamp === 0) {
    return "unknown";
  }

  return `${newest.source} (${new Date(newest.timestamp).toISOString()})`;
}

function redactForComparison(value: AnyRecord | null): AnyRecord | null {
  if (!value) {
    return null;
  }

  const clone: AnyRecord = JSON.parse(JSON.stringify(value)) as AnyRecord;
  delete clone.pendingSync;
  delete clone.source;
  return clone;
}

function areSameRecord(a: AnyRecord | null, b: AnyRecord | null): boolean {
  return JSON.stringify(redactForComparison(a)) === JSON.stringify(redactForComparison(b));
}

async function readFirebaseTextbook(id: string): Promise<AnyRecord | null> {
  const snapshot = await getDoc(doc(firestoreDb, "textbooks", id));
  return snapshot.exists() ? (snapshot.data() as AnyRecord) : null;
}

async function readAzureTextbook(id: string): Promise<AnyRecord | null> {
  const value = await azureSyncService.readFromAzure("textbooks", id);
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as AnyRecord;
}

async function readAllSources(id: string): Promise<SourceSnapshot> {
  const [localRaw, firebase, azure] = await Promise.all([
    getTextbookById(id),
    readFirebaseTextbook(id),
    readAzureTextbook(id),
  ]);

  const local = localRaw ? (localRaw as unknown as AnyRecord) : null;
  return { local, firebase, azure };
}

function printComparison(title: string, snapshot: SourceSnapshot): void {
  console.log(`\n=== ${title} ===`);

  const localExists = snapshot.local !== null;
  const firebaseExists = snapshot.firebase !== null;
  const azureExists = snapshot.azure !== null;

  console.log("Local version:", localExists ? getBestTimestamp(snapshot.local) : "MISSING");
  console.log("Firebase version:", firebaseExists ? getBestTimestamp(snapshot.firebase) : "MISSING");
  console.log("Azure version:", azureExists ? getBestTimestamp(snapshot.azure) : "MISSING");
  console.log("Newest source:", detectNewest(snapshot));

  const missing = [
    !localExists ? "local" : null,
    !firebaseExists ? "firebase" : null,
    !azureExists ? "azure" : null,
  ].filter((entry): entry is string => entry !== null);

  console.log("Missing sources:", missing.length ? missing.join(", ") : "none");

  if (snapshot.local && snapshot.firebase) {
    console.log("Local vs Firebase match:", areSameRecord(snapshot.local, snapshot.firebase));
  }
  if (snapshot.local && snapshot.azure) {
    console.log("Local vs Azure match:", areSameRecord(snapshot.local, snapshot.azure));
  }
  if (snapshot.firebase && snapshot.azure) {
    console.log("Firebase vs Azure match:", areSameRecord(snapshot.firebase, snapshot.azure));
  }
}

function ensureRecord(record: AnyRecord | null, sourceName: string): AnyRecord {
  if (!record) {
    throw new Error(`${sourceName} record is missing.`);
  }

  return record;
}

function createSeedTextbook(): AnyRecord {
  const timestamp = new Date().toISOString();
  const uniqueSuffix = Date.now().toString();

  return {
    id: `real-sync-${uniqueSuffix}`,
    sourceType: "manual",
    userId: `real-sync-user-${uniqueSuffix}`,
    originalLanguage: "en",
    title: "Real Sync Verification Textbook",
    grade: "10",
    subject: "Science",
    edition: "1",
    publicationYear: 2026,
    isbnRaw: `979${uniqueSuffix.slice(-10).padStart(10, "0")}`,
    isbnNormalized: `979${uniqueSuffix.slice(-10).padStart(10, "0")}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastModified: timestamp,
    pendingSync: true,
    source: "local",
    isFavorite: false,
    isArchived: false,
  };
}

async function selectOrSeedLocalTextbook(): Promise<SelectionResult> {
  const textbooks = await listTextbooks();

  if (textbooks.length > 0) {
    const localTextbook = textbooks[0] as unknown as AnyRecord;
    const textbookId = String(localTextbook.id ?? "").trim();
    if (!textbookId) {
      throw new Error("Selected local textbook has no valid id.");
    }

    return {
      textbookId,
      textbook: localTextbook,
      seeded: false,
    };
  }

  const seededTextbook = createSeedTextbook();
  await saveTextbook(seededTextbook as never);

  return {
    textbookId: String(seededTextbook.id),
    textbook: seededTextbook,
    seeded: true,
  };
}

async function main(): Promise<void> {
  assertIndexedDbRuntime();

  console.log("Step 1: Reading first existing textbook from local IndexedDB...");
  const selection = await selectOrSeedLocalTextbook();
  const localTextbook = selection.textbook;
  const id = selection.textbookId;

  if (selection.seeded) {
    console.log("No existing local textbook found; seeded a temporary textbook for sync verification.");
  }

  const isbn = String(localTextbook.isbnRaw ?? "");
  console.log("Selected textbook id:", id);
  console.log("Selected textbook isbnRaw:", isbn || "(empty)");

  if (typeof localTextbook.userId === "string" && localTextbook.userId.trim().length > 0 && isbn.trim().length > 0) {
    const cloudByIsbn = await firebaseSyncService.findCloudTextbookByISBN(localTextbook.userId, isbn);
    console.log(
      "Firebase helper findCloudTextbookByISBN result:",
      cloudByIsbn ? `found id ${cloudByIsbn.id}` : "not found"
    );
  } else {
    console.log("Firebase helper findCloudTextbookByISBN skipped (missing userId or isbnRaw).");
  }

  console.log("Step 2: Fetching textbook from Firebase and Azure...");
  const before = await readAllSources(id);

  if (!before.firebase) {
    console.log("Firebase is missing this textbook.");
  }
  if (!before.azure) {
    console.log("Azure is missing this textbook.");
  }

  printComparison("Initial comparison", before);

  console.log("Step 3: Running reconciliation via syncService.reconcile('textbooks', id)...");
  const reconciliation = await syncService.reconcile("textbooks", id);
  console.log("Reconciliation result:", reconciliation);

  const afterReconcile = await readAllSources(id);
  printComparison("After reconciliation", afterReconcile);

  const reconcileMatched =
    areSameRecord(afterReconcile.local, afterReconcile.firebase) &&
    areSameRecord(afterReconcile.local, afterReconcile.azure) &&
    areSameRecord(afterReconcile.firebase, afterReconcile.azure);

  console.log("Reconciliation all-sources-match:", reconcileMatched);

  console.log("Step 4: Running dual-write test with temporary _syncTestTimestamp field...");
  const originalLocal = ensureRecord(afterReconcile.local, "Local");
  const originalWithoutTemp = { ...originalLocal };
  delete (originalWithoutTemp as AnyRecord)._syncTestTimestamp;

  const syncTestStamp = new Date().toISOString();
  const modifiedLocal = {
    ...originalWithoutTemp,
    _syncTestTimestamp: syncTestStamp,
    updatedAt: syncTestStamp,
    lastModified: syncTestStamp,
    pendingSync: true,
  } as AnyRecord;

  await saveTextbook(modifiedLocal as never);
  await syncService.syncWrite("textbooks", id, modifiedLocal);

  const afterDualWrite = await readAllSources(id);
  printComparison("After dual-write", afterDualWrite);

  const localHasTemp = afterDualWrite.local?._syncTestTimestamp === syncTestStamp;
  const firebaseHasTemp = afterDualWrite.firebase?._syncTestTimestamp === syncTestStamp;
  const azureHasTemp = afterDualWrite.azure?._syncTestTimestamp === syncTestStamp;

  console.log("Dual-write verification:");
  console.log("  Local updated:", localHasTemp);
  console.log("  Firebase updated:", firebaseHasTemp);
  console.log("  Azure updated:", azureHasTemp);

  console.log("Step 5: Cleanup temporary _syncTestTimestamp field...");
  await saveTextbook(originalWithoutTemp as never);
  await syncService.syncWrite("textbooks", id, originalWithoutTemp);

  const afterCleanup = await readAllSources(id);
  printComparison("After cleanup", afterCleanup);

  const cleanupOk =
    !Object.prototype.hasOwnProperty.call(afterCleanup.local ?? {}, "_syncTestTimestamp") &&
    !Object.prototype.hasOwnProperty.call(afterCleanup.firebase ?? {}, "_syncTestTimestamp") &&
    !Object.prototype.hasOwnProperty.call(afterCleanup.azure ?? {}, "_syncTestTimestamp");

  console.log("Cleanup removed _syncTestTimestamp everywhere:", cleanupOk);

  if (!localHasTemp || !firebaseHasTemp || !azureHasTemp) {
    throw new Error("Dual-write verification failed: one or more sources did not receive _syncTestTimestamp.");
  }

  if (!cleanupOk) {
    throw new Error("Cleanup failed: _syncTestTimestamp still exists in at least one source.");
  }

  if (selection.seeded) {
    await deleteTextbook(id);
    console.log("Removed the temporary seeded local textbook.");
  }

  console.log("\nReal sync test completed successfully.");
}

main().catch((error) => {
  console.error("Real sync test failed:", error);
  process.exitCode = 1;
});

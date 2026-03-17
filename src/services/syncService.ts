import { doc, getDoc, setDoc } from "firebase/firestore";

import { firestoreDb } from "../firebase/firestore";
import { readFromAzure, writeToAzure } from "./azureSyncService";

const PENDING_QUEUE_KEY = "courseforge:pendingDualWriteQueue";
const RETRY_INTERVAL_MS = 30_000;

interface PendingWrite {
  collection: string;
  id: string;
  data: unknown;
  attempts: number;
  createdAt: string;
  lastError: string | null;
}

interface ReconciliationResult {
  collection: string;
  id: string;
  status:
    | "already-in-sync"
    | "updated-azure-from-firebase"
    | "updated-firebase-from-azure"
    | "source-missing"
    | "failed";
  detail: string;
}

let memoryQueue: PendingWrite[] = [];
let retryTimer: ReturnType<typeof setInterval> | null = null;
let flushInProgress = false;

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
}

function readQueue(): PendingWrite[] {
  const localStorageRef = getLocalStorage();
  if (!localStorageRef) {
    return [...memoryQueue];
  }

  const raw = localStorageRef.getItem(PENDING_QUEUE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as PendingWrite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingWrite[]): void {
  const localStorageRef = getLocalStorage();
  if (!localStorageRef) {
    memoryQueue = [...queue];
    return;
  }

  localStorageRef.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
}

function upsertPendingWrite(entry: PendingWrite): void {
  const queue = readQueue();
  const existingIndex = queue.findIndex((item) => item.collection === entry.collection && item.id === entry.id);

  if (existingIndex >= 0) {
    queue[existingIndex] = {
      ...queue[existingIndex],
      ...entry,
      attempts: queue[existingIndex].attempts + 1,
    };
  } else {
    queue.push(entry);
  }

  writeQueue(queue);
}

function removePendingWrite(collection: string, id: string): void {
  const filtered = readQueue().filter((item) => !(item.collection === collection && item.id === id));
  writeQueue(filtered);
}

function normalizeRecord(data: unknown, id: string): Record<string, unknown> {
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const record = { ...(data as Record<string, unknown>) };

    if (!record.updatedAt) {
      record.updatedAt = new Date().toISOString();
    }

    if (!record.id) {
      record.id = id;
    }

    return record;
  }

  return {
    id,
    value: data,
    updatedAt: new Date().toISOString(),
  };
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

function extractUpdatedAt(value: unknown): number {
  if (typeof value !== "object" || value === null) {
    return 0;
  }

  const obj = value as Record<string, unknown>;
  return (
    toTimestamp(obj.updatedAt) ||
    toTimestamp(obj.lastModified) ||
    toTimestamp(obj.modifiedAt) ||
    toTimestamp(obj.timestamp) ||
    0
  );
}

async function writeToFirebase(collection: string, id: string, data: unknown): Promise<void> {
  const record = normalizeRecord(data, id);
  await setDoc(doc(firestoreDb, collection, id), record, { merge: true });
}

async function readFromFirebase(collection: string, id: string): Promise<Record<string, unknown> | null> {
  const snapshot = await getDoc(doc(firestoreDb, collection, id));
  if (!snapshot.exists()) {
    return null;
  }

  return snapshot.data() as Record<string, unknown>;
}

async function performDualWrite(collection: string, id: string, data: unknown): Promise<void> {
  await writeToFirebase(collection, id, data);
  await writeToAzure(collection, id, data);
}

export async function syncWrite(collection: string, id: string, data: unknown): Promise<void> {
  try {
    await performDualWrite(collection, id, data);
    removePendingWrite(collection, id);
    console.info(`[dual-sync] write succeeded for ${collection}/${id}`);
  } catch (error) {
    console.error(`[dual-sync] write failed for ${collection}/${id}; queueing retry`, error);
    upsertPendingWrite({
      collection,
      id,
      data,
      attempts: 1,
      createdAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function flushPendingWrites(): Promise<number> {
  if (flushInProgress) {
    return 0;
  }

  flushInProgress = true;
  try {
    const queue = readQueue();
    if (!queue.length) {
      return 0;
    }

    let successCount = 0;

    for (const entry of queue) {
      try {
        await performDualWrite(entry.collection, entry.id, entry.data);
        removePendingWrite(entry.collection, entry.id);
        successCount += 1;
        console.info(`[dual-sync] retry succeeded for ${entry.collection}/${entry.id}`);
      } catch (error) {
        upsertPendingWrite({
          ...entry,
          attempts: entry.attempts + 1,
          lastError: error instanceof Error ? error.message : String(error),
        });
        console.warn(`[dual-sync] retry failed for ${entry.collection}/${entry.id}`, error);
      }
    }

    return successCount;
  } finally {
    flushInProgress = false;
  }
}

export function startRetryLoop(): void {
  if (retryTimer) {
    return;
  }

  retryTimer = setInterval(() => {
    void flushPendingWrites();
  }, RETRY_INTERVAL_MS);
}

export function stopRetryLoop(): void {
  if (!retryTimer) {
    return;
  }

  clearInterval(retryTimer);
  retryTimer = null;
}

export async function reconcile(collection: string, id: string): Promise<ReconciliationResult> {
  try {
    const [firebaseDoc, azureDoc] = await Promise.all([
      readFromFirebase(collection, id),
      readFromAzure(collection, id),
    ]);

    if (!firebaseDoc && !azureDoc) {
      const result: ReconciliationResult = {
        collection,
        id,
        status: "source-missing",
        detail: "Record is missing in both Firebase and Azure.",
      };
      console.info(`[dual-sync] reconcile result for ${collection}/${id}: ${result.status}`);
      return result;
    }

    if (firebaseDoc && !azureDoc) {
      await writeToAzure(collection, id, firebaseDoc);
      const result: ReconciliationResult = {
        collection,
        id,
        status: "updated-azure-from-firebase",
        detail: "Azure record was missing and has been restored from Firebase.",
      };
      console.info(`[dual-sync] reconcile result for ${collection}/${id}: ${result.status}`);
      return result;
    }

    if (!firebaseDoc && azureDoc) {
      await writeToFirebase(collection, id, azureDoc);
      const result: ReconciliationResult = {
        collection,
        id,
        status: "updated-firebase-from-azure",
        detail: "Firebase record was missing and has been restored from Azure.",
      };
      console.info(`[dual-sync] reconcile result for ${collection}/${id}: ${result.status}`);
      return result;
    }

    const firebaseTimestamp = extractUpdatedAt(firebaseDoc);
    const azureTimestamp = extractUpdatedAt(azureDoc);

    if (firebaseTimestamp > azureTimestamp) {
      await writeToAzure(collection, id, firebaseDoc);
      const result: ReconciliationResult = {
        collection,
        id,
        status: "updated-azure-from-firebase",
        detail: "Azure record was outdated and has been refreshed from Firebase.",
      };
      console.info(`[dual-sync] reconcile result for ${collection}/${id}: ${result.status}`);
      return result;
    }

    if (azureTimestamp > firebaseTimestamp) {
      await writeToFirebase(collection, id, azureDoc);
      const result: ReconciliationResult = {
        collection,
        id,
        status: "updated-firebase-from-azure",
        detail: "Firebase record was outdated and has been refreshed from Azure.",
      };
      console.info(`[dual-sync] reconcile result for ${collection}/${id}: ${result.status}`);
      return result;
    }

    const result: ReconciliationResult = {
      collection,
      id,
      status: "already-in-sync",
      detail: "Firebase and Azure records are already in sync.",
    };
    console.info(`[dual-sync] reconcile result for ${collection}/${id}: ${result.status}`);
    return result;
  } catch (error) {
    console.error(`[dual-sync] reconcile failed for ${collection}/${id}`, error);
    return {
      collection,
      id,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getPendingWriteCount(): number {
  return readQueue().length;
}

if (typeof window !== "undefined") {
  startRetryLoop();
}

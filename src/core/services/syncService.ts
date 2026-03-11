import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";

import type { CourseForgeEntityMap } from "../models";
import { getAll, save, STORE_NAMES } from "./db";
import { normalizeISBN } from "./isbnService";
import { firestoreDb } from "../../firebase/firestore";
import { getAdminClaim, getCurrentUser } from "../../firebase/auth";
import { useUIStore } from "../../webapp/store/uiStore";

type SyncStoreName = "textbooks" | "chapters" | "sections" | "vocabTerms";
type SyncEntity = CourseForgeEntityMap[SyncStoreName];

const SYNC_STORES: SyncStoreName[] = [
  STORE_NAMES.textbooks,
  STORE_NAMES.chapters,
  STORE_NAMES.sections,
  STORE_NAMES.vocabTerms,
];

const WRITE_LOOP_WINDOW_MS = 500;
const SYNC_THROTTLE_MS = 5000;

const recentWrites = new Map<string, number>();
let lastSyncAttemptAt = 0;
let writeLoopTriggered = false;
let syncContext: { uid: string | null; isAdmin: boolean | null } = { uid: null, isAdmin: null };

interface SyncErrorLike {
  code?: string;
  message?: string;
}

function getErrorCode(error: unknown): string {
  return (error as SyncErrorLike)?.code ?? "unknown";
}

export function logSyncEvent(type: string, path: string, payload: unknown, error?: unknown): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const base = {
    type,
    path,
    payload,
    uid: syncContext.uid,
    isAdmin: syncContext.isAdmin,
    timestamp: new Date().toISOString(),
  };

  if (!error) {
    console.info("[CourseForge sync]", base);
    useUIStore.getState().addSyncDebugEvent(`${type} @ ${path}`);
    return;
  }

  console.error("[CourseForge sync]", {
    ...base,
    errorCode: getErrorCode(error),
    error,
  });
  useUIStore.getState().addSyncDebugEvent(`${type} @ ${path} (${getErrorCode(error)})`);
}

function shouldSkipWriteForLoop(path: string): boolean {
  const now = Date.now();
  const previous = recentWrites.get(path);

  if (previous && now - previous < WRITE_LOOP_WINDOW_MS) {
    writeLoopTriggered = true;
    logSyncEvent("write:loop-protected", path, {
      previousTimestamp: previous,
      currentTimestamp: now,
      windowMs: WRITE_LOOP_WINDOW_MS,
    });
    return true;
  }

  recentWrites.set(path, now);
  return false;
}

export function consumeWriteLoopTriggered(): boolean {
  const wasTriggered = writeLoopTriggered;
  writeLoopTriggered = false;
  return wasTriggered;
}

export async function getPendingSyncDiagnostics(): Promise<{ pendingCount: number; byStore: Record<SyncStoreName, number> }> {
  const byStoreEntries = await Promise.all(
    SYNC_STORES.map(async (storeName) => {
      const localRows = await fetchLocalStore(storeName);
      const count = localRows.filter((row) => row.pendingSync).length;
      return [storeName, count] as const;
    })
  );

  const byStore = Object.fromEntries(byStoreEntries) as Record<SyncStoreName, number>;
  const pendingCount = Object.values(byStore).reduce((sum, value) => sum + value, 0);

  return { pendingCount, byStore };
}

async function logSyncIdentity(userId: string): Promise<void> {
  if (!import.meta.env.DEV) {
    return;
  }

  const isAdmin = await getAdminClaim();
  syncContext = { uid: userId, isAdmin };
  logSyncEvent("identity", `users/${userId}`, {
    uid: userId,
    isAdmin,
  });
}

function getSyncErrorMessage(error: unknown): string {
  const err = error as SyncErrorLike;
  const code = err.code ?? "";

  if (code === "permission-denied") {
    return "Signed in successfully, but cloud sync is blocked by Firestore rules (permission denied). Local data remains available.";
  }

  if (code === "unauthenticated") {
    return "Signed in successfully, but cloud sync could not verify your session yet. Please retry sync in a moment.";
  }

  if (code === "unavailable") {
    return "Signed in successfully, but cloud sync is temporarily unavailable. Local data remains available.";
  }

  if (typeof err.message === "string" && err.message.trim().length > 0) {
    return `Signed in successfully, but cloud sync failed: ${err.message}`;
  }

  return "Signed in successfully, but cloud sync failed. Your local data is still safe, and you can retry shortly.";
}

function isPermissionDenied(error: unknown): boolean {
  return getErrorCode(error) === "permission-denied";
}

function isNetworkFailure(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === "unavailable" || code === "network-request-failed";
}

function toTimestamp(value?: string): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function withSyncDefaults<T extends SyncEntity>(
  item: T,
  source: "local" | "cloud",
  fallbackPendingSync: boolean
): T {
  const fallbackTimestamp = "updatedAt" in item && typeof item.updatedAt === "string"
    ? item.updatedAt
    : toIsoNow();

  return {
    ...item,
    lastModified: item.lastModified ?? fallbackTimestamp,
    pendingSync: item.pendingSync ?? fallbackPendingSync,
    source: item.source ?? source,
  };
}

function userCollection(storeName: SyncStoreName, userId: string) {
  return collection(firestoreDb, "users", userId, storeName);
}

async function fetchCloudStore<T extends SyncStoreName>(
  storeName: T,
  userId: string
): Promise<Array<CourseForgeEntityMap[T]>> {
  const path = `users/${userId}/${storeName}`;
  logSyncEvent("read:start", path, { userId, storeName });
  const snapshot = await getDocs(userCollection(storeName, userId));
  logSyncEvent("read:success", path, { docs: snapshot.size });

  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data() as CourseForgeEntityMap[T];
    const withId = { ...data, id: docSnapshot.id, userId } as CourseForgeEntityMap[T];
    return withSyncDefaults(withId, "cloud", false) as CourseForgeEntityMap[T];
  });
}

async function fetchLocalStore<T extends SyncStoreName>(
  storeName: T
): Promise<Array<CourseForgeEntityMap[T]>> {
  const rows = await getAll(storeName);
  return rows.map((row) => withSyncDefaults(row, "local", true) as CourseForgeEntityMap[T]);
}

async function saveLocalStoreItem<T extends SyncStoreName>(
  storeName: T,
  item: CourseForgeEntityMap[T]
): Promise<void> {
  await save(storeName, item);
}

async function saveCloudStoreItem<T extends SyncStoreName>(
  storeName: T,
  userId: string,
  item: CourseForgeEntityMap[T]
): Promise<boolean> {
  const path = `users/${userId}/${storeName}/${item.id}`;
  const cloudRecord = {
    ...item,
    userId,
    pendingSync: false,
    source: "cloud",
    lastModified: item.lastModified ?? toIsoNow(),
  };

  if (shouldSkipWriteForLoop(path)) {
    return false;
  }

  logSyncEvent("write:start", path, cloudRecord);
  try {
    await setDoc(doc(firestoreDb, "users", userId, storeName, item.id), cloudRecord, { merge: true });
    logSyncEvent("write:success", path, { id: item.id });
    return true;
  } catch (error) {
    logSyncEvent("write:error", path, cloudRecord, error);
    throw error;
  }
}

export async function uploadLocalChanges(userId: string): Promise<void> {
  if (!userId.trim()) {
    throw new Error("Sync could not start because no user is signed in.");
  }

  try {
    await logSyncIdentity(userId);
    await Promise.all(
      SYNC_STORES.map(async (storeName) => {
        const localItems = await fetchLocalStore(storeName);
        const changedItems = localItems.filter((item) => {
          return item.pendingSync || !item.userId || item.userId === userId;
        });

        await Promise.all(
          changedItems.map(async (item) => {
            const synced = {
              ...item,
              userId,
              pendingSync: false,
              source: "cloud" as const,
              lastModified: item.lastModified ?? toIsoNow(),
            } as CourseForgeEntityMap[typeof storeName];

            const wroteToCloud = await saveCloudStoreItem(storeName, userId, synced);
            if (wroteToCloud) {
              await saveLocalStoreItem(storeName, synced);
            }
          })
        );
      })
    );
  } catch (error) {
    logSyncEvent("upload:error", `users/${userId}`, { userId }, error);
    console.error("uploadLocalChanges failed", error);
    throw new Error(getSyncErrorMessage(error));
  }
}

export async function downloadCloudData(userId: string): Promise<void> {
  if (!userId.trim()) {
    throw new Error("Cloud download could not start because no user is signed in.");
  }

  try {
    await logSyncIdentity(userId);
    await Promise.all(
      SYNC_STORES.map(async (storeName) => {
        const cloudItems = await fetchCloudStore(storeName, userId);

        await Promise.all(
          cloudItems.map(async (item) => {
            const normalized = withSyncDefaults(
              {
                ...item,
                userId,
                pendingSync: false,
                source: "cloud",
              } as CourseForgeEntityMap[typeof storeName],
              "cloud",
              false
            ) as CourseForgeEntityMap[typeof storeName];

            await saveLocalStoreItem(storeName, normalized);
          })
        );
      })
    );
  } catch (error) {
    logSyncEvent("download:error", `users/${userId}`, { userId }, error);
    console.error("downloadCloudData failed", error);
    throw new Error(getSyncErrorMessage(error));
  }
}

export async function syncUserData(userId: string): Promise<void> {
  if (!userId.trim()) {
    throw new Error("Sync could not start because no user is signed in.");
  }

  try {
    await logSyncIdentity(userId);
    const before = await getPendingSyncDiagnostics();
    logSyncEvent("sync:start", `users/${userId}`, { userId, pendingBefore: before.pendingCount });

    await Promise.all(
      SYNC_STORES.map(async (storeName) => {
        const [localRows, cloudRows] = await Promise.all([
          fetchLocalStore(storeName),
          fetchCloudStore(storeName, userId),
        ]);

        const localById = new Map(localRows.map((item) => [item.id, item]));
        const cloudById = new Map(cloudRows.map((item) => [item.id, item]));
        const allIds = new Set([...localById.keys(), ...cloudById.keys()]);

        await Promise.all(
          [...allIds].map(async (id) => {
            const localItem = localById.get(id);
            const cloudItem = cloudById.get(id);

            if (localItem && cloudItem) {
              const localTs = toTimestamp(localItem.lastModified);
              const cloudTs = toTimestamp(cloudItem.lastModified);

              if (cloudTs > localTs) {
                const cloudWinner = withSyncDefaults(
                  {
                    ...cloudItem,
                    userId,
                    pendingSync: false,
                    source: "cloud",
                  } as CourseForgeEntityMap[typeof storeName],
                  "cloud",
                  false
                ) as CourseForgeEntityMap[typeof storeName];

                await saveLocalStoreItem(storeName, cloudWinner);
                return;
              }

              const localWinner = withSyncDefaults(
                {
                  ...localItem,
                  userId,
                  pendingSync: false,
                  source: "cloud",
                } as CourseForgeEntityMap[typeof storeName],
                "cloud",
                false
              ) as CourseForgeEntityMap[typeof storeName];

              const wroteToCloud = await saveCloudStoreItem(storeName, userId, localWinner);
              if (wroteToCloud) {
                await saveLocalStoreItem(storeName, localWinner);
              }
              return;
            }

            if (localItem) {
              const localOnly = withSyncDefaults(
                {
                  ...localItem,
                  userId,
                  pendingSync: false,
                  source: "cloud",
                } as CourseForgeEntityMap[typeof storeName],
                "cloud",
                false
              ) as CourseForgeEntityMap[typeof storeName];

              const wroteToCloud = await saveCloudStoreItem(storeName, userId, localOnly);
              if (wroteToCloud) {
                await saveLocalStoreItem(storeName, localOnly);
              }
              return;
            }

            if (cloudItem) {
              const cloudOnly = withSyncDefaults(
                {
                  ...cloudItem,
                  userId,
                  pendingSync: false,
                  source: "cloud",
                } as CourseForgeEntityMap[typeof storeName],
                "cloud",
                false
              ) as CourseForgeEntityMap[typeof storeName];

              await saveLocalStoreItem(storeName, cloudOnly);
            }
          })
        );
      })
    );

    const after = await getPendingSyncDiagnostics();
    logSyncEvent("sync:success", `users/${userId}`, { userId, pendingAfter: after.pendingCount, byStore: after.byStore });
  } catch (error) {
    logSyncEvent("sync:error", `users/${userId}`, { userId, code: getErrorCode(error) }, error);
    console.error("syncUserData failed", error);
    throw new Error(getSyncErrorMessage(error));
  }
}

export async function syncNow(): Promise<{
  success: boolean;
  message: string;
  retryable: boolean;
  permissionDenied: boolean;
  throttled: boolean;
  writeLoopTriggered: boolean;
  pendingCount: number;
}> {
  const now = Date.now();
  if (now - lastSyncAttemptAt < SYNC_THROTTLE_MS) {
    const pending = await getPendingSyncDiagnostics();
    return {
      success: false,
      message: "Sync skipped to avoid excessive write frequency.",
      retryable: false,
      permissionDenied: false,
      throttled: true,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      pendingCount: pending.pendingCount,
    };
  }

  lastSyncAttemptAt = now;
  const user = getCurrentUser();

  if (!user?.uid) {
    const pending = await getPendingSyncDiagnostics();
    return {
      success: false,
      message: "Sign in to sync your local data with the cloud.",
      retryable: false,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      pendingCount: pending.pendingCount,
    };
  }

  try {
    await syncUserData(user.uid);
    const pending = await getPendingSyncDiagnostics();
    return {
      success: true,
      message: "Sync completed successfully.",
      retryable: false,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      pendingCount: pending.pendingCount,
    };
  } catch (error) {
    const pending = await getPendingSyncDiagnostics();
    const permissionDenied = isPermissionDenied(error);
    const retryable = isNetworkFailure(error);

    return {
      success: false,
      message: getSyncErrorMessage(error),
      retryable,
      permissionDenied,
      throttled: false,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      pendingCount: pending.pendingCount,
    };
  }
}

export async function findCloudTextbookByISBN(userId: string, isbnInput: string) {
  const raw = isbnInput.trim();
  const normalized = normalizeISBN(raw);

  if (!userId.trim() || !raw) {
    return null;
  }

  const textbooksRef = userCollection(STORE_NAMES.textbooks, userId);

  const rawPath = `users/${userId}/textbooks?isbnRaw=${raw}`;
  const normalizedPath = `users/${userId}/textbooks?isbnNormalized=${normalized}`;

  logSyncEvent("read:start", rawPath, { userId, isbnRaw: raw });
  if (normalized) {
    logSyncEvent("read:start", normalizedPath, { userId, isbnNormalized: normalized });
  }

  const [rawMatches, normalizedMatches] = await Promise.all([
    getDocs(query(textbooksRef, where("isbnRaw", "==", raw))),
    normalized
      ? getDocs(query(textbooksRef, where("isbnNormalized", "==", normalized)))
      : Promise.resolve(null),
  ]);

  logSyncEvent("read:success", rawPath, { docs: rawMatches.size });
  if (normalizedMatches) {
    logSyncEvent("read:success", normalizedPath, { docs: normalizedMatches.size });
  }

  const candidates = [
    ...rawMatches.docs,
    ...(normalizedMatches ? normalizedMatches.docs : []),
  ];

  const first = candidates[0];
  if (!first) {
    return null;
  }

  const textbook = first.data() as CourseForgeEntityMap["textbooks"];
  return withSyncDefaults(
    {
      ...textbook,
      id: first.id,
      userId,
      pendingSync: false,
      source: "cloud",
    },
    "cloud",
    false
  ) as CourseForgeEntityMap["textbooks"];
}

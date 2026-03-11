import { collection, collectionGroup, doc, getDocs, query, setDoc, where } from "firebase/firestore";

import type { CourseForgeEntityMap } from "../models";
import { getAll, save, STORE_NAMES } from "./db";
import { normalizeISBN } from "./isbnService";
import { firestoreDb } from "../../firebase/firestore";
import { getAdminClaim, getCurrentUser } from "../../firebase/auth";
import { useUIStore } from "../../webapp/store/uiStore";

type SyncStoreName = "textbooks" | "chapters" | "sections" | "vocabTerms";
type SyncEntity = CourseForgeEntityMap[SyncStoreName];
type HierarchyIndexes = {
  chapterById: Map<string, CourseForgeEntityMap["chapters"]>;
  sectionById: Map<string, CourseForgeEntityMap["sections"]>;
};

const SYNC_STORES: SyncStoreName[] = [
  STORE_NAMES.textbooks,
  STORE_NAMES.chapters,
  STORE_NAMES.sections,
  STORE_NAMES.vocabTerms,
];

const WRITE_LOOP_WINDOW_MS = 500;
// Prevent back-to-back sync invocations from flooding Firestore writes.
const SYNC_THROTTLE_MS = 5000;
// Session budget guardrail to avoid runaway browser-side sync writes.
const DEFAULT_WRITE_BUDGET_LIMIT = Number(import.meta.env.VITE_SYNC_WRITE_BUDGET ?? "500");
const DEFAULT_RETRY_LIMIT = 3;
const WRITE_BUDGET_WARNING = "Cloud sync paused to prevent excessive writes. Please review your data or try again later.";

const recentWrites = new Map<string, number>();
let lastSyncAttemptAt = 0;
let writeLoopTriggered = false;
let writeBudgetExceeded = false;
let sessionWriteCount = 0;
let syncContext: { uid: string | null; isAdmin: boolean | null } = { uid: null, isAdmin: null };

interface SyncErrorLike {
  code?: string;
  message?: string;
}

interface SyncNowDependencies {
  nowFn?: () => number;
  getCurrentUserFn?: () => { uid?: string | null } | null;
  getPendingSyncDiagnosticsFn?: typeof getPendingSyncDiagnostics;
  syncUserDataFn?: typeof syncUserData;
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
    success: !error,
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
    console.warn(`[CourseForge sync] Write loop protection triggered for ${path}`);
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

function hasWriteBudgetCapacity(path: string, payload: unknown): boolean {
  if (writeBudgetExceeded || sessionWriteCount >= DEFAULT_WRITE_BUDGET_LIMIT) {
    writeBudgetExceeded = true;
    logSyncEvent("write:budget-exceeded", path, {
      payload,
      writeCount: sessionWriteCount,
      writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
    });
    return false;
  }

  return true;
}

export function consumeWriteLoopTriggered(): boolean {
  const wasTriggered = writeLoopTriggered;
  writeLoopTriggered = false;
  return wasTriggered;
}

/**
 * Test-only helper to keep sync safety tests deterministic.
 */
export function resetSyncSafetyStateForTests(): void {
  recentWrites.clear();
  lastSyncAttemptAt = 0;
  writeLoopTriggered = false;
  writeBudgetExceeded = false;
  sessionWriteCount = 0;
}

/**
 * Test-only helper to simulate budget exhaustion without mutating Firestore.
 */
export function setWriteBudgetStateForTests(exceeded: boolean, writeCount = DEFAULT_WRITE_BUDGET_LIMIT): void {
  writeBudgetExceeded = exceeded;
  sessionWriteCount = writeCount;
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

function isForbiddenUserScopedPath(path: string): boolean {
  return path.startsWith("users/");
}

function stripLegacyUserScopedKeys<T extends Record<string, unknown>>(value: T): T {
  const next = { ...value } as Record<string, unknown>;
  delete next.syncPath;
  delete next.firestorePath;
  delete next.userScopedPath;
  delete next.cloudPath;
  return next as T;
}

function getDocPathFromStoreItem(
  storeName: SyncStoreName,
  item: SyncEntity,
  indexes: HierarchyIndexes
): { path: string; payload: Record<string, unknown> } | null {
  if (storeName === STORE_NAMES.textbooks) {
    return {
      path: `textbooks/${item.id}`,
      payload: item as unknown as Record<string, unknown>,
    };
  }

  if (storeName === STORE_NAMES.chapters) {
    const chapter = item as CourseForgeEntityMap["chapters"];
    if (!chapter.textbookId) {
      logSyncEvent("write:skip-missing-textbook", `chapters/${chapter.id}`, chapter);
      return null;
    }

    return {
      path: `textbooks/${chapter.textbookId}/chapters/${chapter.id}`,
      payload: chapter as unknown as Record<string, unknown>,
    };
  }

  if (storeName === STORE_NAMES.sections) {
    const section = item as CourseForgeEntityMap["sections"];
    if (!section.chapterId) {
      logSyncEvent("write:skip-missing-chapter", `sections/${section.id}`, section);
      return null;
    }

    const chapter = indexes.chapterById.get(section.chapterId);
    const textbookId = section.textbookId ?? chapter?.textbookId;

    if (!textbookId) {
      logSyncEvent("write:skip-missing-textbook", `sections/${section.id}`, section);
      return null;
    }

    return {
      path: `textbooks/${textbookId}/chapters/${section.chapterId}/sections/${section.id}`,
      payload: {
        ...section,
        textbookId,
      } as Record<string, unknown>,
    };
  }

  const vocab = item as CourseForgeEntityMap["vocabTerms"];
  if (!vocab.sectionId) {
    logSyncEvent("write:skip-missing-section", `vocab/${vocab.id}`, vocab);
    return null;
  }

  const section = indexes.sectionById.get(vocab.sectionId);
  const chapterId = vocab.chapterId ?? section?.chapterId;
  const textbookId = vocab.textbookId ?? section?.textbookId;

  if (!chapterId || !textbookId) {
    logSyncEvent("write:skip-missing-hierarchy", `vocab/${vocab.id}`, vocab);
    return null;
  }

  return {
    path: `textbooks/${textbookId}/chapters/${chapterId}/sections/${vocab.sectionId}/vocab/${vocab.id}`,
    payload: {
      ...vocab,
      chapterId,
      textbookId,
    } as Record<string, unknown>,
  };
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

async function fetchCloudStore<T extends SyncStoreName>(
  storeName: T,
  userId: string
): Promise<Array<CourseForgeEntityMap[T]>> {
  const path = `cloud/${storeName}`;
  logSyncEvent("read:start", path, { userId, storeName });

  const snapshot = await (async () => {
    if (storeName === STORE_NAMES.textbooks) {
      return getDocs(query(collection(firestoreDb, "textbooks"), where("userId", "==", userId)));
    }

    if (storeName === STORE_NAMES.chapters) {
      return getDocs(query(collectionGroup(firestoreDb, "chapters"), where("userId", "==", userId)));
    }

    if (storeName === STORE_NAMES.sections) {
      return getDocs(query(collectionGroup(firestoreDb, "sections"), where("userId", "==", userId)));
    }

    return getDocs(query(collectionGroup(firestoreDb, "vocab"), where("userId", "==", userId)));
  })();

  logSyncEvent("read:success", path, { docs: snapshot.size });

  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data() as Record<string, unknown>;
    const parts = docSnapshot.ref.path.split("/");

    let withId: CourseForgeEntityMap[T];

    if (storeName === STORE_NAMES.chapters) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["chapters"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
      } as CourseForgeEntityMap[T];
    } else if (storeName === STORE_NAMES.sections) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["sections"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
        chapterId: (data.chapterId as string | undefined) ?? parts[3],
      } as CourseForgeEntityMap[T];
    } else if (storeName === STORE_NAMES.vocabTerms) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["vocabTerms"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
        chapterId: (data.chapterId as string | undefined) ?? parts[3],
        sectionId: (data.sectionId as string | undefined) ?? parts[5],
      } as CourseForgeEntityMap[T];
    } else {
      withId = {
        ...(data as unknown as CourseForgeEntityMap[T]),
        id: docSnapshot.id,
        userId,
      } as CourseForgeEntityMap[T];
    }

    return withSyncDefaults(withId, "cloud", false) as CourseForgeEntityMap[T];
  });
}

async function fetchLocalStore<T extends SyncStoreName>(
  storeName: T
): Promise<Array<CourseForgeEntityMap[T]>> {
  const rows = await getAll(storeName);
  return rows.map((row) => withSyncDefaults(row, "local", true) as CourseForgeEntityMap[T]);
}

async function migrateLocalHierarchyData(): Promise<void> {
  const [chapters, sections, vocabTerms] = await Promise.all([
    fetchLocalStore(STORE_NAMES.chapters),
    fetchLocalStore(STORE_NAMES.sections),
    fetchLocalStore(STORE_NAMES.vocabTerms),
  ]);

  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const sectionById = new Map(sections.map((section) => [section.id, section]));

  await Promise.all(
    chapters.map(async (chapter) => {
      const cleaned = stripLegacyUserScopedKeys(chapter as unknown as Record<string, unknown>) as unknown as CourseForgeEntityMap["chapters"];
      if (JSON.stringify(cleaned) !== JSON.stringify(chapter)) {
        await saveLocalStoreItem(STORE_NAMES.chapters, cleaned);
      }
    })
  );

  await Promise.all(
    sections.map(async (section) => {
      const parentChapter = chapterById.get(section.chapterId);
      const textbookId = section.textbookId ?? parentChapter?.textbookId;

      if (!section.chapterId || !textbookId) {
        logSyncEvent("migration:skip-section", `sections/${section.id}`, section);
        return;
      }

      const cleaned = stripLegacyUserScopedKeys({
        ...section,
        textbookId,
      } as Record<string, unknown>) as unknown as CourseForgeEntityMap["sections"];

      if (JSON.stringify(cleaned) !== JSON.stringify(section)) {
        await saveLocalStoreItem(STORE_NAMES.sections, cleaned);
      }
    })
  );

  await Promise.all(
    vocabTerms.map(async (term) => {
      const parentSection = sectionById.get(term.sectionId);
      const chapterId = term.chapterId ?? parentSection?.chapterId;
      const textbookId = term.textbookId ?? parentSection?.textbookId;

      if (!term.sectionId || !chapterId || !textbookId) {
        logSyncEvent("migration:skip-vocab", `vocab/${term.id}`, term);
        return;
      }

      const cleaned = stripLegacyUserScopedKeys({
        ...term,
        chapterId,
        textbookId,
      } as Record<string, unknown>) as unknown as CourseForgeEntityMap["vocabTerms"];

      if (JSON.stringify(cleaned) !== JSON.stringify(term)) {
        await saveLocalStoreItem(STORE_NAMES.vocabTerms, cleaned);
      }
    })
  );
}

async function buildHierarchyIndexes(): Promise<HierarchyIndexes> {
  const [chapters, sections] = await Promise.all([
    fetchLocalStore(STORE_NAMES.chapters),
    fetchLocalStore(STORE_NAMES.sections),
  ]);

  return {
    chapterById: new Map(chapters.map((chapter) => [chapter.id, chapter])),
    sectionById: new Map(sections.map((section) => [section.id, section])),
  };
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
  item: CourseForgeEntityMap[T],
  indexes: HierarchyIndexes
): Promise<boolean> {
  const resolved = getDocPathFromStoreItem(storeName, item, indexes);
  if (!resolved) {
    return false;
  }

  const path = resolved.path;

  if (isForbiddenUserScopedPath(path)) {
    logSyncEvent("write:blocked-user-scope", path, resolved.payload, {
      code: "invalid-sync-path",
      message: "Blocked user-scoped cloud write path.",
    });
    return false;
  }

  const cloudRecord = {
    ...resolved.payload,
    userId,
    pendingSync: false,
    source: "cloud",
    lastModified: item.lastModified ?? toIsoNow(),
  };

  if (shouldSkipWriteForLoop(path)) {
    return false;
  }

  if (!hasWriteBudgetCapacity(path, cloudRecord)) {
    return false;
  }

  logSyncEvent("write:start", path, cloudRecord);
  try {
    await setDoc(doc(firestoreDb, path), cloudRecord, { merge: true });
    sessionWriteCount += 1;
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
    await migrateLocalHierarchyData();
    const indexes = await buildHierarchyIndexes();

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

            const wroteToCloud = await saveCloudStoreItem(storeName, userId, synced, indexes);
            if (wroteToCloud) {
              await saveLocalStoreItem(storeName, synced);
            }
          })
        );
      })
    );
  } catch (error) {
    logSyncEvent("upload:error", "textbooks/*", { userId }, error);
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
    logSyncEvent("download:error", "textbooks/*", { userId }, error);
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
    await migrateLocalHierarchyData();
    const indexes = await buildHierarchyIndexes();

    const before = await getPendingSyncDiagnostics();
    logSyncEvent("sync:start", "textbooks/*", { userId, pendingBefore: before.pendingCount });

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

              const wroteToCloud = await saveCloudStoreItem(storeName, userId, localWinner, indexes);
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

              const wroteToCloud = await saveCloudStoreItem(storeName, userId, localOnly, indexes);
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
    logSyncEvent("sync:success", "textbooks/*", { userId, pendingAfter: after.pendingCount, byStore: after.byStore });
  } catch (error) {
    logSyncEvent("sync:error", "textbooks/*", { userId, code: getErrorCode(error) }, error);
    console.error("syncUserData failed", error);
    throw new Error(getSyncErrorMessage(error));
  }
}

export async function syncNow(deps: SyncNowDependencies = {}): Promise<{
  success: boolean;
  message: string;
  retryable: boolean;
  permissionDenied: boolean;
  throttled: boolean;
  writeLoopTriggered: boolean;
  writeBudgetExceeded: boolean;
  writeCount: number;
  writeBudgetLimit: number;
  retryLimit: number;
  errorCode: string | null;
  pendingCount: number;
}> {
  const now = deps.nowFn ? deps.nowFn() : Date.now();
  const getPending = deps.getPendingSyncDiagnosticsFn ?? getPendingSyncDiagnostics;
  const getUser = deps.getCurrentUserFn ?? getCurrentUser;
  const runSyncUserData = deps.syncUserDataFn ?? syncUserData;

  if (now - lastSyncAttemptAt < SYNC_THROTTLE_MS) {
    const pending = await getPending();
    return {
      success: false,
      message: "Sync skipped to avoid excessive write frequency.",
      retryable: false,
      permissionDenied: false,
      throttled: true,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      writeBudgetExceeded,
      writeCount: sessionWriteCount,
      writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
      retryLimit: DEFAULT_RETRY_LIMIT,
      errorCode: null,
      pendingCount: pending.pendingCount,
    };
  }

  lastSyncAttemptAt = now;
  const user = getUser();

  if (!user?.uid) {
    const pending = await getPending();
    return {
      success: false,
      message: "Sign in to sync your local data with the cloud.",
      retryable: false,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      writeBudgetExceeded,
      writeCount: sessionWriteCount,
      writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
      retryLimit: DEFAULT_RETRY_LIMIT,
      errorCode: null,
      pendingCount: pending.pendingCount,
    };
  }

  if (writeBudgetExceeded) {
    const pending = await getPending();
    return {
      success: false,
      message: WRITE_BUDGET_WARNING,
      retryable: false,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      writeBudgetExceeded: true,
      writeCount: sessionWriteCount,
      writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
      retryLimit: DEFAULT_RETRY_LIMIT,
      errorCode: null,
      pendingCount: pending.pendingCount,
    };
  }

  try {
    await runSyncUserData(user.uid);
    const pending = await getPending();

    if (writeBudgetExceeded) {
      return {
        success: false,
        message: WRITE_BUDGET_WARNING,
        retryable: false,
        permissionDenied: false,
        throttled: false,
        writeLoopTriggered: consumeWriteLoopTriggered(),
        writeBudgetExceeded: true,
        writeCount: sessionWriteCount,
        writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
        retryLimit: DEFAULT_RETRY_LIMIT,
        errorCode: null,
        pendingCount: pending.pendingCount,
      };
    }

    return {
      success: true,
      message: "Sync completed successfully.",
      retryable: false,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      writeBudgetExceeded: false,
      writeCount: sessionWriteCount,
      writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
      retryLimit: DEFAULT_RETRY_LIMIT,
      errorCode: null,
      pendingCount: pending.pendingCount,
    };
  } catch (error) {
    const pending = await getPending();
    const permissionDenied = isPermissionDenied(error);
    const retryable = isNetworkFailure(error);
    const errorCode = getErrorCode(error);

    return {
      success: false,
      message: getSyncErrorMessage(error),
      retryable,
      permissionDenied,
      throttled: false,
      writeLoopTriggered: consumeWriteLoopTriggered(),
      writeBudgetExceeded,
      writeCount: sessionWriteCount,
      writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
      retryLimit: DEFAULT_RETRY_LIMIT,
      errorCode,
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

  const textbooksRef = collection(firestoreDb, "textbooks");

  const rawPath = `textbooks?userId=${userId}&isbnRaw=${raw}`;
  const normalizedPath = `textbooks?userId=${userId}&isbnNormalized=${normalized}`;

  logSyncEvent("read:start", rawPath, { userId, isbnRaw: raw });
  if (normalized) {
    logSyncEvent("read:start", normalizedPath, { userId, isbnNormalized: normalized });
  }

  const [rawMatches, normalizedMatches] = await Promise.all([
    getDocs(query(textbooksRef, where("userId", "==", userId), where("isbnRaw", "==", raw))),
    normalized
      ? getDocs(query(textbooksRef, where("userId", "==", userId), where("isbnNormalized", "==", normalized)))
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

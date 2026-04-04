import { collection, collectionGroup, doc, getDocs, query, setDoc, where } from "firebase/firestore";

import type { CourseForgeEntityMap } from "../models";
import { getAll, save, STORE_NAMES } from "./db";
import { normalizeISBN } from "./isbnService";
import { firestoreDb } from "../../firebase/firestore";
import { getAdminClaim, getCurrentUser } from "../../firebase/auth";
import { useUIStore } from "../../webapp/store/uiStore";

type ViteEnvLike = {
  DEV?: boolean;
  VITE_SYNC_WRITE_BUDGET?: string;
};

const viteEnv = (import.meta as ImportMeta & { env?: ViteEnvLike } | undefined)?.env;
const isDevRuntime = Boolean(viteEnv?.DEV);

type SyncStoreName = "textbooks" | "chapters" | "sections" | "vocabTerms" | "equations" | "concepts" | "keyIdeas";
type SyncEntity = CourseForgeEntityMap[SyncStoreName];
type HierarchyIndexes = {
  textbookById: Map<string, CourseForgeEntityMap["textbooks"]>;
  chapterById: Map<string, CourseForgeEntityMap["chapters"]>;
  sectionById: Map<string, CourseForgeEntityMap["sections"]>;
};

const SYNC_STORES: SyncStoreName[] = [
  STORE_NAMES.textbooks,
  STORE_NAMES.chapters,
  STORE_NAMES.sections,
  STORE_NAMES.vocabTerms,
  STORE_NAMES.equations,
  STORE_NAMES.concepts,
  STORE_NAMES.keyIdeas,
];

const WRITE_LOOP_WINDOW_MS = 500;
// Prevent back-to-back sync invocations from flooding Firestore writes.
const SYNC_THROTTLE_MS = 5000;
// Session budget guardrail to avoid runaway browser-side sync writes.
const DEFAULT_WRITE_BUDGET_LIMIT = Number(viteEnv?.VITE_SYNC_WRITE_BUDGET ?? "500");
const DEFAULT_READ_BUDGET_LIMIT = Number(viteEnv?.VITE_SYNC_READ_BUDGET ?? "5000");
const DEFAULT_RETRY_LIMIT = 3;
const WRITE_BUDGET_WARNING = "Cloud sync paused to prevent excessive writes. Please review your data or try again later.";
const WRITE_BUDGET_STORAGE_KEY = "courseforge.sync.writeBudgetDaily";
const READ_BUDGET_STORAGE_KEY = "courseforge.sync.readBudgetDaily";

const recentWrites = new Map<string, number>();
let lastSyncAttemptAt = 0;
let writeLoopTriggered = false;
let writeBudgetExceeded = false;
let sessionWriteCount = 0;
let writeBudgetDateKey = "";
let readBudgetExceeded = false;
let sessionReadCount = 0;
let readBudgetDateKey = "";
let syncContext: { uid: string | null; isAdmin: boolean | null } = { uid: null, isAdmin: null };

function getUtcDateKey(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readDailyWriteBudgetState(): { dateKey: string; writeCount: number; exceeded: boolean } | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WRITE_BUDGET_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { dateKey?: unknown; writeCount?: unknown; exceeded?: unknown };
    if (typeof parsed.dateKey !== "string") {
      return null;
    }

    const parsedWriteCount = Number(parsed.writeCount ?? 0);
    const safeWriteCount = Number.isFinite(parsedWriteCount) && parsedWriteCount >= 0
      ? Math.floor(parsedWriteCount)
      : 0;

    return {
      dateKey: parsed.dateKey,
      writeCount: safeWriteCount,
      exceeded: Boolean(parsed.exceeded),
    };
  } catch {
    return null;
  }
}

function persistDailyWriteBudgetState(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      WRITE_BUDGET_STORAGE_KEY,
      JSON.stringify({
        dateKey: writeBudgetDateKey,
        writeCount: sessionWriteCount,
        exceeded: writeBudgetExceeded,
      })
    );
  } catch {
    // Best effort persistence only.
  }
}

function refreshDailyWriteBudgetState(): void {
  const currentDateKey = getUtcDateKey();
  if (writeBudgetDateKey === currentDateKey) {
    return;
  }

  const persisted = readDailyWriteBudgetState();
  if (persisted && persisted.dateKey === currentDateKey) {
    writeBudgetDateKey = persisted.dateKey;
    sessionWriteCount = persisted.writeCount;
    writeBudgetExceeded = persisted.exceeded || persisted.writeCount >= DEFAULT_WRITE_BUDGET_LIMIT;
    return;
  }

  writeBudgetDateKey = currentDateKey;
  sessionWriteCount = 0;
  writeBudgetExceeded = false;
  persistDailyWriteBudgetState();
}

function readDailyReadBudgetState(): { dateKey: string; readCount: number; exceeded: boolean } | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(READ_BUDGET_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { dateKey?: unknown; readCount?: unknown; exceeded?: unknown };
    if (typeof parsed.dateKey !== "string") {
      return null;
    }

    const parsedReadCount = Number(parsed.readCount ?? 0);
    const safeReadCount = Number.isFinite(parsedReadCount) && parsedReadCount >= 0
      ? Math.floor(parsedReadCount)
      : 0;

    return {
      dateKey: parsed.dateKey,
      readCount: safeReadCount,
      exceeded: Boolean(parsed.exceeded),
    };
  } catch {
    return null;
  }
}

function persistDailyReadBudgetState(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      READ_BUDGET_STORAGE_KEY,
      JSON.stringify({
        dateKey: readBudgetDateKey,
        readCount: sessionReadCount,
        exceeded: readBudgetExceeded,
      })
    );
  } catch {
    // Best effort persistence only.
  }
}

function refreshDailyReadBudgetState(): void {
  const currentDateKey = getUtcDateKey();
  if (readBudgetDateKey === currentDateKey) {
    return;
  }

  const persisted = readDailyReadBudgetState();
  if (persisted && persisted.dateKey === currentDateKey) {
    readBudgetDateKey = persisted.dateKey;
    sessionReadCount = persisted.readCount;
    readBudgetExceeded = persisted.exceeded || persisted.readCount >= DEFAULT_READ_BUDGET_LIMIT;
    return;
  }

  readBudgetDateKey = currentDateKey;
  sessionReadCount = 0;
  readBudgetExceeded = false;
  persistDailyReadBudgetState();
}

interface UserCloudSyncPolicy {
  isBlocked: boolean;
  reason: string | null;
}

interface SyncErrorLike {
  code?: string;
  message?: string;
  cause?: unknown;
}

interface SyncNowDependencies {
  intent?: "bootstrap" | "auto" | "manual";
  nowFn?: () => number;
  getCurrentUserFn?: () => { uid?: string | null } | null;
  getPendingSyncDiagnosticsFn?: () => Promise<{ pendingCount: number; byStore: Partial<Record<SyncStoreName, number>> }>;
  syncUserDataFn?: typeof syncUserData;
}

function getErrorCode(error: unknown): string {
  const err = error as SyncErrorLike | undefined;
  const directCode = err?.code;
  if (typeof directCode === "string" && directCode.trim().length > 0) {
    return directCode;
  }

  const causeCode = (err?.cause as SyncErrorLike | undefined)?.code;
  if (typeof causeCode === "string" && causeCode.trim().length > 0) {
    return causeCode;
  }

  const message = `${err?.message ?? ""} ${(err?.cause as SyncErrorLike | undefined)?.message ?? ""}`.toLowerCase();

  if (message.includes("permission-denied")) {
    return "permission-denied";
  }

  if (message.includes("unauthenticated")) {
    return "unauthenticated";
  }

  if (message.includes("unavailable")) {
    return "unavailable";
  }

  if (message.includes("network-request-failed")) {
    return "network-request-failed";
  }

  return "unknown";
}

function wrapSyncError(error: unknown): Error {
  const wrapped = new Error(getSyncErrorMessage(error)) as Error & SyncErrorLike;
  const code = getErrorCode(error);

  if (code !== "unknown") {
    wrapped.code = code;
  }

  wrapped.cause = error;
  return wrapped;
}

export function logSyncEvent(type: string, path: string, payload: unknown, error?: unknown): void {
  if (!isDevRuntime) {
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
  refreshDailyWriteBudgetState();

  if (writeBudgetExceeded || sessionWriteCount >= DEFAULT_WRITE_BUDGET_LIMIT) {
    writeBudgetExceeded = true;
    persistDailyWriteBudgetState();
    logSyncEvent("write:budget-exceeded", path, {
      payload,
      writeCount: sessionWriteCount,
      writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
    });
    return false;
  }

  return true;
}

async function trackedGetDocs<T>(request: Promise<{ docs: T[] }>): Promise<{ docs: T[] }> {
  const snapshot = await request;
  refreshDailyReadBudgetState();
  sessionReadCount += snapshot.docs.length;
  readBudgetExceeded = sessionReadCount >= DEFAULT_READ_BUDGET_LIMIT;
  persistDailyReadBudgetState();
  return snapshot;
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
  writeBudgetDateKey = getUtcDateKey();
  readBudgetExceeded = false;
  sessionReadCount = 0;
  readBudgetDateKey = getUtcDateKey();
}

/**
 * Test-only helper to simulate budget exhaustion without mutating Firestore.
 */
export function setWriteBudgetStateForTests(exceeded: boolean, writeCount = DEFAULT_WRITE_BUDGET_LIMIT): void {
  writeBudgetDateKey = getUtcDateKey();
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
  if (!isDevRuntime) {
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

function mergeDocsByPath<T extends { ref: { path: string } }>(...docLists: T[][]): T[] {
  const byPath = new Map<string, T>();
  docLists.forEach((docList) => {
    docList.forEach((docItem) => {
      byPath.set(docItem.ref.path, docItem);
    });
  });
  return [...byPath.values()];
}

const canonicalReadCache = new Map<string, Promise<Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>>>();

function resetCanonicalReadCache(): void {
  canonicalReadCache.clear();
}

function getCachedCanonicalDocs(
  key: string,
  factory: () => Promise<Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>>
): Promise<Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>> {
  const cached = canonicalReadCache.get(key);
  if (cached) {
    return cached;
  }

  const next = factory();
  canonicalReadCache.set(key, next);
  return next;
}

async function fetchCanonicalTextbookDocs(
  userId: string
): Promise<Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>> {
  return getCachedCanonicalDocs(`textbooks:${userId}`, async () => {
    const [byUserId, byOwnerId] = await Promise.all([
      trackedGetDocs(getDocs(query(collection(firestoreDb, "textbooks"), where("userId", "==", userId)))),
      trackedGetDocs(getDocs(query(collection(firestoreDb, "textbooks"), where("ownerId", "==", userId)))),
    ]);
    return mergeDocsByPath(byUserId.docs, byOwnerId.docs);
  });
}

async function fetchCanonicalChapterDocs(
  userId: string
): Promise<Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>> {
  return getCachedCanonicalDocs(`chapters:${userId}`, async () => {
    const textbookDocs = await fetchCanonicalTextbookDocs(userId);
    const chapterSnapshots = await Promise.all(
      textbookDocs.map((textbookDoc) => trackedGetDocs(getDocs(collection(firestoreDb, `${textbookDoc.ref.path}/chapters`))))
    );
    return chapterSnapshots.flatMap((snapshot) => snapshot.docs);
  });
}

async function fetchCanonicalSectionDocs(
  userId: string
): Promise<Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>> {
  return getCachedCanonicalDocs(`sections:${userId}`, async () => {
    const chapterDocs = await fetchCanonicalChapterDocs(userId);
    const sectionSnapshots = await Promise.all(
      chapterDocs.map((chapterDoc) => trackedGetDocs(getDocs(collection(firestoreDb, `${chapterDoc.ref.path}/sections`))))
    );
    return sectionSnapshots.flatMap((snapshot) => snapshot.docs);
  });
}

async function fetchCanonicalSectionChildDocs(
  userId: string,
  collectionName: "vocab" | "equations" | "concepts" | "keyIdeas"
): Promise<Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>> {
  return getCachedCanonicalDocs(`${collectionName}:${userId}`, async () => {
    const sectionDocs = await fetchCanonicalSectionDocs(userId);
    const childSnapshots = await Promise.all(
      sectionDocs.map((sectionDoc) => trackedGetDocs(getDocs(collection(firestoreDb, `${sectionDoc.ref.path}/${collectionName}`))))
    );
    return childSnapshots.flatMap((snapshot) => snapshot.docs);
  });
}

async function fetchCollectionGroupWithCanonicalFallback(
  userId: string,
  groupName: "chapters" | "sections" | "vocab" | "equations" | "concepts" | "keyIdeas"
): Promise<Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>> {
  try {
    const [byUserId, byOwnerId] = await Promise.all([
      trackedGetDocs(getDocs(query(collectionGroup(firestoreDb, groupName), where("userId", "==", userId)))),
      trackedGetDocs(getDocs(query(collectionGroup(firestoreDb, groupName), where("ownerId", "==", userId)))),
    ]);
    return mergeDocsByPath(byUserId.docs, byOwnerId.docs);
  } catch (error) {
    if (getErrorCode(error) !== "permission-denied") {
      throw error;
    }

    logSyncEvent("read:fallback-canonical", `cloud/${groupName}`, { userId, reason: "collection-group-permission-denied" }, error);

    if (groupName === "chapters") {
      return fetchCanonicalChapterDocs(userId);
    }

    if (groupName === "sections") {
      return fetchCanonicalSectionDocs(userId);
    }

    if (groupName === "vocab") {
      return fetchCanonicalSectionChildDocs(userId, "vocab");
    }

    if (groupName === "equations") {
      return fetchCanonicalSectionChildDocs(userId, "equations");
    }

    if (groupName === "concepts") {
      return fetchCanonicalSectionChildDocs(userId, "concepts");
    }

    return fetchCanonicalSectionChildDocs(userId, "keyIdeas");
  }
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
  const resolveSectionScopedPayload = <T extends CourseForgeEntityMap["vocabTerms"] | CourseForgeEntityMap["equations"] | CourseForgeEntityMap["concepts"] | CourseForgeEntityMap["keyIdeas"]>(
    entity: T,
    collectionName: string,
    logPath: string
  ): { path: string; payload: Record<string, unknown> } | null => {
    if (!entity.sectionId) {
      logSyncEvent("write:skip-missing-section", `${logPath}/${entity.id}`, entity);
      return null;
    }

    const section = indexes.sectionById.get(entity.sectionId);
    const chapterId = entity.chapterId ?? section?.chapterId;
    const textbookId = entity.textbookId ?? section?.textbookId;

    if (!chapterId || !textbookId) {
      logSyncEvent("write:skip-missing-hierarchy", `${logPath}/${entity.id}`, entity);
      return null;
    }

    return {
      path: `textbooks/${textbookId}/chapters/${chapterId}/sections/${entity.sectionId}/${collectionName}/${entity.id}`,
      payload: {
        ...entity,
        chapterId,
        textbookId,
      } as Record<string, unknown>,
    };
  };

  if (storeName === STORE_NAMES.vocabTerms) {
    return resolveSectionScopedPayload(vocab, "vocab", "vocab");
  }

  if (storeName === STORE_NAMES.equations) {
    return resolveSectionScopedPayload(item as CourseForgeEntityMap["equations"], "equations", "equations");
  }

  if (storeName === STORE_NAMES.concepts) {
    return resolveSectionScopedPayload(item as CourseForgeEntityMap["concepts"], "concepts", "concepts");
  }

  return resolveSectionScopedPayload(item as CourseForgeEntityMap["keyIdeas"], "keyIdeas", "keyIdeas");
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

  let docs: Array<{ ref: { path: string }; id: string; data: () => Record<string, unknown> }>;
  try {
    docs = await (async () => {
      if (storeName === STORE_NAMES.textbooks) {
        return fetchCanonicalTextbookDocs(userId);
      }

      if (storeName === STORE_NAMES.chapters) {
        return fetchCollectionGroupWithCanonicalFallback(userId, "chapters");
      }

      if (storeName === STORE_NAMES.sections) {
        return fetchCollectionGroupWithCanonicalFallback(userId, "sections");
      }

      if (storeName === STORE_NAMES.equations) {
        return fetchCollectionGroupWithCanonicalFallback(userId, "equations");
      }

      if (storeName === STORE_NAMES.concepts) {
        return fetchCollectionGroupWithCanonicalFallback(userId, "concepts");
      }

      if (storeName === STORE_NAMES.keyIdeas) {
        return fetchCollectionGroupWithCanonicalFallback(userId, "keyIdeas");
      }

      return fetchCollectionGroupWithCanonicalFallback(userId, "vocab");
    })();
  } catch (error) {
    logSyncEvent("read:error", path, { userId, storeName }, error);
    throw error;
  }

  logSyncEvent("read:success", path, { docs: docs.length });

  return docs.map((docSnapshot) => {
    const data = docSnapshot.data() as Record<string, unknown>;
    const parts = docSnapshot.ref.path.split("/");

    let withId: CourseForgeEntityMap[T];

    if (storeName === STORE_NAMES.chapters) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["chapters"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
      } as unknown as CourseForgeEntityMap[T];
    } else if (storeName === STORE_NAMES.sections) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["sections"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
        chapterId: (data.chapterId as string | undefined) ?? parts[3],
      } as unknown as CourseForgeEntityMap[T];
    } else if (storeName === STORE_NAMES.vocabTerms) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["vocabTerms"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
        chapterId: (data.chapterId as string | undefined) ?? parts[3],
        sectionId: (data.sectionId as string | undefined) ?? parts[5],
      } as unknown as CourseForgeEntityMap[T];
    } else if (storeName === STORE_NAMES.equations) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["equations"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
        chapterId: (data.chapterId as string | undefined) ?? parts[3],
        sectionId: (data.sectionId as string | undefined) ?? parts[5],
      } as unknown as CourseForgeEntityMap[T];
    } else if (storeName === STORE_NAMES.concepts) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["concepts"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
        chapterId: (data.chapterId as string | undefined) ?? parts[3],
        sectionId: (data.sectionId as string | undefined) ?? parts[5],
      } as unknown as CourseForgeEntityMap[T];
    } else if (storeName === STORE_NAMES.keyIdeas) {
      withId = {
        ...(data as unknown as CourseForgeEntityMap["keyIdeas"]),
        id: docSnapshot.id,
        userId,
        textbookId: (data.textbookId as string | undefined) ?? parts[1],
        chapterId: (data.chapterId as string | undefined) ?? parts[3],
        sectionId: (data.sectionId as string | undefined) ?? parts[5],
      } as unknown as CourseForgeEntityMap[T];
    } else {
      withId = {
        ...(data as unknown as CourseForgeEntityMap[T]),
        id: docSnapshot.id,
        userId,
      } as unknown as CourseForgeEntityMap[T];
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
  const [chapters, sections, vocabTerms, equations, concepts, keyIdeas] = await Promise.all([
    fetchLocalStore(STORE_NAMES.chapters),
    fetchLocalStore(STORE_NAMES.sections),
    fetchLocalStore(STORE_NAMES.vocabTerms),
    fetchLocalStore(STORE_NAMES.equations),
    fetchLocalStore(STORE_NAMES.concepts),
    fetchLocalStore(STORE_NAMES.keyIdeas),
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

  await Promise.all(
    equations.map(async (equation) => {
      const parentSection = sectionById.get(equation.sectionId);
      const chapterId = equation.chapterId ?? parentSection?.chapterId;
      const textbookId = equation.textbookId ?? parentSection?.textbookId;

      if (!equation.sectionId || !chapterId || !textbookId) {
        logSyncEvent("migration:skip-equation", `equations/${equation.id}`, equation);
        return;
      }

      const cleaned = stripLegacyUserScopedKeys({
        ...equation,
        chapterId,
        textbookId,
      } as Record<string, unknown>) as unknown as CourseForgeEntityMap["equations"];

      if (JSON.stringify(cleaned) !== JSON.stringify(equation)) {
        await saveLocalStoreItem(STORE_NAMES.equations, cleaned);
      }
    })
  );

  await Promise.all(
    concepts.map(async (concept) => {
      const parentSection = sectionById.get(concept.sectionId);
      const chapterId = concept.chapterId ?? parentSection?.chapterId;
      const textbookId = concept.textbookId ?? parentSection?.textbookId;

      if (!concept.sectionId || !chapterId || !textbookId) {
        logSyncEvent("migration:skip-concept", `concepts/${concept.id}`, concept);
        return;
      }

      const cleaned = stripLegacyUserScopedKeys({
        ...concept,
        chapterId,
        textbookId,
      } as Record<string, unknown>) as unknown as CourseForgeEntityMap["concepts"];

      if (JSON.stringify(cleaned) !== JSON.stringify(concept)) {
        await saveLocalStoreItem(STORE_NAMES.concepts, cleaned);
      }
    })
  );

  await Promise.all(
    keyIdeas.map(async (keyIdea) => {
      const parentSection = sectionById.get(keyIdea.sectionId);
      const chapterId = keyIdea.chapterId ?? parentSection?.chapterId;
      const textbookId = keyIdea.textbookId ?? parentSection?.textbookId;

      if (!keyIdea.sectionId || !chapterId || !textbookId) {
        logSyncEvent("migration:skip-keyidea", `keyIdeas/${keyIdea.id}`, keyIdea);
        return;
      }

      const cleaned = stripLegacyUserScopedKeys({
        ...keyIdea,
        chapterId,
        textbookId,
      } as Record<string, unknown>) as unknown as CourseForgeEntityMap["keyIdeas"];

      if (JSON.stringify(cleaned) !== JSON.stringify(keyIdea)) {
        await saveLocalStoreItem(STORE_NAMES.keyIdeas, cleaned);
      }
    })
  );
}

async function buildHierarchyIndexes(): Promise<HierarchyIndexes> {
  const [textbooks, chapters, sections] = await Promise.all([
    fetchLocalStore(STORE_NAMES.textbooks),
    fetchLocalStore(STORE_NAMES.chapters),
    fetchLocalStore(STORE_NAMES.sections),
  ]);

  return {
    textbookById: new Map(textbooks.map((textbook) => [textbook.id, textbook])),
    chapterById: new Map(chapters.map((chapter) => [chapter.id, chapter])),
    sectionById: new Map(sections.map((section) => [section.id, section])),
  };
}

function resolveTextbookForEntity(
  storeName: SyncStoreName,
  item: SyncEntity,
  indexes: HierarchyIndexes
): CourseForgeEntityMap["textbooks"] | null {
  if (storeName === STORE_NAMES.textbooks) {
    return item as CourseForgeEntityMap["textbooks"];
  }

  if (storeName === STORE_NAMES.chapters) {
    const chapter = item as CourseForgeEntityMap["chapters"];
    return chapter.textbookId ? indexes.textbookById.get(chapter.textbookId) ?? null : null;
  }

  if (storeName === STORE_NAMES.sections) {
    const section = item as CourseForgeEntityMap["sections"];
    const chapter = indexes.chapterById.get(section.chapterId);
    const textbookId = section.textbookId ?? chapter?.textbookId;
    return textbookId ? indexes.textbookById.get(textbookId) ?? null : null;
  }

  const sectionScoped = item as CourseForgeEntityMap["vocabTerms"];
  const section = indexes.sectionById.get(sectionScoped.sectionId);
  const textbookId = sectionScoped.textbookId ?? section?.textbookId;
  return textbookId ? indexes.textbookById.get(textbookId) ?? null : null;
}

export function isTextbookCloudSyncBlocked(textbook: CourseForgeEntityMap["textbooks"] | null | undefined): boolean {
  if (!textbook) {
    return false;
  }

  if (textbook.cloudSyncBlockedReason === "blocked_content" || textbook.cloudSyncBlockedReason === "user_blocked") {
    return true;
  }

  if (textbook.requiresAdminReview === true && textbook.status !== "approved") {
    return true;
  }

  if (textbook.imageModerationState === "pending_admin_review") {
    return true;
  }

  return false;
}

async function getUserCloudSyncPolicy(userId: string): Promise<UserCloudSyncPolicy> {
  try {
    const snapshot = await trackedGetDocs(getDocs(query(collection(firestoreDb, "users"), where("uid", "==", userId))));
    const userDoc = snapshot.docs[0];
    if (!userDoc) {
      return { isBlocked: false, reason: null };
    }

    const data = userDoc.data() as Record<string, unknown>;
    return {
      isBlocked: data.isContentBlocked === true,
      reason: typeof data.contentBlockReason === "string" ? data.contentBlockReason : null,
    };
  } catch {
    return { isBlocked: false, reason: null };
  }
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
  indexes: HierarchyIndexes,
  userPolicy?: UserCloudSyncPolicy
): Promise<boolean> {
  if (userPolicy?.isBlocked) {
    logSyncEvent("write:blocked-user-policy", `cloud/${storeName}/${item.id}`, {
      userId,
      reason: userPolicy.reason ?? "User is blocked from cloud sync.",
    });
    return false;
  }

  const textbook = resolveTextbookForEntity(storeName, item, indexes);
  if (isTextbookCloudSyncBlocked(textbook)) {
    logSyncEvent("write:blocked-textbook-review", `cloud/${storeName}/${item.id}`, {
      textbookId: textbook?.id ?? null,
      status: textbook?.status ?? null,
      moderationState: textbook?.imageModerationState ?? null,
      reason: textbook?.cloudSyncBlockedReason ?? "pending_admin_review",
    });
    return false;
  }

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
    ownerId: userId,
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
    persistDailyWriteBudgetState();
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
    const userPolicy = await getUserCloudSyncPolicy(userId);
    if (userPolicy.isBlocked) {
      throw {
        code: "permission-denied",
        message: userPolicy.reason ?? "Cloud sync is blocked for this user.",
      };
    }

    await migrateLocalHierarchyData();
    const indexes = await buildHierarchyIndexes();

    await Promise.all(
      SYNC_STORES.map(async (storeName) => {
        const localItems = await fetchLocalStore(storeName);
        const changedItems = localItems.filter((item) => {
          return item.pendingSync || !item.userId;
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

            const wroteToCloud = await saveCloudStoreItem(storeName, userId, synced, indexes, userPolicy);
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
    throw wrapSyncError(error);
  }
}

export async function downloadCloudData(userId: string): Promise<void> {
  if (!userId.trim()) {
    throw new Error("Cloud download could not start because no user is signed in.");
  }

  try {
    resetCanonicalReadCache();
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
    throw wrapSyncError(error);
  }
}

export async function syncUserData(userId: string): Promise<void> {
  if (!userId.trim()) {
    throw new Error("Sync could not start because no user is signed in.");
  }

  try {
    resetCanonicalReadCache();
    await logSyncIdentity(userId);
    const userPolicy = await getUserCloudSyncPolicy(userId);
    if (userPolicy.isBlocked) {
      throw {
        code: "permission-denied",
        message: userPolicy.reason ?? "Cloud sync is blocked for this user.",
      };
    }

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

              if (localTs === cloudTs) {
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

              const wroteToCloud = await saveCloudStoreItem(storeName, userId, localWinner, indexes, userPolicy);
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

              const wroteToCloud = await saveCloudStoreItem(storeName, userId, localOnly, indexes, userPolicy);
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
    throw wrapSyncError(error);
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
  readCount: number;
  readBudgetLimit: number;
  readBudgetExceeded: boolean;
  retryLimit: number;
  errorCode: string | null;
  pendingCount: number;
}> {
  const intent = deps.intent ?? "manual";
  const now = deps.nowFn ? deps.nowFn() : Date.now();
  const getPending = deps.getPendingSyncDiagnosticsFn ?? getPendingSyncDiagnostics;
  const getUser = deps.getCurrentUserFn ?? getCurrentUser;
  const runSyncUserData = deps.syncUserDataFn ?? syncUserData;
  refreshDailyWriteBudgetState();
  refreshDailyReadBudgetState();

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
      readCount: sessionReadCount,
      readBudgetLimit: DEFAULT_READ_BUDGET_LIMIT,
      readBudgetExceeded,
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
      readCount: sessionReadCount,
      readBudgetLimit: DEFAULT_READ_BUDGET_LIMIT,
      readBudgetExceeded,
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
      readCount: sessionReadCount,
      readBudgetLimit: DEFAULT_READ_BUDGET_LIMIT,
      readBudgetExceeded,
      retryLimit: DEFAULT_RETRY_LIMIT,
      errorCode: null,
      pendingCount: pending.pendingCount,
    };
  }

  if (intent === "auto") {
    const pending = await getPending();
    if (pending.pendingCount === 0) {
      return {
        success: false,
        message: "No local changes pending. Skipping automatic cloud sync.",
        retryable: false,
        permissionDenied: false,
        throttled: true,
        writeLoopTriggered: consumeWriteLoopTriggered(),
        writeBudgetExceeded,
        writeCount: sessionWriteCount,
        writeBudgetLimit: DEFAULT_WRITE_BUDGET_LIMIT,
        readCount: sessionReadCount,
        readBudgetLimit: DEFAULT_READ_BUDGET_LIMIT,
        readBudgetExceeded,
        retryLimit: DEFAULT_RETRY_LIMIT,
        errorCode: null,
        pendingCount: pending.pendingCount,
      };
    }
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
        readCount: sessionReadCount,
        readBudgetLimit: DEFAULT_READ_BUDGET_LIMIT,
        readBudgetExceeded,
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
      readCount: sessionReadCount,
      readBudgetLimit: DEFAULT_READ_BUDGET_LIMIT,
      readBudgetExceeded,
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
      readCount: sessionReadCount,
      readBudgetLimit: DEFAULT_READ_BUDGET_LIMIT,
      readBudgetExceeded,
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

  const [rawByUserId, rawByOwnerId, normalizedByUserId, normalizedByOwnerId] = await Promise.all([
    trackedGetDocs(getDocs(query(textbooksRef, where("userId", "==", userId), where("isbnRaw", "==", raw)))),
    trackedGetDocs(getDocs(query(textbooksRef, where("ownerId", "==", userId), where("isbnRaw", "==", raw)))),
    normalized
      ? trackedGetDocs(getDocs(query(textbooksRef, where("userId", "==", userId), where("isbnNormalized", "==", normalized))))
      : Promise.resolve(null),
    normalized
      ? trackedGetDocs(getDocs(query(textbooksRef, where("ownerId", "==", userId), where("isbnNormalized", "==", normalized))))
      : Promise.resolve(null),
  ]);

  const rawCandidates = mergeDocsByPath(rawByUserId.docs, rawByOwnerId.docs);
  const normalizedCandidates = mergeDocsByPath(
    normalizedByUserId ? normalizedByUserId.docs : [],
    normalizedByOwnerId ? normalizedByOwnerId.docs : []
  );

  logSyncEvent("read:success", rawPath, { docs: rawCandidates.length });
  if (normalized) {
    logSyncEvent("read:success", normalizedPath, { docs: normalizedCandidates.length });
  }

  const candidates = mergeDocsByPath(rawCandidates, normalizedCandidates);

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

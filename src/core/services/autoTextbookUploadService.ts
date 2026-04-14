import { collection, deleteDoc, doc, getDoc, getDocs } from "firebase/firestore";

import type { Chapter, Section, Textbook } from "../models";
import { getAll, save, STORE_NAMES } from "./db";
import { normalizeISBN } from "./isbnService";
import { syncNow } from "./syncService";
import { appendDebugLogEntry } from "./debugLogService";
import { logDesignSystemDebugEvent } from "./designSystemService";
import { recordCacheDetection, recordCacheUsage } from "./cacheTelemetryService";
import { getCurrentUser } from "../../firebase/auth";
import { firestoreDb } from "../../firebase/firestore";
import { useUIStore } from "../../webapp/store/uiStore";

const AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY = "courseforge.autoTextbookUpload.v1";
const AUTO_TEXTBOOK_DUPLICATE_PREFERENCES_KEY = "courseforge.autoTextbookDuplicatePreferences.v1";
const AUTO_TEXTBOOK_UPLOAD_CONTROL_KEY = "courseforge.autoTextbookUpload.control.v1";
const UPLOAD_POLL_INTERVAL_MS = 350;
const STUCK_PREPARING_THRESHOLD_MS = 45_000;
const UPLOAD_SYNC_TIMEOUT_MS = 45_000;
const MAX_SYNC_ATTEMPTS = 3;
const THROTTLE_RETRY_DELAY_MS = 5_250;

type SyncNowResult = Awaited<ReturnType<typeof syncNow>>;
type UploadTraceCallback = (event: {
  category: "communication" | "upload" | "error";
  action: string;
  message: string;
  severity?: "info" | "warning" | "error";
  details?: Record<string, unknown>;
}) => void;

type UploadControlAction = "none" | "cancel" | "delete" | "force-remove";

interface AutoTextbookUploadControlState {
  sessionId: string;
  action: UploadControlAction;
  reason?: string;
  requestedAt: string;
}

export type AutoTextbookUploadStatus = "preparing" | "uploading" | "paused" | "failed" | "completed" | "corrupt-restart";
export type AutoTextbookUploadPhase = "persisting" | "integrity-check" | "uploading" | "resuming" | "completed" | "failed";
export type AutoDuplicateResolutionPreference = "overwrite_auto" | "merge_dedupe" | "keep_both";

export interface AutoTextbookUploadSnapshot {
  sessionId: string;
  textbookId: string;
  title: string;
  isbnRaw: string;
  status: AutoTextbookUploadStatus;
  phase: AutoTextbookUploadPhase;
  message: string;
  totalItems: number;
  completedItems: number;
  pendingItems: number;
  percentComplete: number;
  writeCount: number;
  readCount: number;
  integrityState: "unknown" | "verified" | "resume-needed" | "corrupt";
  canResume: boolean;
  startedAt: string;
  updatedAt: string;
}

interface LocalHierarchySummary {
  textbook: Textbook;
  chapters: Chapter[];
  sections: Section[];
}

interface CloudHierarchySummary {
  textbookPresent: boolean;
  ownerMismatch: boolean;
  chapterIds: string[];
  sectionIds: string[];
}

interface LocalHierarchyProgress extends LocalHierarchySummary {
  totalItems: number;
  pendingItems: number;
  completedItems: number;
}

function isPlaceholderTextbookId(textbookId: string): boolean {
  const normalized = textbookId.trim().toLowerCase();
  return normalized.length === 0 || normalized === "pending";
}

function toEpoch(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function resolveResumeTextbookId(snapshot: AutoTextbookUploadSnapshot): Promise<string | null> {
  if (!isPlaceholderTextbookId(snapshot.textbookId)) {
    return snapshot.textbookId;
  }

  const textbooks = await getAll(STORE_NAMES.textbooks) as Textbook[];
  if (textbooks.length === 0) {
    return null;
  }

  const normalizedIsbn = normalizeISBN(snapshot.isbnRaw);
  const normalizedTitle = snapshot.title.trim().toLowerCase();

  const scopedMatches = textbooks.filter((textbook) => {
    const textbookIsbn = normalizeISBN(textbook.isbnRaw);
    const isbnMatch = normalizedIsbn.length > 0 && textbookIsbn === normalizedIsbn;
    const titleMatch = normalizedTitle.length > 0 && textbook.title.trim().toLowerCase() === normalizedTitle;
    return isbnMatch || titleMatch;
  });

  const candidates = scopedMatches.length > 0 ? scopedMatches : textbooks;
  const ranked = [...candidates].sort((left, right) => {
    if (left.pendingSync !== right.pendingSync) {
      return left.pendingSync ? -1 : 1;
    }

    const leftStamp = Math.max(toEpoch(left.lastModified), toEpoch(left.updatedAt), toEpoch(left.createdAt));
    const rightStamp = Math.max(toEpoch(right.lastModified), toEpoch(right.updatedAt), toEpoch(right.createdAt));
    return rightStamp - leftStamp;
  });

  return ranked[0]?.id ?? null;
}

function readFromStorage<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeToStorage<T>(key: string, value: T | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function readUploadControlState(): AutoTextbookUploadControlState | null {
  return readFromStorage<AutoTextbookUploadControlState>(AUTO_TEXTBOOK_UPLOAD_CONTROL_KEY);
}

function writeUploadControlState(value: AutoTextbookUploadControlState | null): void {
  writeToStorage(AUTO_TEXTBOOK_UPLOAD_CONTROL_KEY, value);
}

function clearUploadControlState(): void {
  writeUploadControlState(null);
}

function getRequestedUploadAction(sessionId: string): UploadControlAction {
  const state = readUploadControlState();
  if (!state || state.sessionId !== sessionId) {
    return "none";
  }

  return state.action;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Retroactive data sanitization: strip unknown fields from textbook data to prevent server rejection
const VALID_TEXTBOOK_FIELDS = new Set([
  "id", "sourceType", "userId", "originalLanguage", "translatedFields",
  "title", "subtitle", "grade", "gradeBand", "subject", "edition",
  "publicationYear", "copyrightYear", "isbnRaw", "isbnNormalized",
  "additionalIsbns", "relatedIsbns", "seriesName", "publisher", "publisherLocation",
  "mhid", "authors", "tocExtractionConfidence", "imageModerationState",
  "imageModerationReason", "imageModerationConfidence", "cloudSyncBlockedReason",
  "requiresAdminReview", "platformUrl", "coverImageUrl", "createdAt", "updatedAt",
  "lastModified", "pendingSync", "source", "isFavorite", "isArchived", "status", "isDeleted",
]);

const VALID_CHAPTER_FIELDS = new Set([
  "id", "sourceType", "userId", "textbookId", "index", "name", "description",
  "lastModified", "pendingSync", "source", "status", "isDeleted",
]);

const VALID_SECTION_FIELDS = new Set([
  "id", "sourceType", "userId", "textbookId", "chapterId", "index", "title",
  "notes", "lastModified", "pendingSync", "source", "status", "isDeleted",
]);

function sanitizeTextbookData(input: Record<string, unknown>): { cleaned: Textbook; removedFields: string[] } {
  const removedFields: string[] = [];
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (VALID_TEXTBOOK_FIELDS.has(key)) {
      cleaned[key] = value;
    } else {
      removedFields.push(key);
    }
  }

  return { cleaned: cleaned as unknown as Textbook, removedFields };
}

function sanitizeChapterData(input: Record<string, unknown>): { cleaned: Chapter; removedFields: string[] } {
  const removedFields: string[] = [];
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (VALID_CHAPTER_FIELDS.has(key)) {
      cleaned[key] = value;
    } else {
      removedFields.push(key);
    }
  }

  return { cleaned: cleaned as unknown as Chapter, removedFields };
}

function sanitizeSectionData(input: Record<string, unknown>): { cleaned: Section; removedFields: string[] } {
  const removedFields: string[] = [];
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (VALID_SECTION_FIELDS.has(key)) {
      cleaned[key] = value;
    } else {
      removedFields.push(key);
    }
  }

  return { cleaned: cleaned as unknown as Section, removedFields };
}

async function applyRetroactiveDataCleanupToQueue(): Promise<{
  textbooksProcessed: number;
  chaptersProcessed: number;
  sectionsProcessed: number;
  fieldsRemoved: Record<string, number>;
}> {
  const result = {
    textbooksProcessed: 0,
    chaptersProcessed: 0,
    sectionsProcessed: 0,
    fieldsRemoved: {} as Record<string, number>,
  };

  try {
    // Clean textbooks
    const textbooks = (await getAll(STORE_NAMES.textbooks)) as Textbook[];
    for (const textbook of textbooks) {
      const { cleaned, removedFields } = sanitizeTextbookData(textbook as unknown as Record<string, unknown>);
      if (removedFields.length > 0) {
        await save(STORE_NAMES.textbooks, cleaned);
        result.textbooksProcessed += 1;
        for (const field of removedFields) {
          result.fieldsRemoved[field] = (result.fieldsRemoved[field] ?? 0) + 1;
        }
        void logDesignSystemDebugEvent("Retroactive textbook data cleanup applied.", {
          textbookId: textbook.id,
          removedFields,
        });
      }
    }

    // Clean chapters
    const chapters = (await getAll(STORE_NAMES.chapters)) as Chapter[];
    for (const chapter of chapters) {
      const { cleaned, removedFields } = sanitizeChapterData(chapter as unknown as Record<string, unknown>);
      if (removedFields.length > 0) {
        await save(STORE_NAMES.chapters, cleaned);
        result.chaptersProcessed += 1;
        for (const field of removedFields) {
          result.fieldsRemoved[field] = (result.fieldsRemoved[field] ?? 0) + 1;
        }
      }
    }

    // Clean sections
    const sections = (await getAll(STORE_NAMES.sections)) as Section[];
    for (const section of sections) {
      const { cleaned, removedFields } = sanitizeSectionData(section as unknown as Record<string, unknown>);
      if (removedFields.length > 0) {
        await save(STORE_NAMES.sections, cleaned);
        result.sectionsProcessed += 1;
        for (const field of removedFields) {
          result.fieldsRemoved[field] = (result.fieldsRemoved[field] ?? 0) + 1;
        }
      }
    }

    void logDesignSystemDebugEvent("Retroactive data cleanup completed on all queued items.", result);
  } catch (error) {
    void logDesignSystemDebugEvent("Retroactive data cleanup failed.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}

function buildSnapshot(input: {
  base?: AutoTextbookUploadSnapshot | null;
  sessionId: string;
  textbookId: string;
  title: string;
  isbnRaw: string;
  status: AutoTextbookUploadStatus;
  phase: AutoTextbookUploadPhase;
  message: string;
  totalItems: number;
  completedItems: number;
  pendingItems: number;
  writeCount?: number;
  readCount?: number;
  integrityState?: AutoTextbookUploadSnapshot["integrityState"];
  canResume?: boolean;
}): AutoTextbookUploadSnapshot {
  const totalItems = Math.max(0, input.totalItems);
  const completedItems = Math.max(0, Math.min(totalItems, input.completedItems));
  const pendingItems = Math.max(0, input.pendingItems);
  const percentComplete = totalItems > 0
    ? clampPercent((completedItems / totalItems) * 100)
    : 0;

  return {
    sessionId: input.sessionId,
    textbookId: input.textbookId,
    title: input.title,
    isbnRaw: input.isbnRaw,
    status: input.status,
    phase: input.phase,
    message: input.message,
    totalItems,
    completedItems,
    pendingItems,
    percentComplete,
    writeCount: input.writeCount ?? input.base?.writeCount ?? 0,
    readCount: input.readCount ?? input.base?.readCount ?? 0,
    integrityState: input.integrityState ?? input.base?.integrityState ?? "unknown",
    canResume: input.canResume ?? input.base?.canResume ?? false,
    startedAt: input.base?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function publishSnapshot(snapshot: AutoTextbookUploadSnapshot | null): void {
  writeToStorage(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY, snapshot);
  if (snapshot) {
    useUIStore.getState().setAutoTextbookUpload(snapshot);
  } else {
    useUIStore.getState().clearAutoTextbookUpload();
  }
}

export function readPersistedAutoTextbookUpload(): AutoTextbookUploadSnapshot | null {
  const snapshot = readFromStorage<AutoTextbookUploadSnapshot>(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY);
  if (snapshot) {
    recordCacheDetection({
      layer: "cached-upload-state",
      identifier: AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY,
      component: "auto-upload-service",
      details: {
        sessionId: snapshot.sessionId,
        status: snapshot.status,
        updatedAt: snapshot.updatedAt,
      },
    });
  }

  return snapshot;
}

export function hydratePersistedAutoTextbookUpload(): AutoTextbookUploadSnapshot | null {
  const snapshot = readPersistedAutoTextbookUpload();
  if (snapshot) {
    recordCacheUsage({
      layer: "cached-upload-state",
      identifier: AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY,
      component: "auto-upload-service",
      status: "used",
      reason: "Hydrating persisted upload state on startup.",
      details: {
        sessionId: snapshot.sessionId,
        status: snapshot.status,
      },
    });
    useUIStore.getState().setAutoTextbookUpload(snapshot);
  }
  return snapshot;
}

export function clearPersistedAutoTextbookUpload(): void {
  recordCacheUsage({
    layer: "cached-upload-state",
    identifier: AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY,
    component: "auto-upload-service",
    status: "ignored",
    reason: "Clearing persisted upload cache state.",
  });
  publishSnapshot(null);
  clearUploadControlState();
}

export function initAutoTextbookUploadTracking(snapshot: AutoTextbookUploadSnapshot): void {
  clearUploadControlState();
  publishSnapshot(snapshot);
}

function shouldAllowPendingUploadDelete(status: AutoTextbookUploadStatus): boolean {
  return status === "preparing" || status === "paused" || status === "failed" || status === "corrupt-restart";
}

export function isAutoTextbookUploadStuck(snapshot: AutoTextbookUploadSnapshot, nowMs = Date.now()): boolean {
  if (snapshot.status !== "preparing") {
    return false;
  }

  const updatedAt = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    return false;
  }

  const stuck = (nowMs - updatedAt) >= STUCK_PREPARING_THRESHOLD_MS;
  if (stuck) {
    recordCacheUsage({
      layer: "cached-upload-state",
      identifier: AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY,
      component: "auto-upload-service",
      status: "stale",
      reason: "Upload state stuck in preparing threshold window.",
      details: {
        updatedAt: snapshot.updatedAt,
        thresholdMs: STUCK_PREPARING_THRESHOLD_MS,
      },
    });
  }

  return stuck;
}

export async function requestCancelAutoTextbookUpload(reason = "User canceled pending upload."): Promise<boolean> {
  const snapshot = readPersistedAutoTextbookUpload() ?? useUIStore.getState().activeAutoTextbookUpload;
  if (!snapshot) {
    return false;
  }

  writeUploadControlState({
    sessionId: snapshot.sessionId,
    action: "cancel",
    reason,
    requestedAt: new Date().toISOString(),
  });

  const pausedSnapshot = buildSnapshot({
    base: snapshot,
    sessionId: snapshot.sessionId,
    textbookId: snapshot.textbookId,
    title: snapshot.title,
    isbnRaw: snapshot.isbnRaw,
    status: "paused",
    phase: "failed",
    message: "Upload canceled by user.",
    totalItems: snapshot.totalItems,
    completedItems: snapshot.completedItems,
    pendingItems: snapshot.pendingItems,
    integrityState: snapshot.integrityState,
    canResume: false,
  });
  publishSnapshot(pausedSnapshot);

  await appendDebugLogEntry({
    eventType: "user_action",
    message: "Auto textbook upload canceled.",
    autoModeStep: "manual",
    context: {
      sessionId: snapshot.sessionId,
      textbookId: snapshot.textbookId,
      status: snapshot.status,
      reason,
    },
  });

  return true;
}

export async function deletePendingAutoTextbookUpload(reason = "User deleted pending upload."): Promise<boolean> {
  const snapshot = readPersistedAutoTextbookUpload() ?? useUIStore.getState().activeAutoTextbookUpload;
  if (!snapshot || !shouldAllowPendingUploadDelete(snapshot.status)) {
    return false;
  }

  writeUploadControlState({
    sessionId: snapshot.sessionId,
    action: "delete",
    reason,
    requestedAt: new Date().toISOString(),
  });

  clearPersistedAutoTextbookUpload();
  await appendDebugLogEntry({
    eventType: "user_action",
    message: "Pending auto textbook upload deleted.",
    autoModeStep: "manual",
    context: {
      sessionId: snapshot.sessionId,
      textbookId: snapshot.textbookId,
      status: snapshot.status,
      reason,
    },
  });

  return true;
}

export async function forceRemoveAutoTextbookUpload(reason = "Upload force-removed from limbo state."): Promise<boolean> {
  const snapshot = readPersistedAutoTextbookUpload() ?? useUIStore.getState().activeAutoTextbookUpload;
  if (!snapshot) {
    return false;
  }

  writeUploadControlState({
    sessionId: snapshot.sessionId,
    action: "force-remove",
    reason,
    requestedAt: new Date().toISOString(),
  });

  clearPersistedAutoTextbookUpload();
  await appendDebugLogEntry({
    eventType: "warning",
    message: "Auto textbook upload force-removed.",
    autoModeStep: "manual",
    context: {
      sessionId: snapshot.sessionId,
      textbookId: snapshot.textbookId,
      status: snapshot.status,
      reason,
    },
  });

  return true;
}

function readDuplicatePreferences(): Record<string, AutoDuplicateResolutionPreference> {
  return readFromStorage<Record<string, AutoDuplicateResolutionPreference>>(AUTO_TEXTBOOK_DUPLICATE_PREFERENCES_KEY) ?? {};
}

export function getRememberedAutoDuplicatePreference(isbnRaw: string): AutoDuplicateResolutionPreference | null {
  const normalized = normalizeISBN(isbnRaw);
  if (!normalized) {
    return null;
  }

  return readDuplicatePreferences()[normalized] ?? null;
}

export function rememberAutoDuplicatePreference(isbnRaw: string, preference: AutoDuplicateResolutionPreference): void {
  const normalized = normalizeISBN(isbnRaw);
  if (!normalized) {
    return;
  }

  const preferences = readDuplicatePreferences();
  preferences[normalized] = preference;
  writeToStorage(AUTO_TEXTBOOK_DUPLICATE_PREFERENCES_KEY, preferences);
}

async function getLocalHierarchySummary(textbookId: string): Promise<LocalHierarchySummary | null> {
  const [textbooks, chapters, sections] = await Promise.all([
    getAll(STORE_NAMES.textbooks) as Promise<Textbook[]>,
    getAll(STORE_NAMES.chapters) as Promise<Chapter[]>,
    getAll(STORE_NAMES.sections) as Promise<Section[]>,
  ]);

  const textbook = textbooks.find((item) => item.id === textbookId);
  if (!textbook) {
    return null;
  }

  const textbookChapters = chapters.filter((chapter) => chapter.textbookId === textbookId);
  const chapterIds = new Set(textbookChapters.map((chapter) => chapter.id));
  const textbookSections = sections.filter((section) => chapterIds.has(section.chapterId));

  return {
    textbook,
    chapters: textbookChapters,
    sections: textbookSections,
  };
}

async function getLocalHierarchyProgress(textbookId: string): Promise<LocalHierarchyProgress | null> {
  const summary = await getLocalHierarchySummary(textbookId);
  if (!summary) {
    return null;
  }

  const entities = [summary.textbook, ...summary.chapters, ...summary.sections];
  const pendingItems = entities.filter((item) => item.pendingSync).length;
  const totalItems = entities.length;

  return {
    ...summary,
    totalItems,
    pendingItems,
    completedItems: totalItems - pendingItems,
  };
}

async function fetchCloudHierarchySummary(userId: string, textbookId: string): Promise<CloudHierarchySummary> {
  const textbookRef = doc(firestoreDb, "textbooks", textbookId);
  const textbookSnap = await getDoc(textbookRef);

  if (!textbookSnap.exists()) {
    return {
      textbookPresent: false,
      ownerMismatch: false,
      chapterIds: [],
      sectionIds: [],
    };
  }

  const textbookData = textbookSnap.data() as { userId?: string; ownerId?: string };
  const ownerMismatch = Boolean(
    textbookData.userId
    && textbookData.userId !== userId
    && textbookData.ownerId !== userId
  );

  const chapterSnapshot = await getDocs(collection(textbookRef, "chapters"));
  const chapterIds = chapterSnapshot.docs.map((chapterDoc) => chapterDoc.id);
  const sectionSnapshots = await Promise.all(
    chapterSnapshot.docs.map((chapterDoc) => getDocs(collection(chapterDoc.ref, "sections")))
  );

  return {
    textbookPresent: true,
    ownerMismatch,
    chapterIds,
    sectionIds: sectionSnapshots.flatMap((snapshot) => snapshot.docs.map((sectionDoc) => sectionDoc.id)),
  };
}

function assessCloudIntegrity(local: LocalHierarchySummary, cloud: CloudHierarchySummary): {
  state: AutoTextbookUploadSnapshot["integrityState"];
  message: string;
} {
  const localChapterIds = new Set(local.chapters.map((chapter) => chapter.id));
  const localSectionIds = new Set(local.sections.map((section) => section.id));
  const extraCloudChapterIds = cloud.chapterIds.filter((chapterId) => !localChapterIds.has(chapterId));
  const extraCloudSectionIds = cloud.sectionIds.filter((sectionId) => !localSectionIds.has(sectionId));

  if (cloud.ownerMismatch) {
    return {
      state: "corrupt",
      message: "Cloud hierarchy belongs to a different user. Restarting upload from a clean cloud copy.",
    };
  }

  if (!cloud.textbookPresent && (cloud.chapterIds.length > 0 || cloud.sectionIds.length > 0)) {
    return {
      state: "corrupt",
      message: "Cloud hierarchy is missing its textbook record. Restarting upload from scratch.",
    };
  }

  if (extraCloudChapterIds.length > 0 || extraCloudSectionIds.length > 0) {
    return {
      state: "corrupt",
      message: "Unexpected cloud hierarchy data was found. Restarting upload from a clean cloud copy.",
    };
  }

  const missingChapterIds = local.chapters.filter((chapter) => !cloud.chapterIds.includes(chapter.id));
  const missingSectionIds = local.sections.filter((section) => !cloud.sectionIds.includes(section.id));

  if (!cloud.textbookPresent || missingChapterIds.length > 0 || missingSectionIds.length > 0) {
    return {
      state: "resume-needed",
      message: "Found a partial cloud upload. Resuming only the pieces that are still missing.",
    };
  }

  return {
    state: "verified",
    message: "Cloud hierarchy is already complete and verified.",
  };
}

async function updateLocalEntitySyncState(summary: LocalHierarchySummary, cloud: CloudHierarchySummary, userId: string): Promise<void> {
  const cloudChapterIds = new Set(cloud.chapterIds);
  const cloudSectionIds = new Set(cloud.sectionIds);

  await save(STORE_NAMES.textbooks, {
    ...summary.textbook,
    userId,
    pendingSync: !cloud.textbookPresent,
    source: cloud.textbookPresent ? "cloud" : summary.textbook.source,
  });

  await Promise.all(summary.chapters.map(async (chapter) => {
    const inCloud = cloudChapterIds.has(chapter.id);
    await save(STORE_NAMES.chapters, {
      ...chapter,
      userId,
      pendingSync: !inCloud,
      source: inCloud ? "cloud" : chapter.source,
    });
  }));

  await Promise.all(summary.sections.map(async (section) => {
    const inCloud = cloudSectionIds.has(section.id);
    await save(STORE_NAMES.sections, {
      ...section,
      userId,
      pendingSync: !inCloud,
      source: inCloud ? "cloud" : section.source,
    });
  }));
}

async function resetLocalHierarchyToPending(summary: LocalHierarchySummary): Promise<void> {
  await save(STORE_NAMES.textbooks, {
    ...summary.textbook,
    pendingSync: true,
    source: "local",
  });

  await Promise.all(summary.chapters.map(async (chapter) => {
    await save(STORE_NAMES.chapters, {
      ...chapter,
      pendingSync: true,
      source: "local",
    });
  }));

  await Promise.all(summary.sections.map(async (section) => {
    await save(STORE_NAMES.sections, {
      ...section,
      pendingSync: true,
      source: "local",
    });
  }));
}

async function deleteCloudHierarchy(summary: LocalHierarchySummary): Promise<void> {
  await Promise.all(summary.sections.map(async (section) => {
    await deleteDoc(doc(firestoreDb, `textbooks/${summary.textbook.id}/chapters/${section.chapterId}/sections/${section.id}`));
  }));

  await Promise.all(summary.chapters.map(async (chapter) => {
    await deleteDoc(doc(firestoreDb, `textbooks/${summary.textbook.id}/chapters/${chapter.id}`));
  }));

  await deleteDoc(doc(firestoreDb, `textbooks/${summary.textbook.id}`));
}

function startProgressPoll(input: {
  snapshot: AutoTextbookUploadSnapshot;
  onSnapshot: (snapshot: AutoTextbookUploadSnapshot) => void;
}): number {
  return window.setInterval(() => {
    void (async () => {
      const progress = await getLocalHierarchyProgress(input.snapshot.textbookId);
      if (!progress) {
        return;
      }

      input.onSnapshot(buildSnapshot({
        base: input.snapshot,
        sessionId: input.snapshot.sessionId,
        textbookId: input.snapshot.textbookId,
        title: input.snapshot.title,
        isbnRaw: input.snapshot.isbnRaw,
        status: "uploading",
        phase: input.snapshot.phase,
        message: progress.pendingItems > 0
          ? `Uploading textbook to cloud... ${progress.completedItems}/${progress.totalItems} items synced.`
          : "Finalizing cloud upload...",
        totalItems: progress.totalItems,
        completedItems: progress.completedItems,
        pendingItems: progress.pendingItems,
        canResume: true,
      }));
    })();
  }, UPLOAD_POLL_INTERVAL_MS);
}

function emitUploadTrace(trace: UploadTraceCallback | undefined, event: {
  category: "communication" | "upload" | "error";
  action: string;
  message: string;
  severity?: "info" | "warning" | "error";
  details?: Record<string, unknown>;
}): void {
  if (!trace) {
    return;
  }

  trace(event);
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function runSyncWithTimeout(): Promise<SyncNowResult> {
  let timeoutId: number | null = null;
  try {
    return await Promise.race([
      syncNow({ intent: "manual" }),
      new Promise<SyncNowResult>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(Object.assign(new Error("Cloud sync timeout"), { code: "timeout" }));
        }, UPLOAD_SYNC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

function timeoutResultTemplate(message: string): SyncNowResult {
  return {
    success: false,
    message,
    retryable: true,
    permissionDenied: false,
    throttled: false,
    writeLoopTriggered: false,
    writeBudgetExceeded: false,
    writeCount: 0,
    writeBudgetLimit: 500,
    readCount: 0,
    readBudgetLimit: 5000,
    readBudgetExceeded: false,
    retryLimit: 3,
    errorCode: "timeout",
    pendingCount: 0,
  };
}

function normalizeUploadFailureResult(result: SyncNowResult): SyncNowResult {
  if (result.success) {
    return result;
  }

  if (result.throttled) {
    return {
      ...result,
      retryable: true,
      message: "Upload sync was throttled by recent activity. Wait a few seconds and resume upload.",
    };
  }

  return result;
}

export async function runTrackedAutoTextbookCloudUpload(input: {
  sessionId: string;
  textbookId: string;
  title: string;
  isbnRaw: string;
  trace?: UploadTraceCallback;
}): Promise<Awaited<ReturnType<typeof syncNow>>> {
  // Apply retroactive data cleanup before attempting upload
  const cleanupResult = await applyRetroactiveDataCleanupToQueue();
  if (Object.keys(cleanupResult.fieldsRemoved).length > 0) {
    emitUploadTrace(input.trace, {
      category: "communication",
      action: "retroactive_cleanup_applied",
      message: "Applied retroactive data cleanup to queued items to prevent schema rejection.",
      severity: "info",
      details: cleanupResult,
    });
  }

  emitUploadTrace(input.trace, {
    category: "communication",
    action: "cloud_upload_payload_prepared",
    message: "Prepared cloud upload request payload.",
    details: {
      sessionId: input.sessionId,
      textbookId: input.textbookId,
      title: input.title,
      isbnRaw: input.isbnRaw,
    },
  });

  const requestedAction = getRequestedUploadAction(input.sessionId);
  if (requestedAction === "cancel" || requestedAction === "delete" || requestedAction === "force-remove") {
    clearUploadControlState();
    return {
      success: false,
      message: "Upload canceled before cloud sync started.",
      retryable: false,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: false,
      writeBudgetExceeded: false,
      writeCount: 0,
      writeBudgetLimit: 500,
      readCount: 0,
      readBudgetLimit: 5000,
      readBudgetExceeded: false,
      retryLimit: 3,
      errorCode: "cancelled",
      pendingCount: 0,
    };
  }

  const user = getCurrentUser();
  const localSummary = await getLocalHierarchySummary(input.textbookId);
  if (!user?.uid || !localSummary) {
    const fallbackSnapshot = buildSnapshot({
      sessionId: input.sessionId,
      textbookId: input.textbookId,
      title: input.title,
      isbnRaw: input.isbnRaw,
      status: "uploading",
      phase: "uploading",
      message: "Uploading textbook to cloud...",
      totalItems: 0,
      completedItems: 0,
      pendingItems: 0,
      canResume: false,
    });
    publishSnapshot(fallbackSnapshot);
    const fallbackResult = await syncNow({ intent: "manual" });

    if (fallbackResult.success) {
      publishSnapshot(buildSnapshot({
        base: fallbackSnapshot,
        sessionId: input.sessionId,
        textbookId: input.textbookId,
        title: input.title,
        isbnRaw: input.isbnRaw,
        status: "completed",
        phase: "completed",
        message: "Textbook upload completed.",
        totalItems: 0,
        completedItems: 0,
        pendingItems: 0,
        writeCount: fallbackResult.writeCount,
        readCount: fallbackResult.readCount,
        integrityState: "unknown",
        canResume: false,
      }));
    }

    return fallbackResult;
  }

  const initialProgress = await getLocalHierarchyProgress(input.textbookId);
  const seedSnapshot = buildSnapshot({
    sessionId: input.sessionId,
    textbookId: input.textbookId,
    title: input.title,
    isbnRaw: input.isbnRaw,
    status: "preparing",
    phase: "integrity-check",
    message: "Checking what is already in the cloud before upload resumes.",
    totalItems: initialProgress?.totalItems ?? 0,
    completedItems: initialProgress?.completedItems ?? 0,
    pendingItems: initialProgress?.pendingItems ?? 0,
    canResume: true,
  });
  publishSnapshot(seedSnapshot);

  let cloudSummary: CloudHierarchySummary;
  try {
    cloudSummary = await fetchCloudHierarchySummary(user.uid, input.textbookId);
    emitUploadTrace(input.trace, {
      category: "communication",
      action: "cloud_integrity_response_received",
      message: "Received cloud hierarchy response for integrity checks.",
      details: {
        textbookPresent: cloudSummary.textbookPresent,
        ownerMismatch: cloudSummary.ownerMismatch,
        cloudChapterCount: cloudSummary.chapterIds.length,
        cloudSectionCount: cloudSummary.sectionIds.length,
      },
    });
  } catch (err) {
    const pausedSnapshot = buildSnapshot({
      base: seedSnapshot,
      sessionId: input.sessionId,
      textbookId: input.textbookId,
      title: input.title,
      isbnRaw: input.isbnRaw,
      status: "paused",
      phase: "failed",
      message: "Cloud check failed. Tap Resume Upload to try again.",
      totalItems: seedSnapshot.totalItems,
      completedItems: seedSnapshot.completedItems,
      pendingItems: seedSnapshot.pendingItems,
      canResume: true,
    });
    publishSnapshot(pausedSnapshot);
    emitUploadTrace(input.trace, {
      category: "error",
      action: "cloud_integrity_response_failed",
      severity: "error",
      message: "Cloud integrity request failed before upload.",
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
  const integrity = assessCloudIntegrity(localSummary, cloudSummary);

  let workingSnapshot = buildSnapshot({
    base: seedSnapshot,
    sessionId: input.sessionId,
    textbookId: input.textbookId,
    title: input.title,
    isbnRaw: input.isbnRaw,
    status: integrity.state === "corrupt" ? "corrupt-restart" : "preparing",
    phase: "integrity-check",
    message: integrity.message,
    totalItems: seedSnapshot.totalItems,
    completedItems: seedSnapshot.completedItems,
    pendingItems: seedSnapshot.pendingItems,
    integrityState: integrity.state,
    canResume: true,
  });
  publishSnapshot(workingSnapshot);
  emitUploadTrace(input.trace, {
    category: integrity.state === "corrupt" ? "error" : "upload",
    action: "cloud_integrity_assessed",
    severity: integrity.state === "corrupt" ? "warning" : "info",
    message: integrity.message,
    details: {
      integrityState: integrity.state,
      localChapterCount: localSummary.chapters.length,
      localSectionCount: localSummary.sections.length,
    },
  });

  try {
    if (integrity.state === "corrupt") {
      await deleteCloudHierarchy(localSummary);
      await resetLocalHierarchyToPending(localSummary);
    } else {
      await updateLocalEntitySyncState(localSummary, cloudSummary, user.uid);
    }
  } catch (err) {
    const pausedSnapshot = buildSnapshot({
      base: workingSnapshot,
      sessionId: input.sessionId,
      textbookId: input.textbookId,
      title: input.title,
      isbnRaw: input.isbnRaw,
      status: "paused",
      phase: "failed",
      message: "Upload preparation failed. Tap Resume Upload to try again.",
      totalItems: workingSnapshot.totalItems,
      completedItems: workingSnapshot.completedItems,
      pendingItems: workingSnapshot.pendingItems,
      canResume: true,
    });
    publishSnapshot(pausedSnapshot);
    throw err;
  }

  const postIntegrityProgress = await getLocalHierarchyProgress(input.textbookId);
  if (postIntegrityProgress && postIntegrityProgress.pendingItems === 0) {
    const completedSnapshot = buildSnapshot({
      base: workingSnapshot,
      sessionId: input.sessionId,
      textbookId: input.textbookId,
      title: input.title,
      isbnRaw: input.isbnRaw,
      status: "completed",
      phase: "completed",
      message: "Cloud upload already matches the local textbook. No additional upload was needed.",
      totalItems: postIntegrityProgress.totalItems,
      completedItems: postIntegrityProgress.completedItems,
      pendingItems: 0,
      integrityState: "verified",
      canResume: false,
    });
    useUIStore.getState().setAutoTextbookUpload(completedSnapshot);
    writeToStorage(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY, null);
    clearUploadControlState();
    return {
      success: true,
      message: completedSnapshot.message,
      retryable: false,
      permissionDenied: false,
      throttled: false,
      writeLoopTriggered: false,
      writeBudgetExceeded: false,
      writeCount: 0,
      writeBudgetLimit: 500,
      readCount: 0,
      readBudgetLimit: 5000,
      readBudgetExceeded: false,
      retryLimit: 3,
      errorCode: null,
      pendingCount: 0,
    };
  }

  workingSnapshot = buildSnapshot({
    base: workingSnapshot,
    sessionId: input.sessionId,
    textbookId: input.textbookId,
    title: input.title,
    isbnRaw: input.isbnRaw,
    status: "uploading",
    phase: integrity.state === "resume-needed" ? "resuming" : "uploading",
    message: "Uploading textbook to cloud...",
    totalItems: postIntegrityProgress?.totalItems ?? workingSnapshot.totalItems,
    completedItems: postIntegrityProgress?.completedItems ?? workingSnapshot.completedItems,
    pendingItems: postIntegrityProgress?.pendingItems ?? workingSnapshot.pendingItems,
    integrityState: integrity.state,
    canResume: true,
  });
  publishSnapshot(workingSnapshot);

  let progressPollId: number | null = null;
  if (typeof window !== "undefined") {
    progressPollId = startProgressPoll({
      snapshot: workingSnapshot,
      onSnapshot: publishSnapshot,
    });
  }

  try {
    let syncAttempt = 0;
    let result: SyncNowResult = timeoutResultTemplate("Upload sync did not start.");

    while (syncAttempt < MAX_SYNC_ATTEMPTS) {
      syncAttempt += 1;
      emitUploadTrace(input.trace, {
        category: "communication",
        action: "cloud_sync_attempt_started",
        message: "Starting cloud sync attempt.",
        details: {
          attempt: syncAttempt,
          maxAttempts: MAX_SYNC_ATTEMPTS,
        },
      });

      try {
        result = await runSyncWithTimeout();
      } catch (error) {
        result = timeoutResultTemplate("Cloud sync timed out while uploading textbook data.");
        emitUploadTrace(input.trace, {
          category: "error",
          action: "cloud_sync_timeout",
          severity: "warning",
          message: "Cloud sync timed out during upload.",
          details: {
            attempt: syncAttempt,
            maxAttempts: MAX_SYNC_ATTEMPTS,
            timeoutMs: UPLOAD_SYNC_TIMEOUT_MS,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      if (!result.success && result.throttled && syncAttempt < MAX_SYNC_ATTEMPTS) {
        emitUploadTrace(input.trace, {
          category: "upload",
          action: "cloud_sync_throttled_retrying",
          severity: "warning",
          message: "Cloud sync was throttled. Retrying after cooldown.",
          details: {
            attempt: syncAttempt,
            maxAttempts: MAX_SYNC_ATTEMPTS,
            retryDelayMs: THROTTLE_RETRY_DELAY_MS,
            writeCount: result.writeCount,
            pendingCount: result.pendingCount,
          },
        });
        await waitMs(THROTTLE_RETRY_DELAY_MS);
        continue;
      }

      break;
    }

    const normalizedResult = normalizeUploadFailureResult(result);

    if (getRequestedUploadAction(input.sessionId) === "cancel") {
      clearUploadControlState();
      publishSnapshot(buildSnapshot({
        base: workingSnapshot,
        sessionId: input.sessionId,
        textbookId: input.textbookId,
        title: input.title,
        isbnRaw: input.isbnRaw,
        status: "paused",
        phase: "failed",
        message: "Upload canceled by user.",
        totalItems: workingSnapshot.totalItems,
        completedItems: workingSnapshot.completedItems,
        pendingItems: workingSnapshot.pendingItems,
        canResume: false,
      }));

      return {
        ...normalizedResult,
        success: false,
        retryable: false,
        errorCode: "cancelled",
        message: "Upload canceled by user.",
      };
    }

    const finalProgress = await getLocalHierarchyProgress(input.textbookId);

    if (!normalizedResult.success) {
      const shouldPause = normalizedResult.retryable
        || normalizedResult.throttled
        || normalizedResult.writeBudgetExceeded
        || normalizedResult.errorCode === "timeout"
        || normalizedResult.errorCode === "unavailable"
        || normalizedResult.errorCode === "network-request-failed";
      const failedSnapshot = buildSnapshot({
        base: workingSnapshot,
        sessionId: input.sessionId,
        textbookId: input.textbookId,
        title: input.title,
        isbnRaw: input.isbnRaw,
        status: shouldPause ? "paused" : "failed",
        phase: "failed",
        message: normalizedResult.message,
        totalItems: finalProgress?.totalItems ?? workingSnapshot.totalItems,
        completedItems: finalProgress?.completedItems ?? workingSnapshot.completedItems,
        pendingItems: finalProgress?.pendingItems ?? workingSnapshot.pendingItems,
        writeCount: normalizedResult.writeCount,
        readCount: normalizedResult.readCount,
        integrityState: workingSnapshot.integrityState,
        canResume: shouldPause,
      });
      publishSnapshot(failedSnapshot);
      emitUploadTrace(input.trace, {
        category: "error",
        action: "cloud_sync_attempt_failed",
        severity: "error",
        message: "Cloud upload sync attempt failed.",
        details: {
          message: normalizedResult.message,
          errorCode: normalizedResult.errorCode,
          throttled: normalizedResult.throttled,
          retryable: normalizedResult.retryable,
          writeBudgetExceeded: normalizedResult.writeBudgetExceeded,
          pendingCount: normalizedResult.pendingCount,
        },
      });
      return normalizedResult;
    }

    const completedSnapshot = buildSnapshot({
      base: workingSnapshot,
      sessionId: input.sessionId,
      textbookId: input.textbookId,
      title: input.title,
      isbnRaw: input.isbnRaw,
      status: "completed",
      phase: "completed",
      message: "Textbook upload completed and verified.",
      totalItems: finalProgress?.totalItems ?? workingSnapshot.totalItems,
      completedItems: finalProgress?.completedItems ?? workingSnapshot.totalItems,
      pendingItems: finalProgress?.pendingItems ?? 0,
      writeCount: normalizedResult.writeCount,
      readCount: normalizedResult.readCount,
      integrityState: "verified",
      canResume: false,
    });
    useUIStore.getState().setAutoTextbookUpload(completedSnapshot);
    writeToStorage(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY, null);
    clearUploadControlState();
    emitUploadTrace(input.trace, {
      category: "upload",
      action: "cloud_sync_completed",
      message: "Cloud upload sync completed successfully.",
      details: {
        writeCount: normalizedResult.writeCount,
        readCount: normalizedResult.readCount,
        pendingCount: normalizedResult.pendingCount,
      },
    });
    return normalizedResult;
  } finally {
    if (progressPollId !== null) {
      window.clearInterval(progressPollId);
    }
  }
}

export async function resumePersistedAutoTextbookUpload(): Promise<Awaited<ReturnType<typeof syncNow>> | null> {
  const persisted = readPersistedAutoTextbookUpload();
  if (!persisted || !persisted.canResume) {
    return null;
  }

  const resolvedTextbookId = await resolveResumeTextbookId(persisted);
  if (!resolvedTextbookId) {
    publishSnapshot(buildSnapshot({
      base: persisted,
      sessionId: persisted.sessionId,
      textbookId: persisted.textbookId,
      title: persisted.title,
      isbnRaw: persisted.isbnRaw,
      status: "failed",
      phase: "failed",
      message: "Resume could not find the local textbook record. Please save again.",
      totalItems: persisted.totalItems,
      completedItems: persisted.completedItems,
      pendingItems: persisted.pendingItems,
      integrityState: persisted.integrityState,
      canResume: false,
    }));
    return null;
  }

  if (resolvedTextbookId !== persisted.textbookId) {
    publishSnapshot(buildSnapshot({
      base: persisted,
      sessionId: persisted.sessionId,
      textbookId: resolvedTextbookId,
      title: persisted.title,
      isbnRaw: persisted.isbnRaw,
      status: "preparing",
      phase: "resuming",
      message: "Recovered local textbook session. Resuming cloud upload.",
      totalItems: persisted.totalItems,
      completedItems: persisted.completedItems,
      pendingItems: persisted.pendingItems,
      integrityState: persisted.integrityState,
      canResume: true,
    }));
  }

  return runTrackedAutoTextbookCloudUpload({
    sessionId: persisted.sessionId,
    textbookId: resolvedTextbookId,
    title: persisted.title,
    isbnRaw: persisted.isbnRaw,
  });
}
import { collection, deleteDoc, doc, getDoc, getDocs } from "firebase/firestore";

import type { Chapter, Section, Textbook } from "../models";
import { getAll, save, STORE_NAMES } from "./db";
import { normalizeISBN } from "./isbnService";
import { syncNow } from "./syncService";
import { getCurrentUser } from "../../firebase/auth";
import { firestoreDb } from "../../firebase/firestore";
import { useUIStore } from "../../webapp/store/uiStore";

const AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY = "courseforge.autoTextbookUpload.v1";
const AUTO_TEXTBOOK_DUPLICATE_PREFERENCES_KEY = "courseforge.autoTextbookDuplicatePreferences.v1";
const UPLOAD_POLL_INTERVAL_MS = 350;

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

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
  return readFromStorage<AutoTextbookUploadSnapshot>(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY);
}

export function hydratePersistedAutoTextbookUpload(): AutoTextbookUploadSnapshot | null {
  const snapshot = readPersistedAutoTextbookUpload();
  if (snapshot) {
    useUIStore.getState().setAutoTextbookUpload(snapshot);
  }
  return snapshot;
}

export function clearPersistedAutoTextbookUpload(): void {
  publishSnapshot(null);
}

export function initAutoTextbookUploadTracking(snapshot: AutoTextbookUploadSnapshot): void {
  publishSnapshot(snapshot);
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

export async function runTrackedAutoTextbookCloudUpload(input: {
  sessionId: string;
  textbookId: string;
  title: string;
  isbnRaw: string;
}): Promise<Awaited<ReturnType<typeof syncNow>>> {
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
    const result = await syncNow({ intent: "manual" });
    const finalProgress = await getLocalHierarchyProgress(input.textbookId);

    if (!result.success) {
      const failedSnapshot = buildSnapshot({
        base: workingSnapshot,
        sessionId: input.sessionId,
        textbookId: input.textbookId,
        title: input.title,
        isbnRaw: input.isbnRaw,
        status: result.retryable ? "paused" : "failed",
        phase: "failed",
        message: result.message,
        totalItems: finalProgress?.totalItems ?? workingSnapshot.totalItems,
        completedItems: finalProgress?.completedItems ?? workingSnapshot.completedItems,
        pendingItems: finalProgress?.pendingItems ?? workingSnapshot.pendingItems,
        writeCount: result.writeCount,
        readCount: result.readCount,
        integrityState: workingSnapshot.integrityState,
        canResume: true,
      });
      publishSnapshot(failedSnapshot);
      return result;
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
      writeCount: result.writeCount,
      readCount: result.readCount,
      integrityState: "verified",
      canResume: false,
    });
    useUIStore.getState().setAutoTextbookUpload(completedSnapshot);
    writeToStorage(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY, null);
    return result;
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
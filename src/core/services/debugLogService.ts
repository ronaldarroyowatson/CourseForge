import { openDB } from "idb";
import { httpsCallable } from "firebase/functions";

import { functionsClient } from "../../firebase/functions";
import { getCurrentUser } from "../../firebase/auth";

export type DebugEventType =
  | "auto_capture_start"
  | "auto_capture_complete"
  | "auto_crop_success"
  | "auto_crop_failure"
  | "ocr_success"
  | "ocr_failure"
  | "metadata_extracted"
  | "toc_extracted"
  | "toc_stitch"
  | "user_action"
  | "error"
  | "warning"
  | "info";

export interface DebugLogEntry {
  id: string;
  timestamp: number;
  eventType: DebugEventType;
  message: string;
  context?: Record<string, unknown>;
  errorStack?: string;
  autoModeStep?: "cover" | "title" | "toc" | "manual" | "unknown";
  captureMetadata?: {
    width?: number;
    height?: number;
    dpi?: number;
    fileSizeBytes?: number;
  };
  sizeBytes: number;
}

export interface DebugLogUploadMetadata {
  userId?: string | null;
  appVersion?: string;
  browserInfo?: string;
  extensionVersion?: string | null;
  osInfo?: string;
}

export interface DebugLoggingPolicy {
  enabledGlobally: boolean;
  disabledUserIds: string[];
  maxUploadBytes: number;
  maxLocalLogBytes: number;
  updatedAt?: string;
  updatedBy?: string;
}

interface DebugLogStateRecord {
  key: string;
  entries: DebugLogEntry[];
  updatedAt: number;
}

interface UploadDebugLogReportResponse {
  reportId: string;
  uploadedCount: number;
  uploadedAt: number;
}

interface UploadDebugLogReportRequest {
  userId: string;
  entries: DebugLogEntry[];
  totalSizeBytes: number;
  appVersion?: string;
  browserInfo?: string;
  extensionVersion?: string | null;
  osInfo?: string;
}

const DEBUG_LOG_STATE_KEY = "courseforge.debugLog.entries";
const DEBUG_LOG_ENABLED_KEY = "courseforge.debugLog.enabled";
const DEBUG_LAST_UPLOAD_KEY = "courseforge.debugLog.lastUploadTimestamp";
const DEBUG_POLICY_CACHE_KEY = "courseforge.debugLog.cachedPolicy";
const DEBUG_LOG_MAX_AGE_DAYS_KEY = "courseforge.debugLog.maxAgeDays";

const RUNAWAY_WINDOW_MS = 1000;
const RUNAWAY_MAX_APPENDS = 120;
let runawayWindowStartedAt = 0;
let runawayWindowCount = 0;

const DEBUG_LOG_IDB_NAME = "courseforge-debug";
const DEBUG_LOG_IDB_VERSION = 1;
const DEBUG_LOG_IDB_STORE = "debugState";
const DEBUG_LOG_IDB_SINGLETON_KEY = "singleton";

const DEFAULT_POLICY: DebugLoggingPolicy = {
  enabledGlobally: true,
  disabledUserIds: [],
  maxUploadBytes: 500 * 1024,
  maxLocalLogBytes: 1_500_000,
};

function safeGetStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function createEntryId(): string {
  return `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function estimateEntrySize(entryWithoutSize: Omit<DebugLogEntry, "sizeBytes">): number {
  return new TextEncoder().encode(JSON.stringify(entryWithoutSize)).length;
}

function normalizeEntries(entries: DebugLogEntry[], maxTotalBytes: number): DebugLogEntry[] {
  const storage = safeGetStorage();
  const maxAgeDaysRaw = storage?.getItem(DEBUG_LOG_MAX_AGE_DAYS_KEY) ?? "";
  const maxAgeDays = Number(maxAgeDaysRaw);
  const minTimestamp = Number.isFinite(maxAgeDays) && maxAgeDays > 0
    ? Date.now() - (Math.round(maxAgeDays) * 24 * 60 * 60 * 1000)
    : Number.NEGATIVE_INFINITY;
  const sorted = [...entries].sort((left, right) => left.timestamp - right.timestamp);
  const ageFiltered = sorted.filter((entry) => entry.timestamp >= minTimestamp);

  const kept: DebugLogEntry[] = [];
  let total = 0;

  for (let index = ageFiltered.length - 1; index >= 0; index -= 1) {
    const entry = ageFiltered[index];
    if (entry.sizeBytes > maxTotalBytes) {
      continue;
    }

    if (total + entry.sizeBytes > maxTotalBytes) {
      continue;
    }

    total += entry.sizeBytes;
    kept.push(entry);
  }

  return kept.reverse();
}

function fallbackReadEntries(): DebugLogEntry[] {
  const storage = safeGetStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(DEBUG_LOG_STATE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as DebugLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fallbackWriteEntries(entries: DebugLogEntry[]): void {
  const storage = safeGetStorage();
  if (!storage) {
    return;
  }

  storage.setItem(DEBUG_LOG_STATE_KEY, JSON.stringify(entries));
}

async function getDebugIdb() {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  try {
    return await openDB<{ debugState: { key: string; value: DebugLogStateRecord } }>(
      DEBUG_LOG_IDB_NAME,
      DEBUG_LOG_IDB_VERSION,
      {
        upgrade(db) {
          if (!db.objectStoreNames.contains(DEBUG_LOG_IDB_STORE)) {
            db.createObjectStore(DEBUG_LOG_IDB_STORE, { keyPath: "key" });
          }
        },
      }
    );
  } catch {
    return null;
  }
}

async function readEntries(): Promise<DebugLogEntry[]> {
  const db = await getDebugIdb();
  if (!db) {
    return fallbackReadEntries();
  }

  try {
    const state = await db.get(DEBUG_LOG_IDB_STORE, DEBUG_LOG_IDB_SINGLETON_KEY);
    return state?.entries ?? [];
  } catch {
    return fallbackReadEntries();
  }
}

async function writeEntries(entries: DebugLogEntry[]): Promise<void> {
  const db = await getDebugIdb();
  if (!db) {
    fallbackWriteEntries(entries);
    return;
  }

  try {
    await db.put(DEBUG_LOG_IDB_STORE, {
      key: DEBUG_LOG_IDB_SINGLETON_KEY,
      entries,
      updatedAt: Date.now(),
    });

    // Keep a lightweight fallback copy for unsupported environments.
    fallbackWriteEntries(entries);
  } catch {
    fallbackWriteEntries(entries);
  }
}

export function isDebugLoggingEnabled(): boolean {
  const storage = safeGetStorage();
  if (!storage) {
    return false;
  }

  const storedValue = storage.getItem(DEBUG_LOG_ENABLED_KEY);
  if (storedValue === null) {
    return true;
  }

  return storedValue === "true";
}

export function setDebugLoggingEnabled(enabled: boolean): void {
  const storage = safeGetStorage();
  if (!storage) {
    return;
  }

  storage.setItem(DEBUG_LOG_ENABLED_KEY, String(enabled));
}

export function setDebugLogMaxAgeDays(days: number): void {
  const storage = safeGetStorage();
  if (!storage) {
    return;
  }

  if (!Number.isFinite(days) || days <= 0) {
    storage.removeItem(DEBUG_LOG_MAX_AGE_DAYS_KEY);
    return;
  }

  storage.setItem(DEBUG_LOG_MAX_AGE_DAYS_KEY, String(Math.round(days)));
}

function readCachedPolicy(): DebugLoggingPolicy {
  const storage = safeGetStorage();
  if (!storage) {
    return DEFAULT_POLICY;
  }

  const raw = storage.getItem(DEBUG_POLICY_CACHE_KEY);
  if (!raw) {
    return DEFAULT_POLICY;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DebugLoggingPolicy>;
    return {
      enabledGlobally: parsed.enabledGlobally !== false,
      disabledUserIds: Array.isArray(parsed.disabledUserIds) ? parsed.disabledUserIds.filter((value): value is string => typeof value === "string") : [],
      maxUploadBytes: typeof parsed.maxUploadBytes === "number" ? parsed.maxUploadBytes : DEFAULT_POLICY.maxUploadBytes,
      maxLocalLogBytes: typeof parsed.maxLocalLogBytes === "number" ? parsed.maxLocalLogBytes : DEFAULT_POLICY.maxLocalLogBytes,
      updatedAt: parsed.updatedAt,
      updatedBy: parsed.updatedBy,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

function cachePolicy(policy: DebugLoggingPolicy): void {
  const storage = safeGetStorage();
  if (!storage) {
    return;
  }

  storage.setItem(DEBUG_POLICY_CACHE_KEY, JSON.stringify(policy));
}

export async function getDebugLoggingPolicy(): Promise<DebugLoggingPolicy> {
  try {
    const callable = httpsCallable<Record<string, never>, { success: boolean; data: DebugLoggingPolicy }>(
      functionsClient,
      "getDebugLoggingPolicy"
    );
    const result = await callable({});

    if (!result.data.success) {
      return readCachedPolicy();
    }

    const next: DebugLoggingPolicy = {
      enabledGlobally: result.data.data.enabledGlobally !== false,
      disabledUserIds: result.data.data.disabledUserIds ?? [],
      maxUploadBytes: result.data.data.maxUploadBytes ?? DEFAULT_POLICY.maxUploadBytes,
      maxLocalLogBytes: result.data.data.maxLocalLogBytes ?? DEFAULT_POLICY.maxLocalLogBytes,
      updatedAt: result.data.data.updatedAt,
      updatedBy: result.data.data.updatedBy,
    };

    cachePolicy(next);
    return next;
  } catch {
    return readCachedPolicy();
  }
}

export async function getDebugLogEntries(): Promise<DebugLogEntry[]> {
  return readEntries();
}

export async function clearDebugLogEntries(): Promise<void> {
  await writeEntries([]);
}

export function getDebugLogTotalBytes(entries: DebugLogEntry[] = []): number {
  return entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
}

export async function appendDebugLogEntry(
  input: Omit<DebugLogEntry, "id" | "timestamp" | "sizeBytes"> & { id?: string; timestamp?: number },
  userId?: string | null
): Promise<DebugLogEntry | null> {
  const now = Date.now();
  if ((now - runawayWindowStartedAt) > RUNAWAY_WINDOW_MS) {
    runawayWindowStartedAt = now;
    runawayWindowCount = 0;
  }

  runawayWindowCount += 1;
  if (runawayWindowCount > RUNAWAY_MAX_APPENDS) {
    return null;
  }

  if (!isDebugLoggingEnabled()) {
    return null;
  }

  const policy = await getDebugLoggingPolicy();
  if (!policy.enabledGlobally) {
    return null;
  }

  const effectiveUserId = userId ?? getCurrentUser()?.uid ?? null;
  if (effectiveUserId && policy.disabledUserIds.includes(effectiveUserId)) {
    return null;
  }

  const nextWithoutSize: Omit<DebugLogEntry, "sizeBytes"> = {
    id: input.id ?? createEntryId(),
    timestamp: input.timestamp ?? Date.now(),
    eventType: input.eventType,
    message: input.message,
    context: input.context,
    errorStack: input.errorStack,
    autoModeStep: input.autoModeStep,
    captureMetadata: input.captureMetadata,
  };

  const sizedEntry: DebugLogEntry = {
    ...nextWithoutSize,
    sizeBytes: estimateEntrySize(nextWithoutSize),
  };

  const normalized = normalizeEntries([...(await readEntries()), sizedEntry], policy.maxLocalLogBytes);
  await writeEntries(normalized);
  return sizedEntry;
}

export async function uploadAndClearDebugLogs(metadata: DebugLogUploadMetadata = {}): Promise<{ uploadedCount: number; uploadedAt: number | null }> {
  const userId = metadata.userId ?? null;
  if (!userId) {
    throw new Error("You must be signed in to upload debug logs.");
  }

  const entries = await readEntries();
  if (!entries.length) {
    return { uploadedCount: 0, uploadedAt: null };
  }

  const policy = await getDebugLoggingPolicy();
  if (!policy.enabledGlobally || policy.disabledUserIds.includes(userId)) {
    throw new Error("Debug logging is disabled for your account.");
  }

  const totalSizeBytes = getDebugLogTotalBytes(entries);
  if (totalSizeBytes > policy.maxUploadBytes) {
    throw new Error("Debug log too large to upload. Please clear or reduce logging.");
  }

  const callable = httpsCallable<UploadDebugLogReportRequest, { success: boolean; data: UploadDebugLogReportResponse }>(
    functionsClient,
    "uploadDebugLogReport"
  );

  const response = await callable({
    userId,
    entries,
    totalSizeBytes,
    appVersion: metadata.appVersion ?? import.meta.env.VITE_APP_VERSION ?? "unknown",
    browserInfo: metadata.browserInfo ?? (typeof navigator !== "undefined" ? navigator.userAgent : "unknown"),
    extensionVersion: metadata.extensionVersion ?? null,
    osInfo: metadata.osInfo ?? (typeof navigator !== "undefined" ? navigator.platform : "unknown"),
  });

  if (!response.data.success) {
    throw new Error("Unable to upload debug logs.");
  }

  await clearDebugLogEntries();

  const storage = safeGetStorage();
  if (storage) {
    storage.setItem(DEBUG_LAST_UPLOAD_KEY, String(response.data.data.uploadedAt));
  }

  return {
    uploadedCount: response.data.data.uploadedCount,
    uploadedAt: response.data.data.uploadedAt,
  };
}

export async function getDebugLogStorageStats(): Promise<{
  entries: number;
  totalBytes: number;
  maxTotalBytes: number;
  maxUploadBytes: number;
  lastUploadTimestamp: number | null;
}> {
  const entries = await readEntries();
  const policy = await getDebugLoggingPolicy();
  const storage = safeGetStorage();
  const rawLastUpload = storage?.getItem(DEBUG_LAST_UPLOAD_KEY) ?? null;
  const parsedLastUpload = rawLastUpload ? Number(rawLastUpload) : Number.NaN;

  return {
    entries: entries.length,
    totalBytes: getDebugLogTotalBytes(entries),
    maxTotalBytes: policy.maxLocalLogBytes,
    maxUploadBytes: policy.maxUploadBytes,
    lastUploadTimestamp: Number.isFinite(parsedLastUpload) ? parsedLastUpload : null,
  };
}

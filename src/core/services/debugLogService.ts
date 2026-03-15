import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { firestoreDb } from "../../firebase/firestore";

export type DebugEventType =
  | "auto_mode"
  | "capture"
  | "safety"
  | "ocr"
  | "toc"
  | "settings"
  | "sync"
  | "error"
  | "info";

export interface DebugLogEntry {
  timestamp: string;
  eventType: DebugEventType;
  message: string;
  context?: Record<string, unknown>;
  errorStack?: string;
  autoModeStep?: string;
  captureMetadata?: Record<string, unknown>;
  sizeBytes: number;
}

export interface DebugLogUploadMetadata {
  userId?: string | null;
  appVersion?: string;
  browserInfo?: string;
  extensionVersion?: string | null;
  osInfo?: string;
}

const DEBUG_LOG_STORAGE_KEY = "courseforge.debugLog.entries";
const DEBUG_LOG_ENABLED_KEY = "courseforge.debugLog.enabled";
const DEFAULT_MAX_TOTAL_BYTES = 1_500_000;

function safeGetStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function tryGetExtensionVersion(): string | null {
  try {
    const extensionApi = (globalThis as { chrome?: { runtime?: { getManifest?: () => { version?: string } } } }).chrome;
    if (extensionApi?.runtime?.getManifest) {
      return extensionApi.runtime.getManifest().version ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

function estimateEntrySize(entryWithoutSize: Omit<DebugLogEntry, "sizeBytes">): number {
  return new TextEncoder().encode(JSON.stringify(entryWithoutSize)).length;
}

function normalizeEntries(entries: DebugLogEntry[], maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES): DebugLogEntry[] {
  const sorted = [...entries].sort((left, right) => {
    return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
  });

  const kept: DebugLogEntry[] = [];
  let total = 0;

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const entry = sorted[index];
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

export function isDebugLoggingEnabled(): boolean {
  const storage = safeGetStorage();
  if (!storage) {
    return false;
  }

  return storage.getItem(DEBUG_LOG_ENABLED_KEY) === "true";
}

export function setDebugLoggingEnabled(enabled: boolean): void {
  const storage = safeGetStorage();
  if (!storage) {
    return;
  }

  storage.setItem(DEBUG_LOG_ENABLED_KEY, String(enabled));
}

export function getDebugLogEntries(): DebugLogEntry[] {
  const storage = safeGetStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(DEBUG_LOG_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as DebugLogEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

export function clearDebugLogEntries(): void {
  const storage = safeGetStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(DEBUG_LOG_STORAGE_KEY);
}

export function getDebugLogTotalBytes(entries: DebugLogEntry[] = getDebugLogEntries()): number {
  return entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
}

export function appendDebugLogEntry(
  input: Omit<DebugLogEntry, "timestamp" | "sizeBytes"> & { timestamp?: string },
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES
): DebugLogEntry | null {
  if (!isDebugLoggingEnabled()) {
    return null;
  }

  const storage = safeGetStorage();
  if (!storage) {
    return null;
  }

  const nextWithoutSize: Omit<DebugLogEntry, "sizeBytes"> = {
    timestamp: input.timestamp ?? new Date().toISOString(),
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

  const normalized = normalizeEntries([...getDebugLogEntries(), sizedEntry], maxTotalBytes);
  storage.setItem(DEBUG_LOG_STORAGE_KEY, JSON.stringify(normalized));
  return sizedEntry;
}

export async function uploadAndClearDebugLogs(metadata: DebugLogUploadMetadata = {}): Promise<{ uploadedCount: number }> {
  const entries = getDebugLogEntries();
  if (entries.length === 0) {
    return { uploadedCount: 0 };
  }

  const payload = {
    createdAt: serverTimestamp(),
    logs: entries,
    totalSizeBytes: getDebugLogTotalBytes(entries),
    appVersion: metadata.appVersion ?? import.meta.env.VITE_APP_VERSION ?? "unknown",
    browserInfo: metadata.browserInfo ?? (typeof navigator !== "undefined" ? navigator.userAgent : "unknown"),
    extensionVersion: metadata.extensionVersion ?? tryGetExtensionVersion(),
    osInfo: metadata.osInfo ?? (typeof navigator !== "undefined" ? navigator.platform : "unknown"),
    userId: metadata.userId ?? null,
  };

  await addDoc(collection(firestoreDb, "debugReports"), payload);
  clearDebugLogEntries();

  return { uploadedCount: entries.length };
}

export function getDebugLogStorageStats(): { entries: number; totalBytes: number; maxTotalBytes: number } {
  const entries = getDebugLogEntries();
  return {
    entries: entries.length,
    totalBytes: getDebugLogTotalBytes(entries),
    maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
  };
}

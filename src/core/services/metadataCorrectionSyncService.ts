import { httpsCallable } from "firebase/functions";

import { functionsClient } from "../../firebase/functions";
import {
  detectSuspiciousCorrection,
  estimateImageReferenceBytes,
  getEffectiveCorrectionRules,
  queryCorrectionRecords,
  readLocalCorrectionRecords,
  validateCorrectionRecordStructure,
  writeCloudCorrectionRules,
  writeLocalCorrectionRecords,
  type CorrectionQueryFilters,
  type CorrectionRecord,
  type CorrectionRules,
} from "./metadataCorrectionLearningService";

interface SyncPushResponse {
  acceptedCount: number;
  rejectedCount: number;
}

export interface SyncSafeguardConfig {
  dailyUploadLimit: number;
  minUploadIntervalSeconds: number;
  maxImageBytes: number;
  lowConfidenceThreshold: number;
}

export interface SyncMetadataResult {
  pushed: number;
  pulledRulesVersion: string | null;
  queuedCount: number;
  blockedReason: string | null;
  message: string | null;
}

interface CorrectionListQuery {
  filters?: CorrectionQueryFilters;
  page?: number;
  pageSize?: number;
  sortBy?: "timestamp" | "finalConfidence" | "errorScore";
  sortDirection?: "asc" | "desc";
}

export interface CorrectionListResult {
  items: CorrectionRecord[];
  total: number;
  page: number;
  pageSize: number;
}

const QUEUE_KEY = "courseforge.metadataCorrections.uploadQueue.v1";
const LAST_UPLOAD_AT_KEY = "courseforge.metadataCorrections.lastUploadAt.v1";
const DAILY_COUNTER_KEY = "courseforge.metadataCorrections.dailyCount.v1";
const UPLOADED_IDS_KEY = "courseforge.metadataCorrections.uploadedIds.v1";
const METADATA_CORRECTION_SYNC_RUNTIME_KEY = "courseforge.metadataCorrections.syncRuntime.v1";

export interface MetadataCorrectionSyncRuntimeState extends SyncMetadataResult {
  updatedAt: string;
  optedIn: boolean;
}

const DEFAULT_SYNC_SAFEGUARDS: SyncSafeguardConfig = {
  dailyUploadLimit: 25,
  minUploadIntervalSeconds: 5,
  maxImageBytes: 200 * 1024,
  lowConfidenceThreshold: 0.65,
};

function normalizeApiBaseUrl(baseUrl?: string): string {
  if (!baseUrl) {
    return "";
  }

  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function getTodayKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readJson<T>(key: string, fallback: T): T {
  const storage = getStorage();
  if (!storage) {
    return fallback;
  }

  const raw = storage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(key, JSON.stringify(value));
}

function readQueue(): string[] {
  return readJson<string[]>(QUEUE_KEY, []);
}

function writeQueue(queue: string[]): void {
  const deduped = [...new Set(queue.filter(Boolean))];
  writeJson(QUEUE_KEY, deduped.slice(-1000));
}

function readDailyCounter(): { date: string; count: number } {
  return readJson<{ date: string; count: number }>(DAILY_COUNTER_KEY, { date: getTodayKey(), count: 0 });
}

function writeDailyCounter(value: { date: string; count: number }): void {
  writeJson(DAILY_COUNTER_KEY, value);
}

function readUploadedIds(): string[] {
  return readJson<string[]>(UPLOADED_IDS_KEY, []);
}

function writeUploadedIds(ids: string[]): void {
  writeJson(UPLOADED_IDS_KEY, [...new Set(ids)].slice(-5000));
}

function readLastUploadAt(): number {
  return readJson<number>(LAST_UPLOAD_AT_KEY, 0);
}

function writeLastUploadAt(timestamp: number): void {
  writeJson(LAST_UPLOAD_AT_KEY, timestamp);
}

function writeSyncRuntimeState(state: MetadataCorrectionSyncRuntimeState): void {
  writeJson(METADATA_CORRECTION_SYNC_RUNTIME_KEY, state);
}

export function readMetadataCorrectionSyncRuntimeState(): MetadataCorrectionSyncRuntimeState | null {
  return readJson<MetadataCorrectionSyncRuntimeState | null>(METADATA_CORRECTION_SYNC_RUNTIME_KEY, null);
}

function applyLocalSafeguardsToRecord(
  record: CorrectionRecord,
  safeguards: SyncSafeguardConfig
): CorrectionRecord {
  let flagged = record.flagged;
  let reasonFlagged = record.reasonFlagged;

  const validation = validateCorrectionRecordStructure(record);
  if (!validation.valid) {
    flagged = true;
    reasonFlagged = validation.reason ?? "Malformed correction sample.";
  }

  const imageBytes = estimateImageReferenceBytes(record.imageReference);
  if (imageBytes > safeguards.maxImageBytes) {
    flagged = true;
    reasonFlagged = `Image snippet exceeds ${safeguards.maxImageBytes} bytes.`;
  }

  const suspicious = detectSuspiciousCorrection(record);
  if (suspicious.suspicious) {
    flagged = true;
    reasonFlagged = suspicious.reason ?? "Suspicious metadata correction detected.";
  }

  if (record.finalConfidence < safeguards.lowConfidenceThreshold) {
    flagged = true;
    reasonFlagged = reasonFlagged ?? `Final confidence below ${safeguards.lowConfidenceThreshold.toFixed(2)}.`;
  }

  return {
    ...record,
    flagged,
    reasonFlagged,
    reviewStatus: record.reviewStatus ?? "pending",
  };
}

function hydrateQueueFromRecords(records: CorrectionRecord[], uploadedIds: string[]): string[] {
  const uploadedIdSet = new Set(uploadedIds);
  return records
    .filter((record) => record.reviewStatus === "pending")
    .filter((record) => !uploadedIdSet.has(record.id))
    .map((record) => record.id);
}

async function pushCorrectionsUpload(
  corrections: CorrectionRecord[],
  input: { apiBaseUrl?: string; signal?: AbortSignal } = {}
): Promise<SyncPushResponse | null> {
  if (!corrections.length) {
    return {
      acceptedCount: 0,
      rejectedCount: 0,
    };
  }

  const base = normalizeApiBaseUrl(input.apiBaseUrl);

  try {
    const callable = httpsCallable(functionsClient, "correctionsUpload");
    const callableResponse = await callable({ corrections });
    const callablePayload = callableResponse.data as {
      success?: boolean;
      data?: {
        acceptedCount?: unknown;
        rejectedCount?: unknown;
      };
    };

    if (callablePayload?.success === true) {
      return {
        acceptedCount: typeof callablePayload.data?.acceptedCount === "number" ? callablePayload.data.acceptedCount : corrections.length,
        rejectedCount: typeof callablePayload.data?.rejectedCount === "number" ? callablePayload.data.rejectedCount : 0,
      };
    }
  } catch {
    // Fall through to REST endpoint for local/dev stubs.
  }

  try {
    const response = await fetch(`${base}/api/corrections/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ corrections }),
      signal: input.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as {
      acceptedCount?: unknown;
      rejectedCount?: unknown;
    };

    return {
      acceptedCount: typeof payload.acceptedCount === "number" ? payload.acceptedCount : corrections.length,
      rejectedCount: typeof payload.rejectedCount === "number" ? payload.rejectedCount : 0,
    };
  } catch {
    return null;
  }
}

export async function fetchCloudCorrectionRules(
  input: { apiBaseUrl?: string; signal?: AbortSignal } = {}
): Promise<CorrectionRules | null> {
  const base = normalizeApiBaseUrl(input.apiBaseUrl);

  try {
    const callable = httpsCallable(functionsClient, "correctionsRules");
    const callableResponse = await callable({});
    const callablePayload = callableResponse.data as {
      success?: boolean;
      data?: CorrectionRules;
    };

    if (callablePayload?.success === true && callablePayload.data) {
      writeCloudCorrectionRules(callablePayload.data);
      return callablePayload.data;
    }
  } catch {
    // Fall through to REST endpoint for local/dev stubs.
  }

  try {
    const response = await fetch(`${base}/api/corrections/rules`, {
      method: "GET",
      signal: input.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as CorrectionRules;
    if (!payload || typeof payload.version !== "string") {
      return null;
    }

    writeCloudCorrectionRules(payload);
    return payload;
  } catch {
    return null;
  }
}

export async function listCorrections(
  query: CorrectionListQuery,
  input: { apiBaseUrl?: string; signal?: AbortSignal } = {}
): Promise<CorrectionListResult> {
  const base = normalizeApiBaseUrl(input.apiBaseUrl);

  try {
    const callable = httpsCallable(functionsClient, "correctionsList");
    const callableResponse = await callable(query);
    const callablePayload = callableResponse.data as {
      success?: boolean;
      data?: CorrectionListResult;
    };

    if (callablePayload?.success === true && callablePayload.data) {
      return callablePayload.data;
    }
  } catch {
    // Fall through to local fallback.
  }

  if (base) {
    try {
      const response = await fetch(`${base}/api/corrections/list`, {
        method: "GET",
        signal: input.signal,
      });
      if (response.ok) {
        return await response.json() as CorrectionListResult;
      }
    } catch {
      // Continue to local fallback.
    }
  }

  const local = readLocalCorrectionRecords();
  const result = queryCorrectionRecords(local, query.filters ?? {}, {
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  });

  return {
    items: result.items,
    total: result.total,
    page: Math.max(1, query.page ?? 1),
    pageSize: Math.max(1, query.pageSize ?? 20),
  };
}

export async function reviewCorrections(
  request: {
    action: "accept" | "reject" | "modify";
    recordIds: string[];
    modifiedMetadata?: Partial<CorrectionRecord["finalMetadata"]>;
  },
  input: { apiBaseUrl?: string; signal?: AbortSignal } = {}
): Promise<{ updated: number }> {
  const base = normalizeApiBaseUrl(input.apiBaseUrl);

  try {
    const callable = httpsCallable(functionsClient, "correctionsReview");
    const callableResponse = await callable(request);
    const callablePayload = callableResponse.data as {
      success?: boolean;
      data?: { updated?: number };
    };

    if (callablePayload?.success === true) {
      return { updated: typeof callablePayload.data?.updated === "number" ? callablePayload.data.updated : 0 };
    }
  } catch {
    // Fall through to local fallback.
  }

  if (base) {
    try {
      const response = await fetch(`${base}/api/corrections/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: input.signal,
      });
      if (response.ok) {
        return await response.json() as { updated: number };
      }
    } catch {
      // Continue to local fallback.
    }
  }

  const records = readLocalCorrectionRecords();
  const idSet = new Set(request.recordIds);
  let updated = 0;

  const next: CorrectionRecord[] = records.map((record): CorrectionRecord => {
    if (!idSet.has(record.id)) {
      return record;
    }

    updated += 1;
    if (request.action === "reject") {
      return { ...record, reviewStatus: "rejected", reviewedByAdmin: "local-admin" };
    }

    if (request.action === "modify" && request.modifiedMetadata) {
      const finalMetadata = {
        ...record.finalMetadata,
        ...request.modifiedMetadata,
      };
      return {
        ...record,
        finalMetadata,
        finalConfidence: finalMetadata.confidence,
        reviewStatus: "accepted",
        reviewedByAdmin: "local-admin",
      };
    }

    return { ...record, reviewStatus: "accepted", reviewedByAdmin: "local-admin" };
  });

  writeLocalCorrectionRecords(next);
  return { updated };
}

export async function updateCorrectionRules(
  rules: CorrectionRules,
  input: { apiBaseUrl?: string; signal?: AbortSignal } = {}
): Promise<CorrectionRules | null> {
  const base = normalizeApiBaseUrl(input.apiBaseUrl);

  try {
    const callable = httpsCallable(functionsClient, "correctionsRulesUpdate");
    const callableResponse = await callable({ rules });
    const callablePayload = callableResponse.data as {
      success?: boolean;
      data?: CorrectionRules;
    };

    if (callablePayload?.success === true && callablePayload.data) {
      writeCloudCorrectionRules(callablePayload.data);
      return callablePayload.data;
    }
  } catch {
    // Fall through to REST.
  }

  if (base) {
    try {
      const response = await fetch(`${base}/api/corrections/rules/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
        signal: input.signal,
      });
      if (response.ok) {
        const payload = await response.json() as CorrectionRules;
        writeCloudCorrectionRules(payload);
        return payload;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function syncMetadataCorrectionLearning(
  input: {
    optedIn: boolean;
    apiBaseUrl?: string;
    signal?: AbortSignal;
    maxPushRecords?: number;
    safeguards?: Partial<SyncSafeguardConfig>;
  }
): Promise<SyncMetadataResult> {
  const safeguards: SyncSafeguardConfig = {
    ...DEFAULT_SYNC_SAFEGUARDS,
    ...(input.safeguards ?? {}),
  };

  if (!input.optedIn) {
    const result = {
      pushed: 0,
      pulledRulesVersion: null,
      queuedCount: readQueue().length,
      blockedReason: "opted-out",
      message: "Correction sharing is disabled. Data will stay local.",
    };
    writeSyncRuntimeState({ ...result, optedIn: input.optedIn, updatedAt: new Date().toISOString() });
    return result;
  }

  const localRecords = readLocalCorrectionRecords();
  const sanitizedRecords = localRecords.map((record) => applyLocalSafeguardsToRecord(record, safeguards));
  writeLocalCorrectionRecords(sanitizedRecords);

  const maxPushRecords = Math.max(1, input.maxPushRecords ?? 50);
  const uploadedIds = readUploadedIds();
  const queue = [...readQueue(), ...hydrateQueueFromRecords(sanitizedRecords.slice(-maxPushRecords), uploadedIds)];
  writeQueue(queue);

  const now = Date.now();
  const minIntervalMs = safeguards.minUploadIntervalSeconds * 1000;
  const lastUploadAt = readLastUploadAt();

  const dailyCounter = readDailyCounter();
  const today = getTodayKey();
  const normalizedDailyCounter = dailyCounter.date === today ? dailyCounter : { date: today, count: 0 };

  if (normalizedDailyCounter.count >= safeguards.dailyUploadLimit) {
    writeDailyCounter(normalizedDailyCounter);
    const fetchedRules = await fetchCloudCorrectionRules({ apiBaseUrl: input.apiBaseUrl, signal: input.signal });
    getEffectiveCorrectionRules();
    const result = {
      pushed: 0,
      pulledRulesVersion: fetchedRules?.version ?? null,
      queuedCount: readQueue().length,
      blockedReason: "daily-limit",
      message: "You’ve reached today’s learning contribution limit. Try again tomorrow.",
    };
    writeSyncRuntimeState({ ...result, optedIn: input.optedIn, updatedAt: new Date().toISOString() });
    return result;
  }

  if (now - lastUploadAt < minIntervalMs) {
    const fetchedRules = await fetchCloudCorrectionRules({ apiBaseUrl: input.apiBaseUrl, signal: input.signal });
    getEffectiveCorrectionRules();
    const result = {
      pushed: 0,
      pulledRulesVersion: fetchedRules?.version ?? null,
      queuedCount: readQueue().length,
      blockedReason: "rate-limit",
      message: "Learning samples queued locally and will upload shortly.",
    };
    writeSyncRuntimeState({ ...result, optedIn: input.optedIn, updatedAt: new Date().toISOString() });
    return result;
  }

  const currentQueue = readQueue();
  const nextRecordId = currentQueue[0];
  if (!nextRecordId) {
    const fetchedRules = await fetchCloudCorrectionRules({ apiBaseUrl: input.apiBaseUrl, signal: input.signal });
    getEffectiveCorrectionRules();
    const result = {
      pushed: 0,
      pulledRulesVersion: fetchedRules?.version ?? null,
      queuedCount: 0,
      blockedReason: null,
      message: null,
    };
    writeSyncRuntimeState({ ...result, optedIn: input.optedIn, updatedAt: new Date().toISOString() });
    return result;
  }

  const record = sanitizedRecords.find((entry) => entry.id === nextRecordId);
  if (!record) {
    writeQueue(currentQueue.slice(1));
    const result = {
      pushed: 0,
      pulledRulesVersion: null,
      queuedCount: currentQueue.length - 1,
      blockedReason: "stale-queue",
      message: "Cleared stale learning queue entries.",
    };
    writeSyncRuntimeState({ ...result, optedIn: input.optedIn, updatedAt: new Date().toISOString() });
    return result;
  }

  // Flagged records are intentionally held for admin review instead of auto-upload.
  if (record.flagged) {
    writeQueue(currentQueue.slice(1));
    const fetchedRules = await fetchCloudCorrectionRules({ apiBaseUrl: input.apiBaseUrl, signal: input.signal });
    getEffectiveCorrectionRules();
    const result = {
      pushed: 0,
      pulledRulesVersion: fetchedRules?.version ?? null,
      queuedCount: currentQueue.length - 1,
      blockedReason: "flagged",
      message: "A correction sample was flagged for review and held back from auto-upload.",
    };
    writeSyncRuntimeState({ ...result, optedIn: input.optedIn, updatedAt: new Date().toISOString() });
    return result;
  }

  const pushResult = await pushCorrectionsUpload([record], {
    apiBaseUrl: input.apiBaseUrl,
    signal: input.signal,
  });

  if (pushResult?.acceptedCount) {
    writeLastUploadAt(now);
    writeDailyCounter({
      date: today,
      count: normalizedDailyCounter.count + pushResult.acceptedCount,
    });
    writeUploadedIds([...uploadedIds, record.id]);
    writeQueue(currentQueue.slice(1));
  }

  const fetchedRules = await fetchCloudCorrectionRules({
    apiBaseUrl: input.apiBaseUrl,
    signal: input.signal,
  });

  getEffectiveCorrectionRules();

  const result = {
    pushed: pushResult?.acceptedCount ?? 0,
    pulledRulesVersion: fetchedRules?.version ?? null,
    queuedCount: readQueue().length,
    blockedReason: pushResult ? null : "network",
    message: pushResult
      ? null
      : "Unable to upload learning samples right now. They are queued locally.",
  };
  writeSyncRuntimeState({ ...result, optedIn: input.optedIn, updatedAt: new Date().toISOString() });
  return result;
}

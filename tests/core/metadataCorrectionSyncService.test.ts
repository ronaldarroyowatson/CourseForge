import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callableMocks = vi.hoisted(() => ({
  correctionsUpload: vi.fn(),
  correctionsRules: vi.fn(),
  correctionsList: vi.fn(),
  correctionsReview: vi.fn(),
  correctionsRulesUpdate: vi.fn(),
}));

const learningServiceMocks = vi.hoisted(() => ({
  detectSuspiciousCorrection: vi.fn(() => ({ suspicious: false })),
  estimateImageReferenceBytes: vi.fn(() => 0),
  getEffectiveCorrectionRules: vi.fn(() => ({ version: "local" })),
  queryCorrectionRecords: vi.fn<() => { items: Record<string, unknown>[]; total: number }>(() => ({ items: [], total: 0 })),
  readLocalCorrectionRecords: vi.fn<() => Record<string, unknown>[]>(() => []),
  validateCorrectionRecordStructure: vi.fn(() => ({ valid: true })),
  writeCloudCorrectionRules: vi.fn(),
  writeLocalCorrectionRecords: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_client: unknown, name: string) => callableMocks[name as keyof typeof callableMocks] ?? vi.fn(),
}));

vi.mock("../../src/firebase/functions", () => ({
  functionsClient: {},
}));

vi.mock("../../src/core/services/metadataCorrectionLearningService", () => ({
  detectSuspiciousCorrection: learningServiceMocks.detectSuspiciousCorrection,
  estimateImageReferenceBytes: learningServiceMocks.estimateImageReferenceBytes,
  getEffectiveCorrectionRules: learningServiceMocks.getEffectiveCorrectionRules,
  queryCorrectionRecords: learningServiceMocks.queryCorrectionRecords,
  readLocalCorrectionRecords: learningServiceMocks.readLocalCorrectionRecords,
  validateCorrectionRecordStructure: learningServiceMocks.validateCorrectionRecordStructure,
  writeCloudCorrectionRules: learningServiceMocks.writeCloudCorrectionRules,
  writeLocalCorrectionRecords: learningServiceMocks.writeLocalCorrectionRecords,
}));

import {
  listCorrections,
  readMetadataCorrectionSyncRuntimeState,
  reviewCorrections,
  syncMetadataCorrectionLearning,
} from "../../src/core/services/metadataCorrectionSyncService";

const QUEUE_KEY = "courseforge.metadataCorrections.uploadQueue.v1";
const DAILY_COUNTER_KEY = "courseforge.metadataCorrections.dailyCount.v1";
const RUNTIME_KEY = "courseforge.metadataCorrections.syncRuntime.v1";
const LAST_UPLOAD_AT_KEY = "courseforge.metadataCorrections.lastUploadAt.v1";
const UPLOADED_IDS_KEY = "courseforge.metadataCorrections.uploadedIds.v1";

function makeRecord(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    timestamp: "2026-04-15T00:00:00.000Z",
    pageType: "title",
    publisher: "CourseForge Press",
    series: "Series",
    subject: "Science",
    originalVisionOutput: null,
    originalOcrOutput: { rawText: "raw" },
    finalMetadata: {
      title: "Title",
      subtitle: null,
      edition: null,
      publisher: "CourseForge Press",
      series: "Series",
      gradeLevel: null,
      subject: "Science",
      confidence: 0.9,
      rawText: "raw",
      source: "ocr",
    },
    imageReference: null,
    flagged: false,
    finalConfidence: 0.9,
    errorScore: 0.1,
    reviewStatus: "pending",
    ...overrides,
  };
}

describe("metadataCorrectionSyncService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();

    Object.values(callableMocks).forEach((mock) => mock.mockReset());
    Object.values(learningServiceMocks).forEach((mock) => {
      if (typeof mock?.mockReset === "function") {
        mock.mockReset();
      }
    });
    callableMocks.correctionsUpload.mockResolvedValue({ data: { success: true, data: { acceptedCount: 1, rejectedCount: 0 } } });
    callableMocks.correctionsRules.mockResolvedValue({ data: { success: true, data: { version: "2", updatedAt: "2026-04-15", globalReplacements: [], publisherSpecific: {} } } });
    callableMocks.correctionsList.mockRejectedValue(new Error("fallback to local"));
    callableMocks.correctionsReview.mockRejectedValue(new Error("fallback to local"));

    learningServiceMocks.detectSuspiciousCorrection.mockReturnValue({ suspicious: false });
    learningServiceMocks.estimateImageReferenceBytes.mockReturnValue(0);
    learningServiceMocks.getEffectiveCorrectionRules.mockReturnValue({ version: "local" });
    learningServiceMocks.readLocalCorrectionRecords.mockReturnValue([]);
    learningServiceMocks.validateCorrectionRecordStructure.mockReturnValue({ valid: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns opted-out status without pushing samples", async () => {
    const result = await syncMetadataCorrectionLearning({ optedIn: false });

    expect(result.blockedReason).toBe("opted-out");
    expect(result.pushed).toBe(0);
    expect(callableMocks.correctionsUpload).not.toHaveBeenCalled();
  });

  it("returns daily-limit block when limit has been reached", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(DAILY_COUNTER_KEY, JSON.stringify({ date: "2026-04-15", count: 5 }));
    learningServiceMocks.readLocalCorrectionRecords.mockReturnValue([makeRecord("rec-1")]);
    vi.setSystemTime(new Date("2026-04-15T08:00:00.000Z"));

    const result = await syncMetadataCorrectionLearning({
      optedIn: true,
      safeguards: { dailyUploadLimit: 5 },
    });

    expect(result.blockedReason).toBe("daily-limit");
    expect(result.pushed).toBe(0);
    expect(callableMocks.correctionsUpload).not.toHaveBeenCalled();
  });

  it("clears stale queue entries that do not map to current records", async () => {
    learningServiceMocks.readLocalCorrectionRecords.mockReturnValue([makeRecord("rec-2")]);
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(["missing-id"]));

    const result = await syncMetadataCorrectionLearning({ optedIn: true });

    expect(result.blockedReason).toBe("stale-queue");
    expect(result.queuedCount).toBe(1);
  });

  it("holds flagged records and reports flagged block reason", async () => {
    learningServiceMocks.readLocalCorrectionRecords.mockReturnValue([
      makeRecord("rec-flagged", { flagged: true, reasonFlagged: "Suspicious correction" }),
    ]);

    const result = await syncMetadataCorrectionLearning({ optedIn: true });

    expect(result.blockedReason).toBe("flagged");
    expect(result.pushed).toBe(0);
    expect(callableMocks.correctionsUpload).not.toHaveBeenCalled();
  });

  it("pushes one queued record and persists runtime state", async () => {
    learningServiceMocks.readLocalCorrectionRecords.mockReturnValue([makeRecord("rec-1")]);

    const result = await syncMetadataCorrectionLearning({ optedIn: true });

    expect(result.pushed).toBe(1);
    expect(result.blockedReason).toBeNull();

    const runtimeState = readMetadataCorrectionSyncRuntimeState();
    expect(runtimeState?.pushed).toBe(1);
    expect(runtimeState?.optedIn).toBe(true);

    const queued = JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]") as string[];
    expect(queued).toHaveLength(0);

    const uploadedIds = JSON.parse(window.localStorage.getItem(UPLOADED_IDS_KEY) ?? "[]") as string[];
    expect(uploadedIds).toContain("rec-1");
    expect(window.localStorage.getItem(LAST_UPLOAD_AT_KEY)).toBeTruthy();
  });

  it("falls back to local listing when callable list fails", async () => {
    learningServiceMocks.queryCorrectionRecords.mockReturnValue({
      items: [makeRecord("local-1")],
      total: 1,
    });

    const result = await listCorrections({ page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it("falls back to local review mutation when callable review fails", async () => {
    learningServiceMocks.readLocalCorrectionRecords.mockReturnValue([makeRecord("local-2")]);

    const result = await reviewCorrections({
      action: "accept",
      recordIds: ["local-2"],
    });

    expect(result.updated).toBe(1);
    expect(learningServiceMocks.writeLocalCorrectionRecords).toHaveBeenCalledTimes(1);
  });

  it("returns null runtime state for corrupted persisted JSON", () => {
    window.localStorage.setItem(RUNTIME_KEY, "{broken");

    expect(readMetadataCorrectionSyncRuntimeState()).toBeNull();
  });
});

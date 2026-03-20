import { beforeEach, describe, expect, it, vi } from "vitest";

const callableRegistry = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
  return {
    handlers,
    register(name: string, handler: (payload: unknown) => Promise<unknown>): void {
      handlers.set(name, handler);
    },
    clear(): void {
      handlers.clear();
    },
  };
});

vi.mock("../../src/firebase/functions", () => ({
  functionsClient: {},
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_client: unknown, name: string) => {
    return async (payload: unknown) => {
      const handler = callableRegistry.handlers.get(name);
      if (!handler) {
        throw new Error(`Missing callable mock for ${name}`);
      }
      return { data: await handler(payload) };
    };
  },
}));

import {
  queryCorrectionRecords,
  saveCorrectionRecord,
  setMetadataCorrectionSharingEnabled,
  type CorrectionRecord,
  type MetadataResult,
} from "../../src/core/services/metadataCorrectionLearningService";
import {
  reviewCorrections,
  syncMetadataCorrectionLearning,
} from "../../src/core/services/metadataCorrectionSyncService";

function metadata(overrides: Partial<MetadataResult> = {}): MetadataResult {
  return {
    title: "Algebra 1",
    subtitle: null,
    edition: "Teacher's Edition",
    publisher: "McGraw Hill",
    series: null,
    gradeLevel: "8",
    subject: "Math",
    confidence: 0.8,
    rawText: "Algebra 1",
    source: "vision",
    ...overrides,
  };
}

function createRecord(overrides?: Partial<MetadataResult>): CorrectionRecord {
  return saveCorrectionRecord({
    pageType: "cover",
    publisher: "McGraw Hill",
    series: null,
    subject: "Math",
    originalVisionOutput: metadata({
      title: "Algebra l",
      confidence: 0.45,
      source: "vision",
    }),
    originalOcrOutput: { rawText: "Algebra l" },
    finalMetadata: metadata(overrides),
    imageReference: "hash://sample-image",
  });
}

describe("metadata correction safeguards", () => {
  beforeEach(() => {
    window.localStorage.clear();
    callableRegistry.clear();
    setMetadataCorrectionSharingEnabled(true);

    callableRegistry.register("correctionsUpload", async (payload) => {
      const data = payload as { corrections?: unknown[] };
      const count = Array.isArray(data.corrections) ? data.corrections.length : 0;
      return {
        success: true,
        data: {
          acceptedCount: count,
          rejectedCount: 0,
        },
      };
    });

    callableRegistry.register("correctionsRules", async () => ({
      success: true,
      data: {
        version: "cloud-v1",
        updatedAt: new Date().toISOString(),
        globalReplacements: [],
        publisherSpecific: {},
      },
    }));

    callableRegistry.register("correctionsReview", async () => ({
      success: true,
      data: { updated: 1 },
    }));
  });

  it("enforces daily upload limits", async () => {
    createRecord();
    createRecord({ title: "Geometry" });

    const first = await syncMetadataCorrectionLearning({
      optedIn: true,
      safeguards: { dailyUploadLimit: 1 },
    });
    expect(first.pushed).toBe(1);

    const second = await syncMetadataCorrectionLearning({
      optedIn: true,
      safeguards: { dailyUploadLimit: 1 },
    });
    expect(second.pushed).toBe(0);
    expect(second.blockedReason).toBe("daily-limit");
    expect(second.message).toContain("learning contribution limit");
  });

  it("enforces upload rate limiting with local queue", async () => {
    createRecord();

    const first = await syncMetadataCorrectionLearning({
      optedIn: true,
      safeguards: { minUploadIntervalSeconds: 60 },
    });
    expect(first.pushed).toBe(1);

    createRecord({ title: "Integrated Math" });
    const second = await syncMetadataCorrectionLearning({
      optedIn: true,
      safeguards: { minUploadIntervalSeconds: 60 },
    });

    expect(second.pushed).toBe(0);
    expect(second.blockedReason).toBe("rate-limit");
    expect(second.queuedCount).toBeGreaterThanOrEqual(1);
  });

  it("flags oversized image references", async () => {
    saveCorrectionRecord({
      pageType: "title",
      publisher: "McGraw Hill",
      series: null,
      subject: "Math",
      originalVisionOutput: metadata(),
      originalOcrOutput: { rawText: "Text" },
      finalMetadata: metadata({ confidence: 0.9 }),
      imageReference: `data:image/png;base64,${"A".repeat(400000)}`,
    });

    const result = await syncMetadataCorrectionLearning({
      optedIn: true,
      safeguards: { maxImageBytes: 1024 },
    });

    expect(result.pushed).toBe(0);
    expect(result.blockedReason).toBe("flagged");
  });

  it("flags malformed records for review", async () => {
    saveCorrectionRecord({
      pageType: "cover",
      publisher: "McGraw Hill",
      series: null,
      subject: "Math",
      originalVisionOutput: null,
      originalOcrOutput: null,
      finalMetadata: metadata({ title: null }),
      imageReference: "",
    });

    const result = await syncMetadataCorrectionLearning({ optedIn: true });
    expect(result.pushed).toBe(0);
    expect(result.blockedReason).toBe("flagged");
  });

  it("flags invalid image snippet references", async () => {
    saveCorrectionRecord({
      pageType: "cover",
      publisher: "McGraw Hill",
      series: null,
      subject: "Math",
      originalVisionOutput: metadata(),
      originalOcrOutput: { rawText: "Algebra" },
      finalMetadata: metadata({ title: "Algebra 2" }),
      imageReference: "invalid-reference",
    });

    const result = await syncMetadataCorrectionLearning({ optedIn: true });
    expect(result.pushed).toBe(0);
    expect(result.blockedReason).toBe("flagged");
  });

  it("detects suspicious metadata poisoning patterns", async () => {
    createRecord({
      title: "X9QWRTYPLM 992344 ZZZZZ",
      publisher: "999888777",
      confidence: 0.4,
    });

    const result = await syncMetadataCorrectionLearning({ optedIn: true });
    expect(result.pushed).toBe(0);
    expect(result.blockedReason).toBe("flagged");
  });

  it("supports local-only mode when sharing is disabled", async () => {
    setMetadataCorrectionSharingEnabled(false);
    createRecord();

    const result = await syncMetadataCorrectionLearning({ optedIn: false });
    expect(result.pushed).toBe(0);
    expect(result.blockedReason).toBe("opted-out");
  });

  it("supports confidence error ranking and filtering", () => {
    const records = [
      createRecord({ title: "A", confidence: 0.2 }),
      createRecord({ title: "B", confidence: 0.95 }),
      createRecord({ title: "C", confidence: 0.5 }),
    ];

    const ranked = queryCorrectionRecords(records, {}, { sortBy: "errorScore", sortDirection: "desc" });
    expect(ranked.items.length).toBe(3);
    expect(ranked.items[0].errorScore).toBeGreaterThanOrEqual(ranked.items[1].errorScore);

    const filtered = queryCorrectionRecords(records, { minConfidence: 0.9 }, { sortBy: "timestamp", sortDirection: "asc" });
    expect(filtered.items.every((record) => record.finalConfidence >= 0.9)).toBe(true);
  });

  it("supports bulk accept and reject review workflows", async () => {
    const first = createRecord({ title: "Bulk One" });
    const second = createRecord({ title: "Bulk Two" });

    // Force local fallback by clearing callable
    callableRegistry.clear();

    const accepted = await reviewCorrections({ action: "accept", recordIds: [first.id, second.id] });
    expect(accepted.updated).toBe(2);

    const rejected = await reviewCorrections({ action: "reject", recordIds: [first.id] });
    expect(rejected.updated).toBe(1);
  });

  it("uploads and pulls cloud rules in a sync run", async () => {
    createRecord({ title: "Cloud Sync" });

    const result = await syncMetadataCorrectionLearning({ optedIn: true });
    expect(result.pushed).toBe(1);
    expect(result.pulledRulesVersion).toBe("cloud-v1");
  });
});

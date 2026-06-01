import { describe, expect, it } from "vitest";

import {
  clearAutoExtractionCheckpoints,
  deleteAutoExtractionCheckpoint,
  getExtractionContentOrder,
  recommendAutoExtractionBatchSize,
  readAutoExtractionCheckpoints,
  resolveSubjectPriority,
  saveAutoExtractionCheckpoint,
  shouldPauseAutoExtraction,
  type AutoExtractionCheckpoint,
  type StorageLike,
} from "../../src/core/services/autoExtractionOrchestrationService";

class MemoryStorage implements StorageLike {
  private readonly state = new Map<string, string>();

  getItem(key: string): string | null {
    return this.state.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.state.set(key, value);
  }

  removeItem(key: string): void {
    this.state.delete(key);
  }
}

function buildCheckpoint(overrides?: Partial<AutoExtractionCheckpoint>): AutoExtractionCheckpoint {
  return {
    version: 1,
    draftId: "draft-a",
    savedAt: Date.now(),
    stage: "glossary_extract",
    subjectPriority: "science",
    contentOrder: ["vocabulary", "equations", "concepts", "keyIdeas"],
    cursor: { glossaryPageIndex: 2, glossaryTermIndex: 7 },
    completedCounts: { vocabulary: 20 },
    ...overrides,
  };
}

describe("autoExtractionOrchestrationService", () => {
  it("prioritizes science and math extraction order as vocabulary, equations, concepts, key ideas", () => {
    expect(getExtractionContentOrder({ subject: "Science" })).toEqual([
      "vocabulary",
      "equations",
      "concepts",
      "keyIdeas",
    ]);

    expect(getExtractionContentOrder({ subject: "Algebra" })).toEqual([
      "vocabulary",
      "equations",
      "concepts",
      "keyIdeas",
    ]);
  });

  it("resolves subject priorities", () => {
    expect(resolveSubjectPriority("Physical Science")).toBe("science");
    expect(resolveSubjectPriority("Geometry")).toBe("math");
    expect(resolveSubjectPriority("History")).toBe("general");
  });

  it("pauses extraction when budget thresholds are close to limit", () => {
    const decision = shouldPauseAutoExtraction({
      aiTokens: { used: 920, limit: 1000 },
      cloudReads: { used: 100, limit: 1000 },
      cloudWrites: { used: 20, limit: 1000 },
      localWrites: { used: 10, limit: 1000 },
    });

    expect(decision.shouldPause).toBe(true);
    expect(decision.reasons).toContain("ai_tokens_near_limit");
  });

  it("recommends smaller batches as headroom shrinks", () => {
    const recommendation = recommendAutoExtractionBatchSize(
      {
        aiTokens: { used: 850, limit: 1000 },
        cloudReads: { used: 300, limit: 1000 },
      },
      12,
      2
    );

    expect(recommendation.batchSize).toBeGreaterThanOrEqual(2);
    expect(recommendation.batchSize).toBeLessThan(12);
    expect(recommendation.reductionApplied).toBe(true);
  });

  it("saves and reads checkpoints in timestamp order", () => {
    const storage = new MemoryStorage();

    saveAutoExtractionCheckpoint(buildCheckpoint({ draftId: "draft-a", savedAt: 10 }), storage);
    saveAutoExtractionCheckpoint(buildCheckpoint({ draftId: "draft-b", savedAt: 20 }), storage);

    const checkpoints = readAutoExtractionCheckpoints(storage);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]?.draftId).toBe("draft-b");
    expect(checkpoints[1]?.draftId).toBe("draft-a");
  });

  it("replaces existing checkpoint by draft id and supports delete and clear", () => {
    const storage = new MemoryStorage();

    saveAutoExtractionCheckpoint(buildCheckpoint({ draftId: "draft-a", completedCounts: { vocabulary: 5 } }), storage);
    saveAutoExtractionCheckpoint(buildCheckpoint({ draftId: "draft-a", completedCounts: { vocabulary: 11 } }), storage);
    saveAutoExtractionCheckpoint(buildCheckpoint({ draftId: "draft-b" }), storage);

    const afterReplace = readAutoExtractionCheckpoints(storage);
    const draftA = afterReplace.find((entry) => entry.draftId === "draft-a");
    expect(draftA?.completedCounts.vocabulary).toBe(11);

    const afterDelete = deleteAutoExtractionCheckpoint("draft-b", storage);
    expect(afterDelete.some((entry) => entry.draftId === "draft-b")).toBe(false);

    clearAutoExtractionCheckpoints(storage);
    expect(readAutoExtractionCheckpoints(storage)).toEqual([]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { executeGlossaryLoopBatch } from "../../src/core/services/glossaryLoopExecutor";
import type { AutoExtractionCheckpoint } from "../../src/core/services/autoExtractionOrchestrationService";
import { createEmptyGuidedCaptureCuePlan, markGuidedCue } from "../../src/core/services/guidedCaptureCueService";

function buildCheckpoint(overrides?: Partial<AutoExtractionCheckpoint>): AutoExtractionCheckpoint {
  return {
    version: 1,
    draftId: "draft-1",
    savedAt: Date.now(),
    stage: "guided_navigation",
    subjectPriority: "science",
    contentOrder: ["vocabulary", "equations", "concepts", "keyIdeas"],
    cursor: {
      glossaryTermIndex: 0,
    },
    completedCounts: {},
    ...overrides,
  };
}

function buildReadyCuePlan() {
  let plan = createEmptyGuidedCaptureCuePlan("viewer.example");
  plan = markGuidedCue(plan, "openToc", { xRatio: 0.1, yRatio: 0.2 });
  plan = markGuidedCue(plan, "openGlossary", { xRatio: 0.2, yRatio: 0.3 });
  plan = markGuidedCue(plan, "nextPage", { xRatio: 0.8, yRatio: 0.55 });
  return plan;
}

describe("glossaryLoopExecutor", () => {
  it("blocks when required guided cues are missing pinned coordinates", async () => {
    const plan = createEmptyGuidedCaptureCuePlan();
    const checkpoint = buildCheckpoint();

    const captureGlossaryTermPage = vi.fn();
    const extractGlossaryTermContent = vi.fn();
    const saveCheckpoint = vi.fn(async () => undefined);

    const result = await executeGlossaryLoopBatch({
      draftId: "draft-1",
      cuePlan: plan,
      terms: [{ term: "Scientific Method", pageNumber: 87 }],
      checkpoint,
      budgetSnapshot: {
        cloudReads: { used: 0, limit: 1000 },
        cloudWrites: { used: 0, limit: 1000 },
      },
      dependencies: {
        captureGlossaryTermPage,
        extractGlossaryTermContent,
        saveCheckpoint,
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.reasons).toEqual(["openToc", "openGlossary", "nextPage"]);
    expect(captureGlossaryTermPage).not.toHaveBeenCalled();
    expect(extractGlossaryTermContent).not.toHaveBeenCalled();
  });

  it("processes a glossary batch and advances cursor", async () => {
    const checkpoint = buildCheckpoint();
    const saveCheckpoint = vi.fn(async () => undefined);

    const result = await executeGlossaryLoopBatch({
      draftId: "draft-1",
      cuePlan: buildReadyCuePlan(),
      terms: [
        { term: "Scientific Method", pageNumber: 87 },
        { term: "Significant Figures", pageNumber: 92 },
      ],
      checkpoint,
      budgetSnapshot: {
        cloudReads: { used: 100, limit: 1000 },
        cloudWrites: { used: 50, limit: 1000 },
        aiTokens: { used: 1200, limit: 8000 },
      },
      dependencies: {
        captureGlossaryTermPage: vi.fn(async (term) => ({ ocrText: `${term.term}: captured text` })),
        extractGlossaryTermContent: vi.fn(async ({ term }) => ({ term: term.term, definition: `${term.term} definition` })),
        saveCheckpoint,
      },
      maxTermsPerBatch: 1,
    });

    expect(result.status).toBe("paused");
    expect(result.reasons).toEqual(["batch_boundary"]);
    expect(result.processedCount).toBe(1);
    expect(result.extractedItems[0]?.term).toBe("Scientific Method");
    expect(result.checkpoint.cursor.glossaryTermIndex).toBe(1);
    expect(saveCheckpoint).toHaveBeenCalled();
  });

  it("pauses before processing when budget is near threshold", async () => {
    const checkpoint = buildCheckpoint();

    const result = await executeGlossaryLoopBatch({
      draftId: "draft-1",
      cuePlan: buildReadyCuePlan(),
      terms: [{ term: "Scientific Method" }],
      checkpoint,
      budgetSnapshot: {
        aiTokens: { used: 920, limit: 1000 },
      },
      dependencies: {
        captureGlossaryTermPage: vi.fn(async () => ({ ocrText: "text" })),
        extractGlossaryTermContent: vi.fn(async () => ({ term: "Scientific Method" })),
        saveCheckpoint: vi.fn(async () => undefined),
      },
    });

    expect(result.status).toBe("paused");
    expect(result.reasons).toContain("ai_tokens_near_limit");
    expect(result.processedCount).toBe(0);
  });
});

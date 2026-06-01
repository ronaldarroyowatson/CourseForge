import {
  shouldPauseAutoExtraction,
  type AutoExtractionCheckpoint,
  type ExtractionBudgetSnapshot,
} from "./autoExtractionOrchestrationService";
import {
  getMissingGuidedCuesForAutomation,
  type GuidedCaptureCuePlan,
} from "./guidedCaptureCueService";

export interface GlossaryLoopTerm {
  term: string;
  pageNumber?: number;
}

export interface GlossaryLoopExtractedItem {
  term: string;
  definition?: string;
  equations?: string[];
  concepts?: string[];
  keyIdeas?: string[];
}

export interface GlossaryLoopDependencies {
  captureGlossaryTermPage: (term: GlossaryLoopTerm, termIndex: number) => Promise<{ ocrText: string }>;
  extractGlossaryTermContent: (payload: { term: GlossaryLoopTerm; ocrText: string }) => Promise<GlossaryLoopExtractedItem>;
  saveCheckpoint: (checkpoint: AutoExtractionCheckpoint) => Promise<void>;
}

export interface GlossaryLoopExecutionInput {
  draftId: string;
  cuePlan: GuidedCaptureCuePlan;
  terms: GlossaryLoopTerm[];
  checkpoint: AutoExtractionCheckpoint;
  budgetSnapshot: ExtractionBudgetSnapshot;
  dependencies: GlossaryLoopDependencies;
  maxTermsPerBatch?: number;
}

export interface GlossaryLoopExecutionResult {
  status: "blocked" | "paused" | "completed" | "error";
  processedCount: number;
  extractedItems: GlossaryLoopExtractedItem[];
  checkpoint: AutoExtractionCheckpoint;
  reasons?: string[];
  errorMessage?: string;
}

const DEFAULT_MAX_TERMS_PER_BATCH = 5;

export async function executeGlossaryLoopBatch(input: GlossaryLoopExecutionInput): Promise<GlossaryLoopExecutionResult> {
  const {
    draftId,
    cuePlan,
    terms,
    budgetSnapshot,
    dependencies,
    maxTermsPerBatch = DEFAULT_MAX_TERMS_PER_BATCH,
  } = input;

  const missingCues = getMissingGuidedCuesForAutomation(cuePlan);
  if (missingCues.length > 0) {
    return {
      status: "blocked",
      processedCount: 0,
      extractedItems: [],
      checkpoint: {
        ...input.checkpoint,
        draftId,
        stage: "guided_navigation",
        savedAt: Date.now(),
        pauseReason: "missing_guided_cues",
      },
      reasons: missingCues,
    };
  }

  const pauseDecision = shouldPauseAutoExtraction(budgetSnapshot);
  if (pauseDecision.shouldPause) {
    return {
      status: "paused",
      processedCount: 0,
      extractedItems: [],
      checkpoint: {
        ...input.checkpoint,
        draftId,
        stage: "glossary_capture",
        savedAt: Date.now(),
        pauseReason: pauseDecision.reasons.join(","),
      },
      reasons: pauseDecision.reasons,
    };
  }

  const startIndex = Math.max(0, input.checkpoint.cursor.glossaryTermIndex ?? 0);
  const batchLimit = Math.max(1, Math.floor(maxTermsPerBatch));
  const extractedItems: GlossaryLoopExtractedItem[] = [];

  let checkpoint: AutoExtractionCheckpoint = {
    ...input.checkpoint,
    draftId,
    stage: "glossary_capture",
    savedAt: Date.now(),
    pauseReason: undefined,
  };

  for (let termIndex = startIndex; termIndex < terms.length && extractedItems.length < batchLimit; termIndex += 1) {
    const term = terms[termIndex];
    if (!term) {
      continue;
    }

    checkpoint = {
      ...checkpoint,
      stage: "glossary_capture",
      savedAt: Date.now(),
      cursor: {
        ...checkpoint.cursor,
        glossaryTermIndex: termIndex,
      },
    };
    await dependencies.saveCheckpoint(checkpoint);

    try {
      const captureResult = await dependencies.captureGlossaryTermPage(term, termIndex);

      checkpoint = {
        ...checkpoint,
        stage: "glossary_extract",
        savedAt: Date.now(),
      };
      await dependencies.saveCheckpoint(checkpoint);

      const extracted = await dependencies.extractGlossaryTermContent({
        term,
        ocrText: captureResult.ocrText,
      });

      extractedItems.push(extracted);

      checkpoint = {
        ...checkpoint,
        stage: "glossary_extract",
        savedAt: Date.now(),
        cursor: {
          ...checkpoint.cursor,
          glossaryTermIndex: termIndex + 1,
        },
        completedCounts: {
          ...checkpoint.completedCounts,
          vocabulary: (checkpoint.completedCounts.vocabulary ?? 0) + 1,
        },
      };
      await dependencies.saveCheckpoint(checkpoint);
    } catch (error) {
      return {
        status: "error",
        processedCount: extractedItems.length,
        extractedItems,
        checkpoint: {
          ...checkpoint,
          savedAt: Date.now(),
          pauseReason: "glossary_capture_error",
        },
        errorMessage: error instanceof Error ? error.message : "Unknown glossary loop failure",
      };
    }
  }

  const finished = (checkpoint.cursor.glossaryTermIndex ?? 0) >= terms.length;
  const finalCheckpoint: AutoExtractionCheckpoint = {
    ...checkpoint,
    stage: finished ? "persist" : "glossary_extract",
    savedAt: Date.now(),
    pauseReason: finished ? undefined : "batch_boundary",
  };
  await dependencies.saveCheckpoint(finalCheckpoint);

  return {
    status: finished ? "completed" : "paused",
    processedCount: extractedItems.length,
    extractedItems,
    checkpoint: finalCheckpoint,
    reasons: finished ? undefined : ["batch_boundary"],
  };
}

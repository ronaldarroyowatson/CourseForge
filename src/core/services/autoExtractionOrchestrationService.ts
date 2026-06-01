export type ExtractionSubjectPriority = "science" | "math" | "general";

export type ExtractionContentType = "vocabulary" | "equations" | "concepts" | "keyIdeas";

export interface ExtractionContentOrderRequest {
  subject?: string | null;
}

export const SCIENCE_FIRST_EXTRACTION_ORDER: ExtractionContentType[] = [
  "vocabulary",
  "equations",
  "concepts",
  "keyIdeas",
];

const GENERAL_EXTRACTION_ORDER: ExtractionContentType[] = [
  "vocabulary",
  "concepts",
  "keyIdeas",
  "equations",
];

export interface BudgetMetricSnapshot {
  used: number;
  limit: number;
}

export interface ExtractionBudgetSnapshot {
  aiTokens?: BudgetMetricSnapshot;
  cloudReads?: BudgetMetricSnapshot;
  cloudWrites?: BudgetMetricSnapshot;
  localWrites?: BudgetMetricSnapshot;
}

export interface ExtractionBudgetThresholds {
  aiTokens: number;
  cloudReads: number;
  cloudWrites: number;
  localWrites: number;
}

export interface ExtractionPauseDecision {
  shouldPause: boolean;
  reasons: string[];
  maxUsageRatio: number;
}

export interface ExtractionBatchRecommendation {
  batchSize: number;
  reductionApplied: boolean;
  minHeadroomRatio: number;
}

export type AutoExtractionStage =
  | "guided_navigation"
  | "glossary_capture"
  | "glossary_extract"
  | "section_capture"
  | "section_extract"
  | "persist";

export interface AutoExtractionCursor {
  chapterIndex?: number;
  sectionIndex?: number;
  pageNumber?: number;
  glossaryPageIndex?: number;
  glossaryTermIndex?: number;
}

export interface AutoExtractionCheckpoint {
  version: 1;
  draftId: string;
  savedAt: number;
  stage: AutoExtractionStage;
  subjectPriority: ExtractionSubjectPriority;
  contentOrder: ExtractionContentType[];
  cursor: AutoExtractionCursor;
  completedCounts: Partial<Record<ExtractionContentType, number>>;
  pauseReason?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AUTO_EXTRACTION_CHECKPOINTS_STORAGE_KEY = "courseforge.autoExtractionCheckpoints.v1";

const DEFAULT_THRESHOLDS: ExtractionBudgetThresholds = {
  aiTokens: 0.92,
  cloudReads: 0.92,
  cloudWrites: 0.92,
  localWrites: 0.96,
};

export function resolveSubjectPriority(subject?: string | null): ExtractionSubjectPriority {
  const normalized = (subject ?? "").trim().toLowerCase();

  if (normalized.includes("science") || normalized.includes("biology") || normalized.includes("chemistry") || normalized.includes("physics")) {
    return "science";
  }

  if (normalized.includes("math") || normalized.includes("algebra") || normalized.includes("geometry") || normalized.includes("calculus")) {
    return "math";
  }

  return "general";
}

export function getExtractionContentOrder(request: ExtractionContentOrderRequest): ExtractionContentType[] {
  const priority = resolveSubjectPriority(request.subject);
  return priority === "science" || priority === "math"
    ? [...SCIENCE_FIRST_EXTRACTION_ORDER]
    : [...GENERAL_EXTRACTION_ORDER];
}

export function getUsageRatio(metric?: BudgetMetricSnapshot): number {
  if (!metric) {
    return 0;
  }

  const safeLimit = Number.isFinite(metric.limit) ? metric.limit : 0;
  const safeUsed = Number.isFinite(metric.used) ? metric.used : 0;

  if (safeLimit <= 0 || safeUsed <= 0) {
    return 0;
  }

  return Math.max(0, safeUsed / safeLimit);
}

export function shouldPauseAutoExtraction(
  snapshot: ExtractionBudgetSnapshot,
  thresholds?: Partial<ExtractionBudgetThresholds>
): ExtractionPauseDecision {
  const appliedThresholds: ExtractionBudgetThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const ratios = {
    aiTokens: getUsageRatio(snapshot.aiTokens),
    cloudReads: getUsageRatio(snapshot.cloudReads),
    cloudWrites: getUsageRatio(snapshot.cloudWrites),
    localWrites: getUsageRatio(snapshot.localWrites),
  };

  const reasons: string[] = [];

  if (ratios.aiTokens >= appliedThresholds.aiTokens) {
    reasons.push("ai_tokens_near_limit");
  }

  if (ratios.cloudReads >= appliedThresholds.cloudReads) {
    reasons.push("cloud_reads_near_limit");
  }

  if (ratios.cloudWrites >= appliedThresholds.cloudWrites) {
    reasons.push("cloud_writes_near_limit");
  }

  if (ratios.localWrites >= appliedThresholds.localWrites) {
    reasons.push("local_writes_near_limit");
  }

  return {
    shouldPause: reasons.length > 0,
    reasons,
    maxUsageRatio: Math.max(ratios.aiTokens, ratios.cloudReads, ratios.cloudWrites, ratios.localWrites),
  };
}

export function recommendAutoExtractionBatchSize(
  snapshot: ExtractionBudgetSnapshot,
  maxBatchSize: number,
  minBatchSize = 1
): ExtractionBatchRecommendation {
  const normalizedMaxBatch = Number.isFinite(maxBatchSize) ? Math.max(1, Math.floor(maxBatchSize)) : 1;
  const normalizedMinBatch = Number.isFinite(minBatchSize)
    ? Math.max(1, Math.min(Math.floor(minBatchSize), normalizedMaxBatch))
    : 1;

  const headrooms = [
    1 - getUsageRatio(snapshot.aiTokens),
    1 - getUsageRatio(snapshot.cloudReads),
    1 - getUsageRatio(snapshot.cloudWrites),
    1 - getUsageRatio(snapshot.localWrites),
  ].filter((value) => Number.isFinite(value));

  const minHeadroomRatio = headrooms.length > 0
    ? Math.max(0, Math.min(...headrooms))
    : 1;

  const scaled = Math.floor(normalizedMaxBatch * Math.max(0.1, minHeadroomRatio));
  const batchSize = Math.max(normalizedMinBatch, Math.min(normalizedMaxBatch, scaled));

  return {
    batchSize,
    reductionApplied: batchSize < normalizedMaxBatch,
    minHeadroomRatio,
  };
}

function isValidCheckpoint(value: unknown): value is AutoExtractionCheckpoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const checkpoint = value as Partial<AutoExtractionCheckpoint>;

  return (
    checkpoint.version === 1
    && typeof checkpoint.draftId === "string"
    && checkpoint.draftId.trim().length > 0
    && typeof checkpoint.savedAt === "number"
    && Number.isFinite(checkpoint.savedAt)
    && typeof checkpoint.stage === "string"
    && typeof checkpoint.subjectPriority === "string"
    && Array.isArray(checkpoint.contentOrder)
    && typeof checkpoint.cursor === "object"
    && checkpoint.cursor !== null
    && typeof checkpoint.completedCounts === "object"
    && checkpoint.completedCounts !== null
  );
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function readAutoExtractionCheckpoints(storage?: StorageLike | null): AutoExtractionCheckpoint[] {
  const storageRef = storage ?? getBrowserStorage();
  if (!storageRef) {
    return [];
  }

  try {
    const raw = storageRef.getItem(AUTO_EXTRACTION_CHECKPOINTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed.filter((value): value is AutoExtractionCheckpoint => isValidCheckpoint(value));
    normalized.sort((a, b) => b.savedAt - a.savedAt);
    return normalized;
  } catch {
    return [];
  }
}

export function saveAutoExtractionCheckpoint(
  checkpoint: AutoExtractionCheckpoint,
  storage?: StorageLike | null
): AutoExtractionCheckpoint[] {
  const storageRef = storage ?? getBrowserStorage();
  if (!storageRef) {
    return [];
  }

  const existing = readAutoExtractionCheckpoints(storageRef).filter((entry) => entry.draftId !== checkpoint.draftId);
  const normalizedCheckpoint: AutoExtractionCheckpoint = {
    ...checkpoint,
    version: 1,
    savedAt: Date.now(),
  };
  const merged: AutoExtractionCheckpoint[] = [normalizedCheckpoint, ...existing].sort((a, b) => b.savedAt - a.savedAt);

  try {
    storageRef.setItem(AUTO_EXTRACTION_CHECKPOINTS_STORAGE_KEY, JSON.stringify(merged.slice(0, 20)));
    return merged;
  } catch {
    return readAutoExtractionCheckpoints(storageRef);
  }
}

export function deleteAutoExtractionCheckpoint(draftId: string, storage?: StorageLike | null): AutoExtractionCheckpoint[] {
  const storageRef = storage ?? getBrowserStorage();
  if (!storageRef) {
    return [];
  }

  const filtered = readAutoExtractionCheckpoints(storageRef).filter((entry) => entry.draftId !== draftId);

  try {
    storageRef.setItem(AUTO_EXTRACTION_CHECKPOINTS_STORAGE_KEY, JSON.stringify(filtered));
    return filtered;
  } catch {
    return readAutoExtractionCheckpoints(storageRef);
  }
}

export function clearAutoExtractionCheckpoints(storage?: StorageLike | null): void {
  const storageRef = storage ?? getBrowserStorage();
  if (!storageRef) {
    return;
  }

  storageRef.removeItem(AUTO_EXTRACTION_CHECKPOINTS_STORAGE_KEY);
}

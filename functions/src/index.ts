import dotenv from "dotenv";
import * as admin from "firebase-admin";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  analyzeDocumentQuality,
  buildExtractionPrompts,
  createEmptyExtractionData,
  extractReadableDocumentText,
  mergeQualityReports,
  type DocumentExtractionContext,
  type ExtractedDocumentData,
  type ExtractionQualityReport,
} from "./documentExtraction";

dotenv.config();

const openAiKeySecret = defineSecret("OPENAI_API_KEY");

admin.initializeApp();

const auth = admin.auth();
const firestore = admin.firestore();
const SUPPORTED_COLLECTIONS = ["textbooks", "chapters", "sections", "vocab", "equations", "concepts", "keyIdeas"] as const;
type SupportedCollection = (typeof SUPPORTED_COLLECTIONS)[number];

type ContentStatus = "draft" | "submitted" | "approved" | "rejected";

interface CallableResult<T> {
  success: boolean;
  message: string;
  data: T;
}

type DifficultyLevel = 1 | 2 | 3;

interface TieredQuestionSourceMetadata {
  sourceType: string;
  originalFilename: string;
  variationAllowed: boolean;
  educationalContext?: {
    textbookTitle?: string;
    textbookSubject?: string;
    gradeLevel?: number;
    targetReadingLevel?: number;
  };
  inferredLocation?: {
    chapter?: number;
    section?: number;
  };
}

interface TieredVariationGenerationContext {
  textbookTitle?: string;
  textbookSubject?: string;
  gradeLevel?: number;
  level2TargetReadingGrade?: number;
  level3TargetReadingGrade?: number;
}

interface TieredQuestionSeedItem {
  id: string;
  contentType: "vocab" | "concept";
  question: string;
  correctAnswer: string;
  sourceMetadata: TieredQuestionSourceMetadata;
}

interface TieredQuestionItem {
  id: string;
  baseItemId: string;
  contentType: "vocab" | "concept";
  question: string;
  correctAnswer: string;
  distractors: string[];
  difficultyLevel: DifficultyLevel;
  isOriginal: boolean;
  variationOf: string | null;
  sourceMetadata: TieredQuestionSourceMetadata;
}

interface AdminUserRecord {
  uid: string;
  displayName: string;
  email: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  isAdmin: boolean;
  isContentBlocked?: boolean;
  contentBlockReason?: string | null;
}

interface PremiumUsageState {
  premiumRequestsUsedToday: number;
  premiumRequestsUsedThisWeek: number;
  premiumRequestsUsedThisMonth: number;
  dailyLimitPercent: number;
  weeklyLimitPercent: number;
  monthlyLimitPercent: number;
  freezePremium: boolean;
  lastResetDate: string;
  lastResetWeek: string;
  lastResetMonth: string;
}

interface AdminPremiumUsageRow {
  uid: string;
  email: string;
  displayName: string;
  premiumTier: string;
  premiumUsage: PremiumUsageState;
}

interface ModerationItem {
  docPath: string;
  collectionName: SupportedCollection;
  ownerId: string;
  ownerEmail: string | null;
  title: string;
  currentStatus: ContentStatus;
  lastModified: string | null;
  isArchived?: boolean;
}

function getOpenAiApiKey(): string {
  const candidates = [
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_KEY,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

interface AdminContentRecord {
  docPath: string;
  id: string;
  collectionName: SupportedCollection;
  ownerId: string;
  ownerEmail: string | null;
  title: string;
  grade?: string;
  subject?: string;
  edition?: string;
  publicationYear?: number;
  isbnRaw?: string;
  summary?: string;
  status: ContentStatus;
  isArchived: boolean;
  isDeleted: boolean;
  lastModified: string | null;
}

type AutoOcrProviderId = "local_tesseract" | "cloud_openai_vision";

interface AiProviderPolicyRecord {
  providerOrder: AutoOcrProviderId[];
  updatedBy: string;
  updatedAt: string;
}

interface DebugLoggingPolicyRecord {
  enabledGlobally: boolean;
  disabledUserIds: string[];
  maxUploadBytes: number;
  maxLocalLogBytes: number;
  updatedBy: string;
  updatedAt: string;
}

interface DebugLogEntryRecord {
  id: string;
  timestamp: number;
  eventType: string;
  message: string;
  context?: Record<string, unknown>;
  errorStack?: string;
  autoModeStep?: string;
  captureMetadata?: {
    width?: number;
    height?: number;
    dpi?: number;
    fileSizeBytes?: number;
  };
  sizeBytes: number;
}

interface DebugUploadSummary {
  reportPath: string;
  userId: string;
  createdAt: string;
  uploadedAtMs: number;
  totalSizeBytes: number;
  entriesCount: number;
  appVersion?: string;
}

type MetadataPageType = "cover" | "title" | "other";

interface MetadataResultRecord {
  title: string | null;
  subtitle: string | null;
  edition: string | null;
  publisher: string | null;
  series: string | null;
  gradeLevel: string | null;
  subject: string | null;
  confidence: number;
  rawText: string;
  source: "vision" | "ocr" | "vision+ocr";
}

interface MetadataCorrectionRecord {
  id: string;
  timestamp: string;
  pageType: MetadataPageType;
  publisher: string | null;
  series: string | null;
  subject: string | null;
  originalVisionOutput: MetadataResultRecord | null;
  originalOcrOutput: {
    rawText: string;
  } | null;
  finalMetadata: MetadataResultRecord;
  imageReference: string | null;
  flagged: boolean;
  reasonFlagged?: string;
  finalConfidence: number;
  errorScore: number;
  reviewedByAdmin?: string | null;
  reviewStatus: "pending" | "accepted" | "rejected";
}

interface MetadataCorrectionRulesRecord {
  version: string;
  updatedAt: string;
  globalReplacements: Array<{ from: string; to: string }>;
  publisherSpecific: {
    [publisherName: string]: {
      replacements: Array<{ from: string; to: string }>;
      patterns?: Array<{ pattern: string; replacement: string }>;
    };
  };
}

function success<T>(message: string, data: T): CallableResult<T> {
  return { success: true, message, data };
}

function assertAdmin(authData: { token?: Record<string, unknown> } | null | undefined): void {
  if (!authData) {
    throw new HttpsError("unauthenticated", "You must be signed in to use admin functions.");
  }

  if (authData.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin privileges are required for this action.");
  }
}

function toIsoString(value: unknown): string | null {
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === "string" ? value : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

const MONTHLY_BASELINE_PERCENT = 8.6;
const DAILY_BASELINE_MULTIPLIER = 0.4;
const WEEKLY_BASELINE_MULTIPLIER = 2.7;
const MONTHLY_LIMIT_PERCENT = 100;
const AI_PROVIDER_POLICY_DOC_PATH = "config/aiProviderPolicy";
const DEBUG_POLICY_DOC_PATH = "config/debugLoggingPolicy";
const METADATA_CORRECTION_RULES_DOC_PATH = "config/metadataCorrectionRules";
const METADATA_CORRECTION_LIMITS_DOC_PATH = "config/metadataCorrectionLimits";
const METADATA_CORRECTION_AUDIT_COLLECTION = "metadataCorrectionAuditLogs";
const DEFAULT_AUTO_OCR_PROVIDER_ORDER: AutoOcrProviderId[] = ["local_tesseract", "cloud_openai_vision"];
const DEFAULT_DEBUG_POLICY: DebugLoggingPolicyRecord = {
  enabledGlobally: true,
  disabledUserIds: [],
  maxUploadBytes: 500 * 1024,
  maxLocalLogBytes: 1_500_000,
  updatedBy: "system",
  updatedAt: new Date(0).toISOString(),
};
const OCR_RATE_LIMIT_WINDOW_MS = 60_000;
const OCR_RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_OCR_IMAGE_DATA_URL_BYTES = 8 * 1024 * 1024;
const DEFAULT_CORRECTION_DAILY_LIMIT = 25;
const DEFAULT_CORRECTION_MAX_IMAGE_BYTES = 200 * 1024;
const DEFAULT_CORRECTION_MIN_UPLOAD_INTERVAL_SECONDS = 5;

function roundToOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function normalizeAutoOcrProviderOrder(value: unknown): AutoOcrProviderId[] {
  if (!Array.isArray(value)) {
    return DEFAULT_AUTO_OCR_PROVIDER_ORDER;
  }

  const accepted = value
    .filter((entry): entry is AutoOcrProviderId => entry === "local_tesseract" || entry === "cloud_openai_vision")
    .filter((entry, index, array) => array.indexOf(entry) === index);

  if (!accepted.length) {
    return DEFAULT_AUTO_OCR_PROVIDER_ORDER;
  }

  for (const provider of DEFAULT_AUTO_OCR_PROVIDER_ORDER) {
    if (!accepted.includes(provider)) {
      accepted.push(provider);
    }
  }

  return accepted;
}

function normalizeDebugLoggingPolicy(value: unknown): DebugLoggingPolicyRecord {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const disabledUserIds = Array.isArray(data.disabledUserIds)
    ? data.disabledUserIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  const maxUploadBytesRaw = typeof data.maxUploadBytes === "number" ? data.maxUploadBytes : DEFAULT_DEBUG_POLICY.maxUploadBytes;
  const maxLocalLogBytesRaw = typeof data.maxLocalLogBytes === "number" ? data.maxLocalLogBytes : DEFAULT_DEBUG_POLICY.maxLocalLogBytes;

  return {
    enabledGlobally: data.enabledGlobally !== false,
    disabledUserIds: disabledUserIds.slice(0, 500),
    maxUploadBytes: Math.max(64 * 1024, Math.min(2 * 1024 * 1024, Math.round(maxUploadBytesRaw))),
    maxLocalLogBytes: Math.max(256 * 1024, Math.min(4 * 1024 * 1024, Math.round(maxLocalLogBytesRaw))),
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : DEFAULT_DEBUG_POLICY.updatedBy,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : DEFAULT_DEBUG_POLICY.updatedAt,
  };
}

async function getDebugLoggingPolicyRecord(): Promise<DebugLoggingPolicyRecord> {
  const snapshot = await firestore.doc(DEBUG_POLICY_DOC_PATH).get();
  if (!snapshot.exists) {
    return DEFAULT_DEBUG_POLICY;
  }

  return normalizeDebugLoggingPolicy(snapshot.data());
}

function sanitizeDebugLogEntries(value: unknown): DebugLogEntryRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): DebugLogEntryRecord | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const timestamp = typeof record.timestamp === "number" ? record.timestamp : 0;
      const eventType = typeof record.eventType === "string" ? record.eventType : "info";
      const message = typeof record.message === "string" ? record.message : "";
      const sizeBytes = typeof record.sizeBytes === "number" ? record.sizeBytes : 0;

      if (!id || !message || timestamp <= 0 || sizeBytes <= 0) {
        return null;
      }

      return {
        id,
        timestamp,
        eventType,
        message,
        context: typeof record.context === "object" && record.context !== null ? record.context as Record<string, unknown> : undefined,
        errorStack: typeof record.errorStack === "string" ? record.errorStack : undefined,
        autoModeStep: typeof record.autoModeStep === "string" ? record.autoModeStep : undefined,
        captureMetadata: typeof record.captureMetadata === "object" && record.captureMetadata !== null
          ? record.captureMetadata as DebugLogEntryRecord["captureMetadata"]
          : undefined,
        sizeBytes,
      };
    })
    .filter((entry): entry is DebugLogEntryRecord => entry !== null);
}

function sanitizeMetadataResult(value: unknown, source: MetadataResultRecord["source"]): MetadataResultRecord {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const asText = (field: string): string | null => {
    const raw = data[field];
    if (typeof raw !== "string") {
      return null;
    }

    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  };

  const confidenceRaw = typeof data.confidence === "number" ? data.confidence : 0;
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;

  return {
    title: asText("title"),
    subtitle: asText("subtitle"),
    edition: asText("edition"),
    publisher: asText("publisher"),
    series: asText("series"),
    gradeLevel: asText("gradeLevel"),
    subject: asText("subject"),
    confidence,
    rawText: typeof data.rawText === "string" ? data.rawText : "",
    source,
  };
}

function sanitizeMetadataCorrectionRecords(value: unknown): MetadataCorrectionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): MetadataCorrectionRecord | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";
      const pageType = record.pageType === "cover" || record.pageType === "title" || record.pageType === "other"
        ? record.pageType
        : "other";

      if (!id || !timestamp) {
        return null;
      }

      const finalMetadata = sanitizeMetadataResult(record.finalMetadata, "vision+ocr");
      const finalConfidenceRaw = typeof record.finalConfidence === "number" ? record.finalConfidence : finalMetadata.confidence;
      const finalConfidence = Number.isFinite(finalConfidenceRaw) ? Math.max(0, Math.min(1, finalConfidenceRaw)) : finalMetadata.confidence;
      const visionConfidence = record.originalVisionOutput
        ? sanitizeMetadataResult(record.originalVisionOutput, "vision").confidence
        : finalConfidence;
      const errorScoreRaw = typeof record.errorScore === "number"
        ? record.errorScore
        : Math.abs(visionConfidence - finalConfidence);
      const errorScore = Number.isFinite(errorScoreRaw) ? Math.max(0, Math.min(1, errorScoreRaw)) : 0;
      const flagged = Boolean(record.flagged);
      const reasonFlagged = typeof record.reasonFlagged === "string" && record.reasonFlagged.trim()
        ? record.reasonFlagged.trim()
        : undefined;
      const reviewStatus = record.reviewStatus === "accepted" || record.reviewStatus === "rejected" || record.reviewStatus === "pending"
        ? record.reviewStatus
        : "pending";

      return {
        id,
        timestamp,
        pageType,
        publisher: typeof record.publisher === "string" && record.publisher.trim() ? record.publisher.trim() : null,
        series: typeof record.series === "string" && record.series.trim() ? record.series.trim() : null,
        subject: typeof record.subject === "string" && record.subject.trim() ? record.subject.trim() : null,
        originalVisionOutput: record.originalVisionOutput
          ? sanitizeMetadataResult(record.originalVisionOutput, "vision")
          : null,
        originalOcrOutput: typeof record.originalOcrOutput === "object" && record.originalOcrOutput !== null
          ? {
              rawText: typeof (record.originalOcrOutput as Record<string, unknown>).rawText === "string"
                ? (record.originalOcrOutput as Record<string, unknown>).rawText as string
                : "",
            }
          : null,
        finalMetadata,
        imageReference: typeof record.imageReference === "string" && record.imageReference.trim()
          ? record.imageReference.trim()
          : null,
        flagged,
        reasonFlagged,
        finalConfidence,
        errorScore,
        reviewedByAdmin: typeof record.reviewedByAdmin === "string" && record.reviewedByAdmin.trim()
          ? record.reviewedByAdmin.trim()
          : null,
        reviewStatus,
      };
    })
    .filter((entry): entry is MetadataCorrectionRecord => entry !== null)
    .slice(-200);
}

function normalizePublisherRuleKey(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeMetadataCorrectionRules(value: unknown): MetadataCorrectionRulesRecord {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const globalReplacements = Array.isArray(data.globalReplacements)
    ? data.globalReplacements
      .filter((entry) => typeof (entry as { from?: unknown })?.from === "string" && typeof (entry as { to?: unknown })?.to === "string")
      .map((entry) => ({
        from: ((entry as { from: string }).from).trim(),
        to: ((entry as { to: string }).to).trim(),
      }))
      .filter((entry) => entry.from && entry.to && entry.from !== entry.to)
      .slice(0, 200)
    : [];

  const publisherSpecificRaw = typeof data.publisherSpecific === "object" && data.publisherSpecific !== null
    ? data.publisherSpecific as Record<string, unknown>
    : {};

  const publisherSpecific: MetadataCorrectionRulesRecord["publisherSpecific"] = {};
  for (const [publisher, valueEntry] of Object.entries(publisherSpecificRaw)) {
    const normalizedPublisher = normalizePublisherRuleKey(publisher);
    if (!normalizedPublisher) {
      continue;
    }

    const entry = valueEntry as { replacements?: unknown; patterns?: unknown };
    const replacements = Array.isArray(entry.replacements)
      ? entry.replacements
        .filter((item) => typeof (item as { from?: unknown })?.from === "string" && typeof (item as { to?: unknown })?.to === "string")
        .map((item) => ({
          from: ((item as { from: string }).from).trim(),
          to: ((item as { to: string }).to).trim(),
        }))
        .filter((item) => item.from && item.to && item.from !== item.to)
        .slice(0, 100)
      : [];

    if (!replacements.length) {
      continue;
    }

    publisherSpecific[normalizedPublisher] = { replacements };
  }

  return {
    version: typeof data.version === "string" ? data.version : "1",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    globalReplacements,
    publisherSpecific,
  };
}

function estimateImageReferenceBytes(imageReference: string | null): number {
  if (!imageReference) {
    return 0;
  }

  if (imageReference.startsWith("data:image/")) {
    const commaIndex = imageReference.indexOf(",");
    if (commaIndex >= 0) {
      const base64 = imageReference.slice(commaIndex + 1);
      return Math.ceil((base64.length * 3) / 4);
    }
  }

  return Buffer.byteLength(imageReference, "utf8");
}

function validateCorrectionForQueue(record: MetadataCorrectionRecord): { valid: boolean; reason?: string } {
  if (!record.finalMetadata.title || !record.finalMetadata.title.trim()) {
    return { valid: false, reason: "Title is required." };
  }

  if (!record.originalVisionOutput && !record.originalOcrOutput) {
    return { valid: false, reason: "At least one source output is required." };
  }

  if (!record.imageReference) {
    return { valid: false, reason: "Image snippet reference is required." };
  }

  const imageRef = record.imageReference.trim();
  const imageReferenceValid = imageRef.startsWith("data:image/")
    || imageRef.startsWith("hash://")
    || imageRef.startsWith("blob:")
    || imageRef.startsWith("https://")
    || imageRef.startsWith("http://");

  if (!imageReferenceValid) {
    return { valid: false, reason: "Image snippet reference is invalid." };
  }

  if (estimateImageReferenceBytes(record.imageReference) > DEFAULT_CORRECTION_MAX_IMAGE_BYTES) {
    return { valid: false, reason: `Image snippet exceeds ${DEFAULT_CORRECTION_MAX_IMAGE_BYTES} bytes.` };
  }

  return { valid: true };
}

function detectSuspiciousCorrection(record: MetadataCorrectionRecord): { suspicious: boolean; reason?: string } {
  const combined = [
    record.finalMetadata.title,
    record.finalMetadata.subtitle,
    record.finalMetadata.publisher,
    record.finalMetadata.series,
    record.finalMetadata.subject,
    record.finalMetadata.rawText,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");

  const randomLikeRuns = (combined.match(/[A-Za-z0-9]{10,}/g) ?? []).filter((entry) => !/[aeiou]/i.test(entry));
  if (randomLikeRuns.length >= 3) {
    return { suspicious: true, reason: "Contains excessive random character sequences." };
  }

  const symbolRatio = (combined.match(/[^A-Za-z0-9\s]/g) ?? []).length / Math.max(1, combined.length);
  if (symbolRatio > 0.28) {
    return { suspicious: true, reason: "Contains too many non-text symbols for textbook metadata." };
  }

  const publisher = (record.finalMetadata.publisher ?? "").toLowerCase();
  const priorPublisher = (record.originalVisionOutput?.publisher ?? "").toLowerCase();
  if (publisher && priorPublisher && publisher !== priorPublisher) {
    const looksNonsense = publisher.length < 3 || !/[aeiou]/.test(publisher) || /[0-9]{3,}/.test(publisher);
    if (looksNonsense) {
      return { suspicious: true, reason: "Publisher overwrite appears to be nonsense." };
    }
  }

  return { suspicious: false };
}

function filterAndSortCorrections(
  records: MetadataCorrectionRecord[],
  query: {
    publisher?: string;
    pageType?: string;
    confidenceMin?: number;
    confidenceMax?: number;
    source?: string;
    flaggedOnly?: boolean;
    reviewStatus?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: "timestamp" | "errorScore" | "finalConfidence";
    sortDirection?: "asc" | "desc";
  }
): MetadataCorrectionRecord[] {
  const filtered = records.filter((record) => {
    if (query.publisher && normalizePublisherRuleKey(record.publisher) !== normalizePublisherRuleKey(query.publisher)) {
      return false;
    }

    if (query.pageType && query.pageType !== "all" && record.pageType !== query.pageType) {
      return false;
    }

    if (query.source && query.source !== "all" && record.finalMetadata.source !== query.source) {
      return false;
    }

    if (query.flaggedOnly && !record.flagged) {
      return false;
    }

    if (query.reviewStatus && query.reviewStatus !== "all" && record.reviewStatus !== query.reviewStatus) {
      return false;
    }

    if (typeof query.confidenceMin === "number" && record.finalConfidence < query.confidenceMin) {
      return false;
    }

    if (typeof query.confidenceMax === "number" && record.finalConfidence > query.confidenceMax) {
      return false;
    }

    if (query.dateFrom && record.timestamp < query.dateFrom) {
      return false;
    }

    if (query.dateTo && record.timestamp > query.dateTo) {
      return false;
    }

    return true;
  });

  const sortBy = query.sortBy ?? "errorScore";
  const sortDirection = query.sortDirection ?? "desc";
  const direction = sortDirection === "desc" ? -1 : 1;

  filtered.sort((left, right) => {
    if (sortBy === "timestamp") {
      return left.timestamp.localeCompare(right.timestamp) * direction;
    }
    if (sortBy === "finalConfidence") {
      return (left.finalConfidence - right.finalConfidence) * direction;
    }
    return (left.errorScore - right.errorScore) * direction;
  });

  return filtered;
}

async function appendMetadataCorrectionAuditLog(entry: {
  actorId: string;
  action: string;
  targetIds: string[];
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  await firestore.collection(METADATA_CORRECTION_AUDIT_COLLECTION).doc(id).set({
    id,
    actorId: entry.actorId,
    action: entry.action,
    targetIds: entry.targetIds,
    before: entry.before,
    after: entry.after,
    timestamp: new Date().toISOString(),
  }, { merge: false });
}

function buildRulesFromCorrections(
  corrections: MetadataCorrectionRecord[],
  priorRules: MetadataCorrectionRulesRecord
): MetadataCorrectionRulesRecord {
  const frequency = new Map<string, { from: string; to: string; count: number; publisherKey: string }>();

  for (const correction of corrections) {
    const publisherKey = normalizePublisherRuleKey(correction.publisher ?? correction.finalMetadata.publisher);
    const sourceCandidates = [
      correction.originalVisionOutput?.title,
      correction.originalVisionOutput?.publisher,
      correction.originalVisionOutput?.series,
      correction.originalVisionOutput?.edition,
    ];
    const targetCandidates = [
      correction.finalMetadata.title,
      correction.finalMetadata.publisher,
      correction.finalMetadata.series,
      correction.finalMetadata.edition,
    ];

    for (let index = 0; index < sourceCandidates.length; index += 1) {
      const from = sourceCandidates[index]?.trim();
      const to = targetCandidates[index]?.trim();
      if (!from || !to || from.toLowerCase() === to.toLowerCase()) {
        continue;
      }

      const key = `${from.toLowerCase()}=>${to.toLowerCase()}|${publisherKey}`;
      const current = frequency.get(key);
      if (current) {
        current.count += 1;
      } else {
        frequency.set(key, { from, to, count: 1, publisherKey });
      }
    }
  }

  const ranked = [...frequency.values()].sort((left, right) => right.count - left.count);
  const globalReplacements = [
    ...priorRules.globalReplacements,
    ...ranked.slice(0, 100).map((item) => ({ from: item.from, to: item.to })),
  ].slice(0, 200);

  const publisherSpecific: MetadataCorrectionRulesRecord["publisherSpecific"] = {
    ...priorRules.publisherSpecific,
  };

  for (const item of ranked.slice(0, 100)) {
    if (!item.publisherKey) {
      continue;
    }

    const prior = publisherSpecific[item.publisherKey] ?? { replacements: [] };
    prior.replacements = [...prior.replacements, { from: item.from, to: item.to }].slice(0, 100);
    publisherSpecific[item.publisherKey] = prior;
  }

  return sanitizeMetadataCorrectionRules({
    version: `rules-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    globalReplacements,
    publisherSpecific,
  });
}

function inferImageMimeType(imageDataUrl: string): string {
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  const mimeType = match?.[1]?.toLowerCase() ?? "";
  if (["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)) {
    return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  }

  throw new HttpsError("invalid-argument", "Unsupported screenshot format. Use PNG, JPEG, or WEBP.");
}

async function consumeOcrRequestQuota(uid: string): Promise<void> {
  const usageRef = firestore.doc(`users/${uid}/ocrUsage/current`);

  await firestore.runTransaction(async (transaction) => {
    const now = Date.now();
    const snapshot = await transaction.get(usageRef);
    const data = snapshot.exists ? snapshot.data() ?? {} : {};
    const windowStartMs = typeof data.windowStartMs === "number" ? data.windowStartMs : now;
    const usedCount = typeof data.usedCount === "number" ? data.usedCount : 0;
    const withinWindow = now - windowStartMs < OCR_RATE_LIMIT_WINDOW_MS;

    const nextWindowStart = withinWindow ? windowStartMs : now;
    const nextCount = withinWindow ? usedCount + 1 : 1;

    if (withinWindow && usedCount >= OCR_RATE_LIMIT_MAX_REQUESTS) {
      throw new HttpsError("resource-exhausted", "OCR request limit reached. Please wait a minute and try again.");
    }

    transaction.set(usageRef, {
      windowStartMs: nextWindowStart,
      usedCount: nextCount,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  });
}

function getDefaultDailyLimitPercent(): number {
  return roundToOneDecimal(MONTHLY_BASELINE_PERCENT * DAILY_BASELINE_MULTIPLIER);
}

function getDefaultWeeklyLimitPercent(): number {
  return roundToOneDecimal(MONTHLY_BASELINE_PERCENT * WEEKLY_BASELINE_MULTIPLIER);
}

function getDateKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getMonthlyResetAnchor(year: number, monthIndex: number): Date {
  const resetDay = Math.min(31, getDaysInMonth(year, monthIndex));
  return new Date(year, monthIndex, resetDay, 7, 0, 0, 0);
}

function toMonthlyResetKey(anchor: Date): string {
  return `${anchor.getFullYear()}-${pad2(anchor.getMonth() + 1)}-${pad2(anchor.getDate())}@07:00`;
}

function getMonthlyResetKey(now = new Date()): string {
  const currentAnchor = getMonthlyResetAnchor(now.getFullYear(), now.getMonth());
  if (now.getTime() >= currentAnchor.getTime()) {
    return toMonthlyResetKey(currentAnchor);
  }

  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousAnchor = getMonthlyResetAnchor(previousMonth.getFullYear(), previousMonth.getMonth());
  return toMonthlyResetKey(previousAnchor);
}

function getIsoWeekKey(now = new Date()): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / dayMs) + 1) / 7);

  return `${isoYear}-W${pad2(week)}`;
}

function createDefaultPremiumUsage(now = new Date()): PremiumUsageState {
  return {
    premiumRequestsUsedToday: 0,
    premiumRequestsUsedThisWeek: 0,
    premiumRequestsUsedThisMonth: 0,
    dailyLimitPercent: getDefaultDailyLimitPercent(),
    weeklyLimitPercent: getDefaultWeeklyLimitPercent(),
    monthlyLimitPercent: MONTHLY_LIMIT_PERCENT,
    freezePremium: false,
    lastResetDate: getDateKey(now),
    lastResetWeek: getIsoWeekKey(now),
    lastResetMonth: getMonthlyResetKey(now),
  };
}

function normalizePremiumUsage(value: unknown, now = new Date()): PremiumUsageState {
  const defaults = createDefaultPremiumUsage(now);
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  return {
    premiumRequestsUsedToday: Number(record.premiumRequestsUsedToday ?? defaults.premiumRequestsUsedToday),
    premiumRequestsUsedThisWeek: Number(record.premiumRequestsUsedThisWeek ?? defaults.premiumRequestsUsedThisWeek),
    premiumRequestsUsedThisMonth: Number(record.premiumRequestsUsedThisMonth ?? defaults.premiumRequestsUsedThisMonth),
    dailyLimitPercent: Number(record.dailyLimitPercent ?? defaults.dailyLimitPercent),
    weeklyLimitPercent: Number(record.weeklyLimitPercent ?? defaults.weeklyLimitPercent),
    monthlyLimitPercent: Number(record.monthlyLimitPercent ?? defaults.monthlyLimitPercent),
    freezePremium: record.freezePremium === true,
    lastResetDate: typeof record.lastResetDate === "string" ? record.lastResetDate : defaults.lastResetDate,
    lastResetWeek: typeof record.lastResetWeek === "string" ? record.lastResetWeek : defaults.lastResetWeek,
    lastResetMonth: typeof record.lastResetMonth === "string" ? record.lastResetMonth : defaults.lastResetMonth,
  };
}

function applyPremiumResets(usage: PremiumUsageState, now = new Date()): PremiumUsageState {
  const next = { ...usage };
  const dateKey = getDateKey(now);
  const weekKey = getIsoWeekKey(now);
  const monthKey = getMonthlyResetKey(now);

  if (next.lastResetDate !== dateKey) {
    next.premiumRequestsUsedToday = 0;
    next.lastResetDate = dateKey;
  }

  if (next.lastResetWeek !== weekKey) {
    next.premiumRequestsUsedThisWeek = 0;
    next.lastResetWeek = weekKey;
  }

  if (next.lastResetMonth !== monthKey) {
    next.premiumRequestsUsedThisMonth = 0;
    next.lastResetMonth = monthKey;
  }

  if (next.premiumRequestsUsedThisMonth > next.monthlyLimitPercent) {
    next.freezePremium = true;
  }

  return next;
}

async function getPremiumUsageDocRef(uid: string): Promise<FirebaseFirestore.DocumentReference> {
  return firestore.doc(`users/${uid}/premiumUsage/current`);
}

async function getOrCreatePremiumUsage(uid: string): Promise<PremiumUsageState> {
  const docRef = await getPremiumUsageDocRef(uid);
  const snapshot = await docRef.get();
  const normalized = normalizePremiumUsage(snapshot.exists ? snapshot.data() : null);
  const resetUsage = applyPremiumResets(normalized);

  if (!snapshot.exists || JSON.stringify(resetUsage) !== JSON.stringify(normalized)) {
    await docRef.set(resetUsage, { merge: true });
  }

  return resetUsage;
}

function parseDocPath(docPath: string): { ownerId: string | null; collectionName: SupportedCollection; docId: string } {
  const parts = docPath.split("/");

  if (parts.length === 2 && parts[0] === "textbooks") {
    return {
      ownerId: null,
      collectionName: "textbooks",
      docId: parts[1],
    };
  }

  if (parts.length === 4 && parts[0] === "textbooks" && parts[2] === "chapters") {
    return {
      ownerId: null,
      collectionName: "chapters",
      docId: parts[3],
    };
  }

  if (parts.length === 6 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections") {
    return {
      ownerId: null,
      collectionName: "sections",
      docId: parts[5],
    };
  }

  if (parts.length === 8 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections" && parts[6] === "vocab") {
    return {
      ownerId: null,
      collectionName: "vocab",
      docId: parts[7],
    };
  }

  if (parts.length === 8 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections" && parts[6] === "equations") {
    return {
      ownerId: null,
      collectionName: "equations",
      docId: parts[7],
    };
  }

  if (parts.length === 8 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections" && parts[6] === "concepts") {
    return {
      ownerId: null,
      collectionName: "concepts",
      docId: parts[7],
    };
  }

  if (parts.length === 8 && parts[0] === "textbooks" && parts[2] === "chapters" && parts[4] === "sections" && parts[6] === "keyIdeas") {
    return {
      ownerId: null,
      collectionName: "keyIdeas",
      docId: parts[7],
    };
  }

  throw new HttpsError("invalid-argument", "Unsupported document path.");
}

async function getOwnerEmailMap(): Promise<Map<string, string>> {
  const snapshot = await firestore.collection("users").get();
  const map = new Map<string, string>();

  for (const docSnap of snapshot.docs) {
    const email = docSnap.get("email");
    if (typeof email === "string" && email.length > 0) {
      map.set(docSnap.id, email);
    }
  }

  return map;
}

function getRecordTitle(collectionName: SupportedCollection, data: FirebaseFirestore.DocumentData, fallbackId: string): string {
  switch (collectionName) {
    case "textbooks":
      return typeof data.title === "string" ? data.title : fallbackId;
    case "chapters":
      return typeof data.name === "string" ? data.name : fallbackId;
    case "sections":
      return typeof data.title === "string" ? data.title : fallbackId;
    case "vocab":
      return typeof data.word === "string" ? data.word : fallbackId;
    case "equations":
      return typeof data.name === "string" ? data.name : fallbackId;
    case "concepts":
      return typeof data.name === "string" ? data.name : fallbackId;
    case "keyIdeas":
      return typeof data.text === "string" ? data.text : fallbackId;
  }
}

function getRecordSummary(collectionName: SupportedCollection, data: FirebaseFirestore.DocumentData): string | undefined {
  switch (collectionName) {
    case "chapters":
      return typeof data.description === "string" ? data.description : undefined;
    case "sections":
      return typeof data.notes === "string" ? data.notes : undefined;
    case "vocab":
      return typeof data.definition === "string" ? data.definition : undefined;
    case "equations":
      return typeof data.description === "string" ? data.description : undefined;
    case "concepts":
      return typeof data.explanation === "string" ? data.explanation : undefined;
    case "keyIdeas":
      return typeof data.text === "string" ? data.text : undefined;
    default:
      return undefined;
  }
}

function toAdminUserRecord(snapshot: FirebaseFirestore.QueryDocumentSnapshot): AdminUserRecord {
  const data = snapshot.data();
  return {
    uid: typeof data.uid === "string" ? data.uid : snapshot.id,
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    email: typeof data.email === "string" ? data.email : "",
    createdAt: toIsoString(data.createdAt),
    lastLoginAt: toIsoString(data.lastLoginAt),
    isAdmin: data.isAdmin === true,
    isContentBlocked: data.isContentBlocked === true,
    contentBlockReason: typeof data.contentBlockReason === "string" ? data.contentBlockReason : null,
  };
}

function buildAdminContentRecord(
  collectionName: SupportedCollection,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  ownerEmailMap: Map<string, string>
): AdminContentRecord {
  const data = snapshot.data();
  const ownerId = typeof data.ownerId === "string"
    ? data.ownerId
    : typeof data.userId === "string"
      ? data.userId
      : "unknown";

  return {
    docPath: snapshot.ref.path,
    id: snapshot.id,
    collectionName,
    ownerId,
    ownerEmail: ownerEmailMap.get(ownerId) ?? null,
    title: getRecordTitle(collectionName, data, snapshot.id),
    grade: typeof data.grade === "string" ? data.grade : undefined,
    subject: typeof data.subject === "string" ? data.subject : undefined,
    edition: typeof data.edition === "string" ? data.edition : undefined,
    publicationYear: typeof data.publicationYear === "number" ? data.publicationYear : undefined,
    isbnRaw: typeof data.isbnRaw === "string" ? data.isbnRaw : undefined,
    summary: getRecordSummary(collectionName, data),
    status: (typeof data.status === "string" ? data.status : "draft") as ContentStatus,
    isArchived: data.isArchived === true,
    isDeleted: data.isDeleted === true,
    lastModified: toIsoString(data.lastModified),
  };
}

function buildModerationItem(
  collectionName: SupportedCollection,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  ownerEmailMap: Map<string, string>
): ModerationItem {
  const data = snapshot.data();
  const ownerId = typeof data.ownerId === "string"
    ? data.ownerId
    : typeof data.userId === "string"
      ? data.userId
      : "unknown";

  return {
    docPath: snapshot.ref.path,
    collectionName,
    ownerId,
    ownerEmail: ownerEmailMap.get(ownerId) ?? null,
    title: getRecordTitle(collectionName, data, snapshot.id),
    currentStatus: "submitted",
    lastModified: toIsoString(data.lastModified),
    isArchived: data.isArchived === true,
  };
}

export const setUserAdminStatus = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const uid = typeof data?.uid === "string" ? data.uid.trim() : "";
  const isAdmin = data?.isAdmin === true;

  if (!uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }

  const userRecord = await auth.getUser(uid);
  const nextClaims = { ...(userRecord.customClaims ?? {}) } as Record<string, unknown>;

  if (isAdmin) {
    nextClaims.admin = true;
  } else {
    delete nextClaims.admin;
  }

  await auth.setCustomUserClaims(uid, nextClaims);
  await firestore.doc(`users/${uid}`).set(
    {
      uid,
      email: userRecord.email ?? "",
      displayName: userRecord.displayName ?? "",
      isAdmin,
      lastClaimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const message = isAdmin
    ? `Granted admin access to ${uid}.`
    : `Removed admin access from ${uid}.`;

  return success(message, message);
});

export const setUserContentBlockStatus = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const uid = typeof data?.uid === "string" ? data.uid.trim() : "";
  const isContentBlocked = data?.isContentBlocked === true;
  const contentBlockReason = typeof data?.contentBlockReason === "string"
    ? data.contentBlockReason.trim()
    : "";

  if (!uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }

  await firestore.doc(`users/${uid}`).set(
    {
      uid,
      isContentBlocked,
      contentBlockReason: isContentBlocked ? (contentBlockReason || "Blocked by admin moderation decision.") : null,
      lastContentBlockUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const message = isContentBlocked
    ? `Blocked cloud sync for user ${uid}.`
    : `Unblocked cloud sync for user ${uid}.`;

  return success(message, message);
});

export const listAdminUsers = onCall(async (request) => {
  assertAdmin(request.auth);

  const snapshot = await firestore.collection("users").orderBy("email").get();
  return success("Loaded users.", snapshot.docs.map(toAdminUserRecord));
});

export const getModerationQueue = onCall(async (request) => {
  assertAdmin(request.auth);

  const ownerEmailMap = await getOwnerEmailMap();
  const items: ModerationItem[] = [];

  await Promise.all(
    SUPPORTED_COLLECTIONS.map(async (collectionName) => {
        const snapshot = await firestore.collectionGroup(collectionName).where("status", "==", "submitted").get();
        snapshot.docs.forEach((docSnap) => {
          items.push(buildModerationItem(collectionName, docSnap, ownerEmailMap));
        });
      })
  );

  items.sort((left, right) => (right.lastModified ?? "").localeCompare(left.lastModified ?? ""));
  return success("Loaded moderation queue.", items);
});

export const updateModerationStatus = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const docPath = typeof data?.docPath === "string" ? data.docPath : "";
  const status = typeof data?.status === "string" ? data.status as ContentStatus : null;

  if (!docPath || !status) {
    throw new HttpsError("invalid-argument", "A document path and status are required.");
  }

  parseDocPath(docPath);
  await firestore.doc(docPath).update({
    status,
    pendingSync: false,
    lastModified: new Date().toISOString(),
  });

  return success(`Updated status to ${status}.`, `Updated status to ${status}.`);
});

export const archiveAdminContent = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const docPath = typeof data?.docPath === "string" ? data.docPath : "";
  const isArchived = data?.isArchived !== false;

  if (!docPath) {
    throw new HttpsError("invalid-argument", "A document path is required.");
  }

  parseDocPath(docPath);
  await firestore.doc(docPath).update({
    isArchived,
    pendingSync: false,
    lastModified: new Date().toISOString(),
  });

  return success(isArchived ? "Content archived." : "Content restored from archive.", isArchived ? "Content archived." : "Content restored from archive.");
});

export const softDeleteAdminContent = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const docPath = typeof data?.docPath === "string" ? data.docPath : "";
  const isDeleted = data?.isDeleted !== false;

  if (!docPath) {
    throw new HttpsError("invalid-argument", "A document path is required.");
  }

  parseDocPath(docPath);
  await firestore.doc(docPath).update({
    isDeleted,
    pendingSync: false,
    lastModified: new Date().toISOString(),
  });

  return success(isDeleted ? "Content hidden from non-admin users." : "Content restored.", isDeleted ? "Content hidden from non-admin users." : "Content restored.");
});

export const searchAdminContent = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const titleContains = typeof data?.titleContains === "string" ? data.titleContains.toLowerCase() : "";
  const isbn = typeof data?.isbn === "string" ? data.isbn.replace(/-/g, "") : "";
  const ownerEmailFilter = typeof data?.ownerEmail === "string" ? data.ownerEmail.toLowerCase() : "";
  const ownerUidFilter = typeof data?.ownerUid === "string" ? data.ownerUid : "";
  const requestedCollection = typeof data?.collectionName === "string" ? data.collectionName : "all";

  const collections = requestedCollection === "all"
    ? SUPPORTED_COLLECTIONS
    : SUPPORTED_COLLECTIONS.filter((name) => name === requestedCollection);

  const ownerEmailMap = await getOwnerEmailMap();
  const allowedOwnerIds = new Set<string>();

  if (ownerEmailFilter) {
    ownerEmailMap.forEach((email, uid) => {
      if (email.toLowerCase().includes(ownerEmailFilter)) {
        allowedOwnerIds.add(uid);
      }
    });
  }

  if (ownerUidFilter) {
    allowedOwnerIds.add(ownerUidFilter);
  }

  const records: AdminContentRecord[] = [];

  await Promise.all(collections.map(async (collectionName) => {
    const snapshot = await firestore.collectionGroup(collectionName).get();
    snapshot.docs.forEach((docSnap) => {
      const record = buildAdminContentRecord(collectionName, docSnap, ownerEmailMap);
      const normalizedIsbn = (record.isbnRaw ?? "").replace(/-/g, "");

      if (titleContains && !record.title.toLowerCase().includes(titleContains)) {
        return;
      }

      if (isbn && !normalizedIsbn.includes(isbn)) {
        return;
      }

      if (allowedOwnerIds.size > 0 && !allowedOwnerIds.has(record.ownerId)) {
        return;
      }

      records.push(record);
    });
  }));

  records.sort((left, right) => (right.lastModified ?? "").localeCompare(left.lastModified ?? ""));
  return success("Loaded admin content.", records);
});

export const updateAdminContent = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const docPath = typeof data?.docPath === "string" ? data.docPath : "";
  const updates = typeof data?.data === "object" && data?.data !== null ? data.data as Record<string, unknown> : null;

  if (!docPath || !updates) {
    throw new HttpsError("invalid-argument", "A document path and update payload are required.");
  }

  const { collectionName } = parseDocPath(docPath);
  const allowedFields: Record<SupportedCollection, string[]> = {
    textbooks: ["title", "grade", "subject", "edition", "publicationYear", "status"],
    chapters: ["name", "description", "status"],
    sections: ["title", "notes", "status"],
    vocab: ["word", "definition", "status"],
    equations: ["name", "latex", "description", "status"],
    concepts: ["name", "explanation", "status"],
    keyIdeas: ["text", "status"],
  };

  const sanitizedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key, value]) => allowedFields[collectionName].includes(key) && value !== undefined)
  );

  if (Object.keys(sanitizedUpdates).length === 0) {
    throw new HttpsError("invalid-argument", "No supported fields were provided for update.");
  }

  await firestore.doc(docPath).update({
    ...sanitizedUpdates,
    pendingSync: false,
    lastModified: new Date().toISOString(),
  });

  return success("Content updated.", "Content updated.");
});

export const getPremiumUsageReport = onCall(async (request) => {
  assertAdmin(request.auth);

  const usersSnapshot = await firestore.collection("users").orderBy("email").get();
  const rows: AdminPremiumUsageRow[] = [];

  await Promise.all(
    usersSnapshot.docs.map(async (userDoc) => {
      const data = userDoc.data();
      const usage = await getOrCreatePremiumUsage(userDoc.id);
      rows.push({
        uid: userDoc.id,
        email: typeof data.email === "string" ? data.email : "",
        displayName: typeof data.displayName === "string" ? data.displayName : "",
        premiumTier: typeof data.premiumTier === "string" ? data.premiumTier : "free",
        premiumUsage: usage,
      });
    })
  );

  rows.sort((a, b) => a.email.localeCompare(b.email));
  return success("Loaded premium usage report.", rows);
});

export const managePremiumUser = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data;
  const uid = typeof data?.uid === "string" ? data.uid.trim() : "";
  const action = typeof data?.action === "string" ? data.action : "";
  const freezePremium = data?.freezePremium === true;

  if (!uid) {
    throw new HttpsError("invalid-argument", "A user id is required.");
  }

  if (!["freeze", "unfreeze", "resetDaily", "resetWeekly", "resetMonthly"].includes(action)) {
    throw new HttpsError("invalid-argument", "Unsupported premium usage action.");
  }

  const userRef = firestore.doc(`users/${uid}`);
  const userSnapshot = await userRef.get();

  if (!userSnapshot.exists) {
    throw new HttpsError("not-found", "User not found.");
  }

  const usageRef = await getPremiumUsageDocRef(uid);
  const current = await getOrCreatePremiumUsage(uid);
  const next = { ...current };

  if (action === "freeze") {
    next.freezePremium = freezePremium !== false;
  }

  if (action === "unfreeze") {
    next.freezePremium = false;
  }

  if (action === "resetDaily") {
    next.premiumRequestsUsedToday = 0;
    next.lastResetDate = getDateKey();
  }

  if (action === "resetWeekly") {
    next.premiumRequestsUsedThisWeek = 0;
    next.lastResetWeek = getIsoWeekKey();
  }

  if (action === "resetMonthly") {
    next.premiumRequestsUsedThisMonth = 0;
    next.lastResetMonth = getMonthlyResetKey();
  }

  await usageRef.set(next, { merge: true });

  const userData = userSnapshot.data() ?? {};
  const row: AdminPremiumUsageRow = {
    uid,
    email: typeof userData.email === "string" ? userData.email : "",
    displayName: typeof userData.displayName === "string" ? userData.displayName : "",
    premiumTier: typeof userData.premiumTier === "string" ? userData.premiumTier : "free",
    premiumUsage: next,
  };

  return success("Premium usage updated.", row);
});

export const getCurrentPremiumUsage = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const usage = await getOrCreatePremiumUsage(request.auth.uid);
  return success("Loaded premium usage.", usage);
});

export const getAiProviderPolicy = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const snapshot = await firestore.doc(AI_PROVIDER_POLICY_DOC_PATH).get();
  const data = snapshot.data() ?? {};
  const normalized: AiProviderPolicyRecord = {
    providerOrder: normalizeAutoOcrProviderOrder(data.providerOrder),
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "system",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date(0).toISOString(),
  };

  return success("Loaded AI provider policy.", normalized);
});

export const getAiProviderStatus = onCall({ invoker: "public", secrets: [openAiKeySecret] }, async (request) => {
  const openaiKey = getOpenAiApiKey();

  return success("Loaded AI provider status.", {
    providers: [
      {
        id: "cloud_openai_vision" as const,
        label: "Cloud OCR (OpenAI Vision via Firebase Function)",
        available: Boolean(openaiKey),
      },
      {
        id: "local_tesseract" as const,
        label: "Local OCR (Tesseract)",
        available: true,
      },
    ],
  });
});

export const setAiProviderPolicy = onCall(async (request) => {
  assertAdmin(request.auth);

  const data = request.data as { providerOrder?: unknown };
  const providerOrder = normalizeAutoOcrProviderOrder(data.providerOrder);
  const nextPolicy: AiProviderPolicyRecord = {
    providerOrder,
    updatedBy: request.auth?.uid ?? "unknown",
    updatedAt: new Date().toISOString(),
  };

  await firestore.doc(AI_PROVIDER_POLICY_DOC_PATH).set(nextPolicy, { merge: true });
  return success("Updated AI provider policy.", nextPolicy);
});

export const getDebugLoggingPolicy = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const policy = await getDebugLoggingPolicyRecord();
  return success("Loaded debug logging policy.", policy);
});

export const setDebugLoggingPolicy = onCall(async (request) => {
  assertAdmin(request.auth);

  const payload = request.data as Partial<DebugLoggingPolicyRecord>;
  const current = await getDebugLoggingPolicyRecord();
  const next = normalizeDebugLoggingPolicy({
    ...current,
    ...payload,
    updatedBy: request.auth?.uid ?? "unknown",
    updatedAt: new Date().toISOString(),
  });

  await firestore.doc(DEBUG_POLICY_DOC_PATH).set(next, { merge: true });
  return success("Updated debug logging policy.", next);
});

export const uploadDebugLogReport = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const payload = request.data as {
    userId?: unknown;
    entries?: unknown;
    totalSizeBytes?: unknown;
    appVersion?: unknown;
    browserInfo?: unknown;
    extensionVersion?: unknown;
    osInfo?: unknown;
  };

  const userId = typeof payload.userId === "string" ? payload.userId.trim() : "";
  if (!userId || userId !== request.auth.uid) {
    throw new HttpsError("permission-denied", "Debug upload user mismatch.");
  }

  const policy = await getDebugLoggingPolicyRecord();
  if (!policy.enabledGlobally || policy.disabledUserIds.includes(userId)) {
    throw new HttpsError("failed-precondition", "Debug logging is disabled for this account.");
  }

  const entries = sanitizeDebugLogEntries(payload.entries);
  if (!entries.length) {
    throw new HttpsError("invalid-argument", "Debug log entries are required.");
  }

  const calculatedTotalSize = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const declaredTotalSize = typeof payload.totalSizeBytes === "number" ? Math.round(payload.totalSizeBytes) : calculatedTotalSize;
  const totalSizeBytes = Math.max(calculatedTotalSize, declaredTotalSize);

  if (totalSizeBytes > policy.maxUploadBytes) {
    throw new HttpsError("invalid-argument", "Debug log too large to upload. Please clear or reduce logging.");
  }

  const uploadedAtMs = Date.now();
  const reportId = `${uploadedAtMs}`;
  const docPath = `debugReports/${userId}/reports/${reportId}`;

  await firestore.doc(docPath).set({
    userId,
    uploadedAtMs,
    createdAt: new Date(uploadedAtMs).toISOString(),
    entries,
    entriesCount: entries.length,
    totalSizeBytes,
    appVersion: typeof payload.appVersion === "string" ? payload.appVersion : undefined,
    browserInfo: typeof payload.browserInfo === "string" ? payload.browserInfo : undefined,
    extensionVersion: typeof payload.extensionVersion === "string" ? payload.extensionVersion : null,
    osInfo: typeof payload.osInfo === "string" ? payload.osInfo : undefined,
  }, { merge: false });

  return success("Debug log uploaded.", {
    reportId,
    uploadedCount: entries.length,
    uploadedAt: uploadedAtMs,
  });
});

export const listRecentDebugUploads = onCall(async (request) => {
  assertAdmin(request.auth);

  const snapshot = await firestore
    .collectionGroup("reports")
    .orderBy("uploadedAtMs", "desc")
    .limit(50)
    .get();

  const rows: DebugUploadSummary[] = snapshot.docs
    .filter((docSnapshot) => docSnapshot.ref.parent.parent?.parent?.id === "debugReports")
    .map((docSnapshot) => {
      const data = docSnapshot.data();
      return {
        reportPath: docSnapshot.ref.path,
        userId: typeof data.userId === "string" ? data.userId : "",
        createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date(0).toISOString(),
        uploadedAtMs: typeof data.uploadedAtMs === "number" ? data.uploadedAtMs : 0,
        totalSizeBytes: typeof data.totalSizeBytes === "number" ? data.totalSizeBytes : 0,
        entriesCount: typeof data.entriesCount === "number" ? data.entriesCount : 0,
        appVersion: typeof data.appVersion === "string" ? data.appVersion : undefined,
      };
    });

  return success("Loaded recent debug uploads.", rows);
});

export const extractScreenshotText = onCall({ secrets: [openAiKeySecret], invoker: "public" }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to extract screenshot text.");
  }

  const payload = request.data as { imageDataUrl?: unknown };
  const imageDataUrl = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl.trim() : "";

  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    throw new HttpsError("invalid-argument", "A valid image data URL is required.");
  }

  if (Buffer.byteLength(imageDataUrl, "utf8") > MAX_OCR_IMAGE_DATA_URL_BYTES) {
    throw new HttpsError("invalid-argument", "Screenshot payload is too large. Please crop before retrying.");
  }

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    throw new HttpsError("failed-precondition", "Cloud OCR is unavailable because OPENAI_API_KEY is not configured.");
  }

  await consumeOcrRequestQuota(request.auth.uid);
  console.log("[OCR] Starting screenshot text extraction", { userId: request.auth.uid, imageSize: imageDataUrl.length });
  inferImageMimeType(imageDataUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You perform OCR from educational screenshots. Return only the extracted text with original line breaks, no commentary.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all readable text from this screenshot. Return plain text only." },
              { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            ],
          },
        ],
        max_tokens: 1800,
        temperature: 0,
      }),
    });
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("abort")) {
      throw new HttpsError("deadline-exceeded", "Cloud OCR request timed out. OpenAI service may be slow or unavailable.");
    }
    throw new HttpsError("internal", `Cloud OCR request failed: ${message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new HttpsError("internal", `Cloud OCR provider error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!json || typeof json !== "object") {
    throw new HttpsError("internal", `Cloud OCR: Invalid response format from OpenAI (expected object, got ${typeof json})`);
  }

  if (!Array.isArray(json.choices) || json.choices.length === 0) {
    const jsonStr = typeof json === "object" ? JSON.stringify(json).substring(0, 150) : String(json);
    throw new HttpsError("internal", `Cloud OCR: OpenAI response missing valid choices array. Response: ${jsonStr}`);
  }

  const firstChoice = json.choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    throw new HttpsError("internal", "Cloud OCR: Invalid choice object in OpenAI response");
  }

  if (!firstChoice.message || typeof firstChoice.message !== "object") {
    throw new HttpsError("internal", "Cloud OCR: OpenAI response choice missing message object");
  }

  if (typeof firstChoice.message.content !== "string") {
    throw new HttpsError("internal", "Cloud OCR: OpenAI response message missing content string");
  }

  const extractedText = firstChoice.message.content.trim();
  if (!extractedText) {
    throw new HttpsError("internal", "Cloud OCR provider returned empty text.");
  }

  return success("Screenshot text extracted.", { text: extractedText });
});

export const extractMetadataFromImageVision = onCall({ secrets: [openAiKeySecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to extract metadata from images.");
  }

  const payload = request.data as {
    imageDataUrl?: unknown;
    context?: {
      pageType?: unknown;
      publisherHint?: unknown;
    };
  };

  const imageDataUrl = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl.trim() : "";
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    throw new HttpsError("invalid-argument", "A valid image data URL is required.");
  }

  if (Buffer.byteLength(imageDataUrl, "utf8") > MAX_OCR_IMAGE_DATA_URL_BYTES) {
    throw new HttpsError("invalid-argument", "Screenshot payload is too large. Please crop before retrying.");
  }

  const pageType = payload.context?.pageType === "cover" || payload.context?.pageType === "title" || payload.context?.pageType === "other"
    ? payload.context.pageType
    : "other";
  const publisherHint = typeof payload.context?.publisherHint === "string" ? payload.context.publisherHint.trim() : "";

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    throw new HttpsError("failed-precondition", "Vision metadata extraction is unavailable because OPENAI_API_KEY is not configured.");
  }

  await consumeOcrRequestQuota(request.auth.uid);
  inferImageMimeType(imageDataUrl);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You extract textbook metadata from cover and title-page images. Return strict JSON only, no markdown fences.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Read this textbook image and return JSON with keys:",
                "title, subtitle, edition, publisher, series, gradeLevel, subject, confidence, rawText.",
                "Rules:",
                "- Identify the main title and subtitle if present.",
                "- Identify labels like Teacher's Edition when relevant.",
                "- Identify publisher if visible.",
                "- Ignore decorative text and watermarks.",
                "- confidence must be a number from 0 to 1.",
                `- pageType context: ${pageType}.`,
                publisherHint ? `- publisherHint context: ${publisherHint}.` : "",
              ].filter(Boolean).join("\n"),
            },
            { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
          ],
        },
      ],
      max_tokens: 1200,
      temperature: 0,
      response_format: {
        type: "json_object",
      },
    }),
  });

  if (!response.ok) {
    throw new HttpsError("internal", `Vision provider error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawContent = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!rawContent) {
    throw new HttpsError("internal", "Vision provider returned empty metadata.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new HttpsError("internal", "Vision provider returned non-JSON metadata.");
  }

  const metadata = sanitizeMetadataResult(parsed, "vision");
  return success("Image metadata extracted.", {
    metadata,
    confidence: metadata.confidence,
    rawText: metadata.rawText,
  });
});

export const correctionsUpload = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to sync metadata corrections.");
  }

  const payload = request.data as { corrections?: unknown };
  const corrections = sanitizeMetadataCorrectionRecords(payload.corrections);
  if (!corrections.length) {
    return success("No corrections to upload.", { acceptedCount: 0, rejectedCount: 0 });
  }

  const limitsDoc = await firestore.doc(METADATA_CORRECTION_LIMITS_DOC_PATH).get();
  const limitsData = limitsDoc.data() ?? {};
  const dailyLimit = typeof limitsData.dailyLimit === "number" ? Math.max(1, Math.round(limitsData.dailyLimit)) : DEFAULT_CORRECTION_DAILY_LIMIT;
  const minUploadIntervalSeconds = typeof limitsData.minUploadIntervalSeconds === "number"
    ? Math.max(1, Math.round(limitsData.minUploadIntervalSeconds))
    : DEFAULT_CORRECTION_MIN_UPLOAD_INTERVAL_SECONDS;

  const uploadRuntimeRef = firestore.doc(`users/${request.auth.uid}/metadataCorrectionUsageRuntime/state`);
  const uploadRuntimeSnapshot = await uploadRuntimeRef.get();
  const lastUploadAtMs = uploadRuntimeSnapshot.exists && typeof uploadRuntimeSnapshot.data()?.lastUploadAtMs === "number"
    ? Math.max(0, Math.round(uploadRuntimeSnapshot.data()!.lastUploadAtMs))
    : 0;
  const nowMs = Date.now();
  if (lastUploadAtMs > 0 && (nowMs - lastUploadAtMs) < (minUploadIntervalSeconds * 1000)) {
    throw new HttpsError("resource-exhausted", "Correction upload rate limit reached. Please retry shortly.");
  }

  const todayKey = getDateKey();
  const usageRef = firestore.doc(`users/${request.auth.uid}/metadataCorrectionUsage/${todayKey}`);
  const usageSnapshot = await usageRef.get();
  const usedToday = usageSnapshot.exists && typeof usageSnapshot.data()?.count === "number"
    ? Math.max(0, Math.round(usageSnapshot.data()!.count))
    : 0;

  const remaining = Math.max(0, dailyLimit - usedToday);
  if (remaining <= 0) {
    throw new HttpsError("resource-exhausted", "Daily correction upload limit reached.");
  }

  const accepted = corrections.slice(0, remaining);
  const rejectedCount = corrections.length - accepted.length;

  const batch = firestore.batch();
  for (const correction of accepted) {
    const validation = validateCorrectionForQueue(correction);
    const suspicious = detectSuspiciousCorrection(correction);
    const flagged = correction.flagged || !validation.valid || suspicious.suspicious;
    const reasonFlagged = correction.reasonFlagged ?? validation.reason ?? suspicious.reason;
    const docRef = firestore.doc(`metadataCorrections/${request.auth.uid}/items/${correction.id}`);
    batch.set(docRef, {
      ...correction,
      flagged,
      reasonFlagged,
      reviewStatus: "pending",
      userId: request.auth.uid,
      createdAt: correction.timestamp,
      syncedAt: new Date().toISOString(),
    }, { merge: true });
  }

  batch.set(usageRef, {
    count: usedToday + accepted.length,
    date: todayKey,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  batch.set(uploadRuntimeRef, {
    lastUploadAtMs: nowMs,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  await batch.commit();

  const rulesDoc = await firestore.doc(METADATA_CORRECTION_RULES_DOC_PATH).get();
  const priorRules = sanitizeMetadataCorrectionRules(rulesDoc.data());
  const nextRules = buildRulesFromCorrections(accepted.filter((entry) => entry.reviewStatus !== "rejected"), priorRules);

  await firestore.doc(METADATA_CORRECTION_RULES_DOC_PATH).set(nextRules, { merge: true });

  return success("Correction samples queued for review.", {
    acceptedCount: accepted.length,
    rejectedCount,
  });
});

export const correctionsList = onCall(async (request) => {
  assertAdmin(request.auth);

  const payload = request.data as {
    page?: unknown;
    pageSize?: unknown;
    sortBy?: unknown;
    sortDirection?: unknown;
    filters?: {
      publisher?: unknown;
      pageType?: unknown;
      confidenceMin?: unknown;
      confidenceMax?: unknown;
      source?: unknown;
      flaggedOnly?: unknown;
      reviewStatus?: unknown;
      dateFrom?: unknown;
      dateTo?: unknown;
    };
  };

  const allSnaps = await firestore.collectionGroup("items").limit(1000).get();
  const allRecords = allSnaps.docs
    .filter((snapshot) => snapshot.ref.path.includes("metadataCorrections/"))
    .map((snapshot) => sanitizeMetadataCorrectionRecords([snapshot.data()])[0])
    .filter((entry): entry is MetadataCorrectionRecord => Boolean(entry));

  const filtered = filterAndSortCorrections(allRecords, {
    publisher: typeof payload.filters?.publisher === "string" ? payload.filters.publisher : undefined,
    pageType: typeof payload.filters?.pageType === "string" ? payload.filters.pageType : "all",
    confidenceMin: typeof payload.filters?.confidenceMin === "number" ? payload.filters.confidenceMin : undefined,
    confidenceMax: typeof payload.filters?.confidenceMax === "number" ? payload.filters.confidenceMax : undefined,
    source: typeof payload.filters?.source === "string" ? payload.filters.source : "all",
    flaggedOnly: payload.filters?.flaggedOnly === true,
    reviewStatus: typeof payload.filters?.reviewStatus === "string" ? payload.filters.reviewStatus : "all",
    dateFrom: typeof payload.filters?.dateFrom === "string" ? payload.filters.dateFrom : undefined,
    dateTo: typeof payload.filters?.dateTo === "string" ? payload.filters.dateTo : undefined,
    sortBy: payload.sortBy === "timestamp" || payload.sortBy === "finalConfidence" || payload.sortBy === "errorScore"
      ? payload.sortBy
      : "errorScore",
    sortDirection: payload.sortDirection === "asc" || payload.sortDirection === "desc"
      ? payload.sortDirection
      : "desc",
  });

  const page = typeof payload.page === "number" ? Math.max(1, Math.round(payload.page)) : 1;
  const pageSize = typeof payload.pageSize === "number" ? Math.max(1, Math.min(100, Math.round(payload.pageSize))) : 20;
  const start = (page - 1) * pageSize;

  return success("Loaded correction records.", {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
  });
});

export const correctionsReview = onCall(async (request) => {
  assertAdmin(request.auth);

  const payload = request.data as {
    action?: unknown;
    recordIds?: unknown;
    modifiedMetadata?: unknown;
  };

  const action = payload.action === "accept" || payload.action === "reject" || payload.action === "modify"
    ? payload.action
    : null;
  if (!action) {
    throw new HttpsError("invalid-argument", "Invalid review action.");
  }

  const recordIds = Array.isArray(payload.recordIds)
    ? payload.recordIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  if (!recordIds.length) {
    throw new HttpsError("invalid-argument", "At least one record ID is required.");
  }

  const batch = firestore.batch();
  let updated = 0;

  for (const recordId of recordIds) {
    const querySnapshot = await firestore.collectionGroup("items").where("id", "==", recordId).limit(1).get();
    if (querySnapshot.empty) {
      continue;
    }

    const doc = querySnapshot.docs[0];
    const data = doc.data() as Record<string, unknown>;
    const before = sanitizeMetadataCorrectionRecords([data])[0];
    if (!before) {
      continue;
    }

    const nextPayload: Record<string, unknown> = {
      reviewedByAdmin: request.auth?.uid ?? "unknown",
      reviewedAt: new Date().toISOString(),
      reviewStatus: action === "reject" ? "rejected" : "accepted",
    };

    if (action === "modify" && payload.modifiedMetadata && typeof payload.modifiedMetadata === "object") {
      const patched = {
        ...before.finalMetadata,
        ...(payload.modifiedMetadata as Record<string, unknown>),
      };
      const sanitizedPatched = sanitizeMetadataResult(patched, before.finalMetadata.source);
      nextPayload.finalMetadata = sanitizedPatched;
      nextPayload.finalConfidence = sanitizedPatched.confidence;
      nextPayload.errorScore = Math.abs((before.originalVisionOutput?.confidence ?? sanitizedPatched.confidence) - sanitizedPatched.confidence);
      nextPayload.flagged = false;
      nextPayload.reasonFlagged = admin.firestore.FieldValue.delete();
    }

    batch.set(doc.ref, nextPayload, { merge: true });
    updated += 1;

    await appendMetadataCorrectionAuditLog({
      actorId: request.auth?.uid ?? "unknown",
      action,
      targetIds: [recordId],
      before,
      after: { ...before, ...nextPayload },
    });
  }

  await batch.commit();

  return success("Applied correction review action.", { updated });
});

export const correctionsRules = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to fetch metadata correction rules.");
  }

  const snapshot = await firestore.doc(METADATA_CORRECTION_RULES_DOC_PATH).get();
  const rules = sanitizeMetadataCorrectionRules(snapshot.data());

  return success("Loaded metadata correction rules.", rules);
});

export const correctionsRulesUpdate = onCall(async (request) => {
  assertAdmin(request.auth);

  const payload = request.data as { rules?: unknown };
  const rules = sanitizeMetadataCorrectionRules(payload.rules);
  const next = {
    ...rules,
    updatedAt: new Date().toISOString(),
    updatedBy: request.auth?.uid ?? "unknown",
  };

  await firestore.doc(METADATA_CORRECTION_RULES_DOC_PATH).set(next, { merge: true });

  await appendMetadataCorrectionAuditLog({
    actorId: request.auth?.uid ?? "unknown",
    action: "rules-update",
    targetIds: [METADATA_CORRECTION_RULES_DOC_PATH],
    after: next,
  });

  return success("Updated metadata correction rules.", next);
});

// Compatibility aliases for previous callable names.
export const submitMetadataCorrections = correctionsUpload;
export const getMetadataCorrectionRules = correctionsRules;

// ---------------------------------------------------------------------------
// AI Document Content Extraction
// ---------------------------------------------------------------------------

function sanitizeExtractionContext(value: unknown): DocumentExtractionContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const context = value as Record<string, unknown>;
  const result: DocumentExtractionContext = {};

  if (typeof context.textbookTitle === "string") {
    result.textbookTitle = context.textbookTitle.trim();
  }
  if (typeof context.textbookSubject === "string") {
    result.textbookSubject = context.textbookSubject.trim();
  }
  if (typeof context.gradeLevel === "string") {
    result.gradeLevel = context.gradeLevel.trim();
  }
  if (typeof context.chapterTitle === "string") {
    result.chapterTitle = context.chapterTitle.trim();
  }
  if (typeof context.sectionTitle === "string") {
    result.sectionTitle = context.sectionTitle.trim();
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function uniqueTrimmedStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

function normalizeComparisonKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildBlockedExtraction(quality: ExtractionQualityReport): ExtractedDocumentData {
  const empty = createEmptyExtractionData();
  return {
    ...empty,
    quality,
  };
}

function normalizeTieredText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resemblesProtectedTestContent(value: string): boolean {
  const text = value.toLowerCase();
  const patterns = [
    /answer\s+key/,
    /official\s+test/,
    /released\s+exam/,
    /practice\s+exam\s+copy/,
    /sat|act|ap\s+exam|state\s+test/,
    /question\s+\d+\s+from\s+test/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function forceSemanticRewrite(item: TieredQuestionItem): TieredQuestionItem {
  if (item.difficultyLevel === 2) {
    return {
      ...item,
      question: `In context, which choice best explains ${item.question}?`,
      correctAnswer: `A rephrased explanation of: ${item.correctAnswer}`,
    };
  }

  return {
    ...item,
    question: `Which option is NOT consistent with the concept of ${item.question}?`,
    correctAnswer: `The most defensible answer remains: ${item.correctAnswer}`,
  };
}

function buildFallbackDistractors(answer: string, chapterTerms: string[]): string[] {
  const normalizedAnswer = normalizeTieredText(answer);
  const fromChapter = chapterTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && normalizeTieredText(term) !== normalizedAnswer)
    .slice(0, 5);

  if (fromChapter.length >= 3) {
    return fromChapter.slice(0, 3);
  }

  const seedWord = answer.split(/\s+/).find(Boolean) ?? "idea";
  return [
    ...fromChapter,
    `A common misconception about ${seedWord}`,
    `A partially correct statement about ${seedWord}`,
    `A one-word-off definition of ${seedWord}`,
  ].slice(0, 3);
}

function inferGradeLevel(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/\d+/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(1, Math.min(16, parsed));
}

function sanitizeTieredGenerationContext(value: unknown): TieredVariationGenerationContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const sanitized: TieredVariationGenerationContext = {};

  if (typeof source.textbookTitle === "string") {
    sanitized.textbookTitle = source.textbookTitle.trim();
  }

  if (typeof source.textbookSubject === "string") {
    sanitized.textbookSubject = source.textbookSubject.trim();
  }

  const numericGrade = typeof source.gradeLevel === "number" && Number.isFinite(source.gradeLevel)
    ? source.gradeLevel
    : undefined;
  const normalizedGrade = numericGrade ? Math.max(1, Math.min(16, Math.round(numericGrade))) : undefined;
  sanitized.gradeLevel = normalizedGrade;

  if (typeof source.level2TargetReadingGrade === "number" && Number.isFinite(source.level2TargetReadingGrade)) {
    sanitized.level2TargetReadingGrade = Math.max(1, Math.min(16, Math.round(source.level2TargetReadingGrade)));
  }

  if (typeof source.level3TargetReadingGrade === "number" && Number.isFinite(source.level3TargetReadingGrade)) {
    sanitized.level3TargetReadingGrade = Math.max(1, Math.min(16, Math.round(source.level3TargetReadingGrade)));
  }

  return Object.values(sanitized).some((entry) => entry !== undefined) ? sanitized : undefined;
}

function buildFallbackTieredItems(
  seedItems: TieredQuestionSeedItem[],
  chapterTerms: string[],
  generationContext?: TieredVariationGenerationContext
): TieredQuestionItem[] {
  const subjectHint = generationContext?.textbookSubject?.trim();
  const level2ReadingGrade = generationContext?.level2TargetReadingGrade;
  const level3ReadingGrade = generationContext?.level3TargetReadingGrade;

  const level1 = seedItems.map((item) => ({
    id: `${item.id}:l1`,
    baseItemId: item.id,
    contentType: item.contentType,
    question: item.question,
    correctAnswer: item.correctAnswer,
    distractors: buildFallbackDistractors(item.correctAnswer, chapterTerms),
    difficultyLevel: 1 as DifficultyLevel,
    isOriginal: true,
    variationOf: null,
    sourceMetadata: item.sourceMetadata,
  }));

  const level2 = level1.flatMap((item) => [1, 2].map((idx) => ({
    ...item,
    id: `${item.baseItemId}:l2:${idx}`,
    difficultyLevel: 2 as DifficultyLevel,
    isOriginal: false,
    variationOf: `${item.baseItemId}:l1`,
    question: `Which restatement best matches ${item.question}${subjectHint ? ` in ${subjectHint}` : ""}?`,
    correctAnswer: level2ReadingGrade
      ? `A reworded explanation of ${item.correctAnswer} written at about grade ${level2ReadingGrade} reading level.`
      : `A reworded explanation of ${item.correctAnswer}.`,
  })));

  const level3 = level1.flatMap((item) => [1, 2].map((idx) => ({
    ...item,
    id: `${item.baseItemId}:l3:${idx}`,
    difficultyLevel: 3 as DifficultyLevel,
    isOriginal: false,
    variationOf: `${item.baseItemId}:l1`,
    question: `Which option is NOT an accurate application of ${item.question}${subjectHint ? ` in ${subjectHint}` : ""}?`,
    correctAnswer: level3ReadingGrade
      ? `The strongest reasoning-based response aligned with ${item.correctAnswer}, written around grade ${level3ReadingGrade} reading level.`
      : `The strongest reasoning-based response aligns with ${item.correctAnswer}`,
  })));

  return [...level1, ...level2, ...level3];
}

function isTieredQuestionItem(value: unknown): value is TieredQuestionItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.baseItemId === "string" &&
    (item.contentType === "vocab" || item.contentType === "concept") &&
    typeof item.question === "string" &&
    typeof item.correctAnswer === "string" &&
    Array.isArray(item.distractors) &&
    (item.difficultyLevel === 1 || item.difficultyLevel === 2 || item.difficultyLevel === 3) &&
    typeof item.isOriginal === "boolean" &&
    (typeof item.variationOf === "string" || item.variationOf === null) &&
    typeof item.sourceMetadata === "object" &&
    item.sourceMetadata !== null
  );
}

/**
 * Extract structured educational content from a document using AI.
 *
 * Expects either:
 *   - { fileName, mimeType, text }   — plain-text content already extracted by the client
 *   - { fileName, mimeType, base64 } — Base64-encoded PDF or DOCX for server-side extraction
 *
 * Reads OPENAI_API_KEY from Firebase Functions secrets (set via `firebase functions:secrets:set OPENAI_API_KEY`).
 * Falls back to an empty extraction result rather than throwing when the key is not configured,
 * so the UI can still display the review screen with a prompt to configure the key.
 */
export const extractDocumentContent = onCall({ secrets: [openAiKeySecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to use document extraction.");
  }

  const data = request.data as {
    fileName?: unknown;
    mimeType?: unknown;
    text?: unknown;
    base64?: unknown;
    context?: unknown;
  };

  const fileName = typeof data.fileName === "string" ? data.fileName : "document";
  const mimeType = typeof data.mimeType === "string" ? data.mimeType : "text/plain";
  const rawText = typeof data.text === "string" ? data.text : null;
  const base64Data = typeof data.base64 === "string" ? data.base64 : null;
  const context = sanitizeExtractionContext(data.context);

  if (!rawText && !base64Data) {
    throw new HttpsError("invalid-argument", "Either text or base64 document content is required.");
  }

  const documentText = await extractReadableDocumentText({
    fileName,
    mimeType,
    rawText,
    base64Data,
  });

  if (!documentText.trim()) {
    throw new HttpsError("invalid-argument", "Could not extract readable text from the document.");
  }

  // Truncate to a safe context size (approx 12 000 tokens @ ~4 chars/token)
  const MAX_CHARS = 48_000;
  const truncated = documentText.length > MAX_CHARS
    ? documentText.slice(0, MAX_CHARS) + "\n[... content truncated ...]"
    : documentText;

  const heuristicQuality = analyzeDocumentQuality({
    text: truncated,
    fileName,
    mimeType,
    context,
  });

  if (!heuristicQuality.accepted) {
    return success("Document blocked for review.", buildBlockedExtraction(heuristicQuality));
  }

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    const quality = mergeQualityReports(heuristicQuality, {
      accepted: false,
      documentType: heuristicQuality.documentType,
      detectedLanguage: heuristicQuality.detectedLanguage,
      questionAnswerLayouts: heuristicQuality.questionAnswerLayouts,
      issues: [{
        code: "extraction_unavailable",
        severity: "error",
        message: "AI extraction is unavailable because OPENAI_API_KEY is not configured.",
      }],
    });
    return success(
      `OpenAI key not configured. Set it with: firebase functions:secrets:set OPENAI_API_KEY`,
      buildBlockedExtraction(quality)
    );
  }

  const { systemPrompt, userPrompt } = buildExtractionPrompts({
    fileName,
    truncatedText: truncated,
    context,
    quality: heuristicQuality,
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1500,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new HttpsError("internal", `OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content?.trim() ?? "";

  let extracted: ExtractedDocumentData;
  try {
    // Strip potential markdown code fences
    const cleaned = content.replace(/^```[a-z]*\n?|```$/gm, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const aiQuality = typeof parsed.quality === "object" && parsed.quality !== null
      ? parsed.quality as Partial<ExtractionQualityReport>
      : undefined;
    const mergedQuality = mergeQualityReports(heuristicQuality, aiQuality);

    const vocabWithDefinitions = Array.isArray(parsed.vocabWithDefinitions)
      ? (parsed.vocabWithDefinitions as Array<{ word?: unknown; definition?: unknown }>)
          .filter((entry) => typeof entry.word === "string" && entry.word.trim().length > 0)
          .map((entry) => ({
            word: (entry.word as string).trim(),
            definition: typeof entry.definition === "string" ? entry.definition.trim() || undefined : undefined,
          }))
      : [];

    const conceptsWithExplanations = Array.isArray(parsed.conceptsWithExplanations)
      ? (parsed.conceptsWithExplanations as Array<{ name?: unknown; explanation?: unknown }>)
          .filter((entry) => typeof entry.name === "string" && entry.name.trim().length > 0)
          .map((entry) => ({
            name: (entry.name as string).trim(),
            explanation: typeof entry.explanation === "string" ? entry.explanation.trim() || undefined : undefined,
          }))
      : [];

    const inferredChapterTitle = typeof parsed.inferredChapterTitle === "string"
      ? parsed.inferredChapterTitle.trim() || undefined
      : undefined;

    const inferredSectionTitle = typeof parsed.inferredSectionTitle === "string"
      ? parsed.inferredSectionTitle.trim() || undefined
      : undefined;

    const sectionTitleMismatch =
      context?.sectionTitle &&
      inferredSectionTitle &&
      normalizeComparisonKey(context.sectionTitle) !== normalizeComparisonKey(inferredSectionTitle);

    const qualityWithSectionCheck = sectionTitleMismatch
      ? {
          ...mergedQuality,
          issues: [
            ...mergedQuality.issues,
            {
              code: "subject_mismatch" as const,
              severity: "warning" as const,
              message: `Inferred section title "${inferredSectionTitle}" may not match selected section "${context?.sectionTitle}".`,
            },
          ],
        }
      : mergedQuality;

    extracted = {
      vocab: qualityWithSectionCheck.accepted
        ? (vocabWithDefinitions.length > 0
            ? uniqueTrimmedStrings(vocabWithDefinitions.map((entry) => entry.word))
            : uniqueTrimmedStrings(parsed.vocab))
        : [],
      concepts: qualityWithSectionCheck.accepted
        ? (conceptsWithExplanations.length > 0
            ? uniqueTrimmedStrings(conceptsWithExplanations.map((entry) => entry.name))
            : uniqueTrimmedStrings(parsed.concepts))
        : [],
      equations: qualityWithSectionCheck.accepted ? uniqueTrimmedStrings(parsed.equations) : [],
      namesAndDates: Array.isArray(parsed.namesAndDates)
        ? (parsed.namesAndDates as Array<{ name?: unknown; date?: unknown }>)
            .filter((entry) => typeof entry.name === "string")
            .map((entry) => ({ name: (entry.name as string).trim(), date: typeof entry.date === "string" ? entry.date.trim() || undefined : undefined }))
            .filter((entry) => qualityWithSectionCheck.accepted && entry.name.length > 0)
        : [],
      keyIdeas: qualityWithSectionCheck.accepted ? uniqueTrimmedStrings(parsed.keyIdeas) : [],
      vocabWithDefinitions: qualityWithSectionCheck.accepted ? vocabWithDefinitions : [],
      conceptsWithExplanations: qualityWithSectionCheck.accepted ? conceptsWithExplanations : [],
      inferredChapterTitle,
      inferredSectionTitle,
      quality: {
        ...qualityWithSectionCheck,
        accepted: !qualityWithSectionCheck.issues.some((issue) => issue.severity === "error"),
      },
    };
  } catch {
    throw new HttpsError("internal", "AI returned malformed JSON. Please try again.");
  }

  return success(
    extracted.quality.issues.length > 0 ? "Extraction completed with review notes." : "Extraction complete.",
    extracted
  );
});

export const generateTieredQuestionVariations = onCall({ secrets: [openAiKeySecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to generate tiered question variations.");
  }

  const payload = request.data as {
    items?: unknown;
    chapterTerms?: unknown;
    generationContext?: unknown;
  };

  const seedItems = Array.isArray(payload.items)
    ? payload.items.filter((item): item is TieredQuestionSeedItem => {
        if (!item || typeof item !== "object") {
          return false;
        }

        const candidate = item as Record<string, unknown>;
        return (
          typeof candidate.id === "string" &&
          (candidate.contentType === "vocab" || candidate.contentType === "concept") &&
          typeof candidate.question === "string" &&
          typeof candidate.correctAnswer === "string" &&
          typeof candidate.sourceMetadata === "object" &&
          candidate.sourceMetadata !== null
        );
      })
    : [];

  if (seedItems.length === 0) {
    throw new HttpsError("invalid-argument", "At least one seed item is required.");
  }

  const derivedGradeFromSeeds = inferGradeLevel(
    seedItems.find((item) => typeof item.sourceMetadata?.educationalContext?.gradeLevel === "number")
      ?.sourceMetadata?.educationalContext?.gradeLevel?.toString()
  );
  const providedGenerationContext = sanitizeTieredGenerationContext(payload.generationContext);
  const gradeLevel = providedGenerationContext?.gradeLevel ?? derivedGradeFromSeeds;
  const generationContext: TieredVariationGenerationContext = {
    textbookTitle: providedGenerationContext?.textbookTitle
      ?? seedItems.find((item) => item.sourceMetadata?.educationalContext?.textbookTitle)
        ?.sourceMetadata?.educationalContext?.textbookTitle,
    textbookSubject: providedGenerationContext?.textbookSubject
      ?? seedItems.find((item) => item.sourceMetadata?.educationalContext?.textbookSubject)
        ?.sourceMetadata?.educationalContext?.textbookSubject,
    gradeLevel,
    level2TargetReadingGrade: providedGenerationContext?.level2TargetReadingGrade
      ?? (gradeLevel ? Math.min(16, gradeLevel + 1) : undefined),
    level3TargetReadingGrade: providedGenerationContext?.level3TargetReadingGrade
      ?? (gradeLevel ? Math.min(16, gradeLevel + 2) : undefined),
  };

  const chapterTerms = uniqueTrimmedStrings(payload.chapterTerms);
  const fallbackItems = buildFallbackTieredItems(seedItems, chapterTerms, generationContext);

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    return success("Tiered variations generated with local fallback.", { items: fallbackItems });
  }

  const systemPrompt = [
    "You are an instructional quiz variation generator.",
    "Return ONLY valid JSON with shape: { \"items\": TieredQuestionItem[] }.",
    "Every seed item must produce:",
    "- Level 1 item: exact question text + exact correct answer + 3-5 AI distractors.",
    "- Level 2 items: 2-3 moderate practice variations with reworded stems/definitions.",
    "- Level 3 items: 2-3 high-difficulty variations (NOT/inverted/scenario/reasoning).",
    "For Level 1 distractors: similar length, similar reading level, plausible, include misconceptions, one-word-off when fitting, and chapter-term-based distractors.",
    "Respect classroom context when available:",
    "- Use textbook subject and textbook title to keep terms domain-appropriate.",
    "- Use provided grade-level targets to control reading complexity.",
    "- Level 2 should be roughly +1 reading level from base grade.",
    "- Level 3 should be roughly +2 reading levels from base grade.",
    "Do not copy or reference real test content.",
    "For Levels 2 and 3 always rewrite enough to avoid verbatim duplication while preserving meaning.",
    "Set `variationOf` to `<seed-id>:l1` for all Level 2 and Level 3 items.",
    "Set `isOriginal` true only for Level 1.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    seedItems,
    chapterTerms,
    generationContext,
    schema: {
      items: [
        {
          id: "string",
          baseItemId: "string",
          contentType: "vocab|concept",
          question: "string",
          correctAnswer: "string",
          distractors: ["string", "string", "string"],
          difficultyLevel: 1,
          isOriginal: true,
          variationOf: null,
          sourceMetadata: {
            sourceType: "string",
            originalFilename: "string",
            variationAllowed: true,
            inferredLocation: { chapter: 1, section: 1 },
          },
        },
      ],
    },
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2200,
        temperature: 0.45,
      }),
    });

    if (!response.ok) {
      return success("Tiered variations generated with fallback after AI error.", { items: fallbackItems });
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    const cleaned = content.replace(/^```[a-z]*\n?|```$/gm, "").trim();
    const parsed = JSON.parse(cleaned) as { items?: unknown };
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter(isTieredQuestionItem)
      : [];

    if (items.length === 0) {
      return success("Tiered variations generated with fallback due to malformed AI payload.", { items: fallbackItems });
    }

    const validated = items.map((item) => {
      const normalizedQuestion = normalizeTieredText(item.question);
      const normalizedAnswer = normalizeTieredText(item.correctAnswer);
      const resemblesTest = resemblesProtectedTestContent(item.question) || resemblesProtectedTestContent(item.correctAnswer);
      const needsRewrite =
        (item.difficultyLevel === 2 || item.difficultyLevel === 3) &&
        (resemblesTest || (item.isOriginal === false && normalizedQuestion === normalizeTieredText(item.baseItemId)));

      const withDistractors = {
        ...item,
        distractors: item.distractors
          .map((choice) => choice.trim())
          .filter((choice) => choice.length > 0 && normalizeTieredText(choice) !== normalizedAnswer)
          .slice(0, 5),
      };

      return needsRewrite ? forceSemanticRewrite(withDistractors) : withDistractors;
    });

    return success("Tiered variations generated.", { items: validated });
  } catch {
    return success("Tiered variations generated with fallback.", { items: fallbackItems });
  }
});

/**
 * Generate theme and visual redesign suggestions for imported slide decks.
 */
export const generatePresentationDesignSuggestions = onCall({ secrets: [openAiKeySecret] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to generate design suggestions.");
  }

  const payload = request.data as {
    presentationTitle?: unknown;
    topic?: unknown;
    slideTexts?: unknown;
  };

  const presentationTitle = typeof payload.presentationTitle === "string" ? payload.presentationTitle.trim() : "Untitled Presentation";
  const topic = typeof payload.topic === "string" ? payload.topic.trim() : "general education";
  const slideTexts = Array.isArray(payload.slideTexts)
    ? payload.slideTexts.filter((value): value is string => typeof value === "string").slice(0, 50)
    : [];

  const openaiKey = getOpenAiApiKey();
  if (!openaiKey) {
    return success("Fallback design suggestions generated.", {
      themeName: "Clear Professional",
      backgroundAssets: [
        "https://images.unsplash.com/photo-1557683316-973673baf926",
        "https://images.unsplash.com/photo-1526498460520-4c246339dccb",
      ],
      fontChoices: ["Calibri", "Trebuchet MS"],
      animationStyle: "fade-in",
      iconSuggestions: {
        vocabulary: "book-open",
        quiz: "lightbulb",
      },
      videoBackgroundSuggestions: ["https://cdn.pixabay.com/video/2021/08/15/85138-587284861_large.mp4"],
    });
  }

  const systemPrompt = [
    "You are an instructional design assistant for K-12 teachers.",
    "Return ONLY valid JSON without markdown.",
    "Suggest a modern and professional slide redesign package.",
    "Use this exact schema:",
    "{",
    '  "themeName": string,',
    '  "backgroundAssets": string[],',
    '  "fontChoices": string[],',
    '  "animationStyle": string,',
    '  "iconSuggestions": Record<string, string>,',
    '  "videoBackgroundSuggestions": string[]',
    "}",
    "Prefer high-resolution image and video URLs.",
    "Keep entries practical for classroom use.",
  ].join("\n");

  const userPrompt = [
    `Presentation title: ${presentationTitle}`,
    `Detected topic: ${topic}`,
    "Slide text samples:",
    ...slideTexts.map((text, index) => `${index + 1}. ${text}`),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 900,
      temperature: 0.35,
    }),
  });

  if (!response.ok) {
    throw new HttpsError("internal", `OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content?.trim() ?? "";
  try {
    const cleaned = content.replace(/^```[a-z]*\n?|```$/gm, "").trim();
    const parsed = JSON.parse(cleaned) as {
      themeName?: unknown;
      backgroundAssets?: unknown;
      fontChoices?: unknown;
      animationStyle?: unknown;
      iconSuggestions?: unknown;
      videoBackgroundSuggestions?: unknown;
    };

    return success("Design suggestions generated.", {
      themeName: typeof parsed.themeName === "string" ? parsed.themeName : "Modern Classroom",
      backgroundAssets: Array.isArray(parsed.backgroundAssets)
        ? parsed.backgroundAssets.filter((value): value is string => typeof value === "string")
        : [],
      fontChoices: Array.isArray(parsed.fontChoices)
        ? parsed.fontChoices.filter((value): value is string => typeof value === "string")
        : ["Calibri", "Segoe UI"],
      animationStyle: typeof parsed.animationStyle === "string" ? parsed.animationStyle : "fade-in",
      iconSuggestions: typeof parsed.iconSuggestions === "object" && parsed.iconSuggestions !== null
        ? parsed.iconSuggestions as Record<string, string>
        : {},
      videoBackgroundSuggestions: Array.isArray(parsed.videoBackgroundSuggestions)
        ? parsed.videoBackgroundSuggestions.filter((value): value is string => typeof value === "string")
        : [],
    });
  } catch {
    throw new HttpsError("internal", "AI returned malformed JSON for design suggestions.");
  }
});

interface ConvertPresentationApiPayload {
  fileName: string;
  base64: string;
}

interface ConvertPresentationApiResponse {
  fileName?: unknown;
  mimeType?: unknown;
  base64?: unknown;
}

function isValidBase64(value: string): boolean {
  if (!value || value.length < 20) {
    return false;
  }

  return /^[a-zA-Z0-9+/=]+$/.test(value);
}

async function callConversionEndpoint(input: {
  url: string;
  apiKey: string;
  payload: ConvertPresentationApiPayload;
}): Promise<ConvertPresentationApiResponse> {
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(input.payload),
  });

  if (!response.ok) {
    throw new Error(`conversion_http_${response.status}`);
  }

  return await response.json() as ConvertPresentationApiResponse;
}

/**
 * Converts legacy .ppt files to .pptx through an external conversion API.
 *
 * Environment variables:
 * - CONVERSION_API_URL: primary conversion endpoint
 * - CONVERSION_API_KEY: bearer token for conversion service
 * - CONVERSION_FALLBACK_API_URL: optional backup endpoint
 */
export const convertPresentationFile = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to convert presentation files.");
  }

  const data = request.data as { fileName?: unknown; base64?: unknown };
  const fileName = typeof data.fileName === "string" ? data.fileName.trim() : "";
  const base64 = typeof data.base64 === "string" ? data.base64.trim() : "";

  if (!fileName.toLowerCase().endsWith(".ppt")) {
    throw new HttpsError("invalid-argument", "Only legacy .ppt files should be sent to conversion.");
  }

  if (!isValidBase64(base64)) {
    throw new HttpsError("invalid-argument", "Invalid or empty presentation payload.");
  }

  const apiKey = process.env.CONVERSION_API_KEY ?? "";
  const apiUrl = process.env.CONVERSION_API_URL ?? "";
  const fallbackUrl = process.env.CONVERSION_FALLBACK_API_URL ?? "";

  if (!apiKey || !apiUrl) {
    return {
      success: false,
      message: "Automatic .ppt conversion is not configured. Please convert to .pptx manually for now.",
      data: {
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        base64: "",
      },
    };
  }

  const endpoints = [apiUrl, fallbackUrl].filter(Boolean);
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const converted = await callConversionEndpoint({
          url: endpoint,
          apiKey,
          payload: { fileName, base64 },
        });

        const convertedBase64 = typeof converted.base64 === "string" ? converted.base64.trim() : "";
        if (!isValidBase64(convertedBase64)) {
          throw new Error("conversion_response_invalid");
        }

        const convertedName = typeof converted.fileName === "string"
          ? converted.fileName
          : fileName.replace(/\.ppt$/i, ".pptx");

        return {
          success: true,
          message: "Presentation converted.",
          data: {
            fileName: convertedName,
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            base64: convertedBase64,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new HttpsError(
    "unavailable",
    `Automatic .ppt conversion failed after retries. Please retry or convert manually. (${String(lastError)})`
  );
});

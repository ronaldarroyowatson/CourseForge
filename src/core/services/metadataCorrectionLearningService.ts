export type MetadataPageType = "cover" | "title" | "other";

export interface MetadataResult {
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

export interface CorrectionRecord {
  id: string;
  timestamp: string;
  pageType: MetadataPageType;
  publisher: string | null;
  series: string | null;
  subject: string | null;
  originalVisionOutput: MetadataResult | null;
  originalOcrOutput: {
    rawText: string;
  } | null;
  finalMetadata: MetadataResult;
  imageReference: string | null;
  flagged: boolean;
  reasonFlagged?: string;
  finalConfidence: number;
  errorScore: number;
  reviewedByAdmin?: string | null;
  reviewStatus: "pending" | "accepted" | "rejected";
}

export interface CorrectionRules {
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

export interface CorrectionQueryFilters {
  publisher?: string;
  pageType?: MetadataPageType | "all";
  source?: MetadataResult["source"] | "all";
  flaggedOnly?: boolean;
  reviewStatus?: CorrectionRecord["reviewStatus"] | "all";
  minConfidence?: number;
  maxConfidence?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface SuspiciousSignal {
  suspicious: boolean;
  reason?: string;
}

export interface CorrectionValidationResult {
  valid: boolean;
  reason?: string;
}

export const METADATA_CORRECTION_STORAGE_KEYS = {
  corrections: "courseforge.metadataCorrections.v1",
  localRules: "courseforge.metadataCorrectionRules.local.v1",
  cloudRules: "courseforge.metadataCorrectionRules.cloud.v1",
  optedIn: "courseforge.metadataLearning.optIn",
} as const;

const MAX_CORRECTIONS = 600;
const MAX_REPLACEMENTS_PER_SCOPE = 120;

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePublisherKey(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeReplacements(
  replacements: Array<{ from: string; to: string }>,
  max = MAX_REPLACEMENTS_PER_SCOPE
): Array<{ from: string; to: string }> {
  const seen = new Set<string>();
  const result: Array<{ from: string; to: string }> = [];

  for (const replacement of replacements) {
    const from = replacement.from.trim();
    const to = replacement.to.trim();
    if (!from || !to || from === to) {
      continue;
    }

    const key = `${from.toLowerCase()}=>${to.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ from, to });
    if (result.length >= max) {
      break;
    }
  }

  return result;
}

function clampConfidence(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeMetadataResult(input: MetadataResult): MetadataResult {
  return {
    title: asTrimmed(input.title) ?? null,
    subtitle: asTrimmed(input.subtitle) ?? null,
    edition: asTrimmed(input.edition) ?? null,
    publisher: asTrimmed(input.publisher) ?? null,
    series: asTrimmed(input.series) ?? null,
    gradeLevel: asTrimmed(input.gradeLevel) ?? null,
    subject: asTrimmed(input.subject) ?? null,
    confidence: clampConfidence(input.confidence, 0),
    rawText: typeof input.rawText === "string" ? input.rawText : "",
    source: input.source,
  };
}

function computeErrorScore(vision: MetadataResult | null, finalConfidence: number): number {
  const visionConfidence = vision?.confidence ?? finalConfidence;
  return Math.abs(clampConfidence(visionConfidence, 0) - clampConfidence(finalConfidence, 0));
}

function sanitizeCorrectionRecord(input: CorrectionRecord): CorrectionRecord {
  const finalMetadata = normalizeMetadataResult(input.finalMetadata);
  const finalConfidence = clampConfidence(input.finalConfidence, finalMetadata.confidence);
  const reasonFlagged = asTrimmed(input.reasonFlagged) ?? undefined;

  return {
    id: input.id,
    timestamp: input.timestamp,
    pageType: input.pageType,
    publisher: asTrimmed(input.publisher) ?? null,
    series: asTrimmed(input.series) ?? null,
    subject: asTrimmed(input.subject) ?? null,
    originalVisionOutput: input.originalVisionOutput ? normalizeMetadataResult(input.originalVisionOutput) : null,
    originalOcrOutput: input.originalOcrOutput && typeof input.originalOcrOutput.rawText === "string"
      ? { rawText: input.originalOcrOutput.rawText }
      : null,
    finalMetadata,
    imageReference: asTrimmed(input.imageReference) ?? null,
    flagged: Boolean(input.flagged || reasonFlagged),
    reasonFlagged,
    finalConfidence,
    errorScore: clampConfidence(input.errorScore, computeErrorScore(input.originalVisionOutput, finalConfidence)),
    reviewedByAdmin: asTrimmed(input.reviewedByAdmin) ?? null,
    reviewStatus: input.reviewStatus,
  };
}

function parseCorrectionRecords(raw: string | null): CorrectionRecord[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as CorrectionRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.timestamp === "string")
      .map((item) => sanitizeCorrectionRecord(item));
  } catch {
    return [];
  }
}

function parseCorrectionRules(raw: string | null): CorrectionRules | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CorrectionRules;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      version: typeof parsed.version === "string" ? parsed.version : "0",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      globalReplacements: dedupeReplacements(Array.isArray(parsed.globalReplacements) ? parsed.globalReplacements : []),
      publisherSpecific: typeof parsed.publisherSpecific === "object" && parsed.publisherSpecific !== null
        ? Object.fromEntries(
            Object.entries(parsed.publisherSpecific).map(([key, value]) => {
              const replacements = dedupeReplacements(Array.isArray(value?.replacements) ? value.replacements : []);
              const patterns = Array.isArray(value?.patterns)
                ? value.patterns.filter((entry) => typeof entry?.pattern === "string" && typeof entry?.replacement === "string")
                : undefined;
              return [key, { replacements, patterns }];
            })
          )
        : {},
    };
  } catch {
    return null;
  }
}

export function createEmptyCorrectionRules(version = "1"): CorrectionRules {
  return {
    version,
    updatedAt: new Date().toISOString(),
    globalReplacements: [],
    publisherSpecific: {},
  };
}

export function isMetadataCorrectionSharingEnabled(): boolean {
  const storage = getStorage();
  if (!storage) {
    return true;
  }

  return storage.getItem(METADATA_CORRECTION_STORAGE_KEYS.optedIn) !== "false";
}

export function setMetadataCorrectionSharingEnabled(enabled: boolean): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(METADATA_CORRECTION_STORAGE_KEYS.optedIn, enabled ? "true" : "false");
}

export function readLocalCorrectionRecords(): CorrectionRecord[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  return parseCorrectionRecords(storage.getItem(METADATA_CORRECTION_STORAGE_KEYS.corrections));
}

export function writeLocalCorrectionRecords(records: CorrectionRecord[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(
    METADATA_CORRECTION_STORAGE_KEYS.corrections,
    JSON.stringify(records.slice(-MAX_CORRECTIONS).map((record) => sanitizeCorrectionRecord(record)))
  );
}

export function validateCorrectionRecordStructure(record: CorrectionRecord): CorrectionValidationResult {
  if (!record.finalMetadata.title || !record.finalMetadata.title.trim()) {
    return { valid: false, reason: "Title is required." };
  }

  if (!record.originalVisionOutput && !record.originalOcrOutput) {
    return { valid: false, reason: "At least one source output (vision or OCR) is required." };
  }

  if (!record.imageReference || !record.imageReference.trim()) {
    return { valid: false, reason: "Image snippet reference is required." };
  }

  const imageRef = record.imageReference.trim();
  const validImageRef = imageRef.startsWith("data:image/")
    || imageRef.startsWith("hash://")
    || imageRef.startsWith("blob:")
    || imageRef.startsWith("http://")
    || imageRef.startsWith("https://");

  if (!validImageRef) {
    return { valid: false, reason: "Image snippet reference is invalid." };
  }

  return { valid: true };
}

export function estimateImageReferenceBytes(imageReference: string | null): number {
  if (!imageReference) {
    return 0;
  }

  const trimmed = imageReference.trim();
  if (trimmed.startsWith("data:image/")) {
    const commaIndex = trimmed.indexOf(",");
    if (commaIndex >= 0) {
      const base64 = trimmed.slice(commaIndex + 1);
      return Math.ceil((base64.length * 3) / 4);
    }
  }

  return trimmed.length;
}

export function detectSuspiciousCorrection(record: CorrectionRecord): SuspiciousSignal {
  const combined = [
    record.finalMetadata.title,
    record.finalMetadata.subtitle,
    record.finalMetadata.publisher,
    record.finalMetadata.series,
    record.finalMetadata.subject,
    record.finalMetadata.rawText,
  ].filter((value): value is string => Boolean(value)).join(" ");

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

  if (!record.finalMetadata.title || record.finalMetadata.title.trim().length < 2) {
    return { suspicious: true, reason: "Final metadata title is too short." };
  }

  return { suspicious: false };
}

export function saveCorrectionRecord(
  record: Omit<CorrectionRecord, "id" | "timestamp" | "flagged" | "reasonFlagged" | "finalConfidence" | "errorScore" | "reviewStatus">
    & Partial<Pick<CorrectionRecord, "id" | "timestamp" | "reviewedByAdmin">>
): CorrectionRecord {
  const provisionalFinal = normalizeMetadataResult(record.finalMetadata);
  const finalConfidence = clampConfidence(provisionalFinal.confidence, 0.5);
  const provisional: CorrectionRecord = {
    ...record,
    id: record.id ?? `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: record.timestamp ?? new Date().toISOString(),
    flagged: false,
    finalConfidence,
    errorScore: computeErrorScore(record.originalVisionOutput ?? null, finalConfidence),
    reviewStatus: "pending",
  } as CorrectionRecord;

  const validation = validateCorrectionRecordStructure(provisional);
  const suspicious = detectSuspiciousCorrection(provisional);

  const next = sanitizeCorrectionRecord({
    ...provisional,
    flagged: !validation.valid || suspicious.suspicious,
    reasonFlagged: !validation.valid ? validation.reason : suspicious.reason,
    reviewStatus: "pending",
  });

  const records = readLocalCorrectionRecords();
  records.push(next);
  writeLocalCorrectionRecords(records);

  const localRules = deriveCorrectionRulesFromRecords(records.filter((entry) => entry.reviewStatus !== "rejected"));
  writeLocalCorrectionRules(localRules);

  return next;
}

function extractCandidateCorrections(
  source: MetadataResult | null,
  target: MetadataResult
): Array<{ from: string; to: string }> {
  if (!source) {
    return [];
  }

  const candidates: Array<{ from: string; to: string }> = [];
  const pairs: Array<[string | null, string | null]> = [
    [source.title, target.title],
    [source.subtitle, target.subtitle],
    [source.edition, target.edition],
    [source.publisher, target.publisher],
    [source.series, target.series],
    [source.gradeLevel, target.gradeLevel],
    [source.subject, target.subject],
  ];

  for (const [fromValue, toValue] of pairs) {
    const from = asTrimmed(fromValue);
    const to = asTrimmed(toValue);
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) {
      continue;
    }

    candidates.push({ from, to });
  }

  return candidates;
}

export function deriveCorrectionRulesFromRecords(records: CorrectionRecord[]): CorrectionRules {
  const globalFrequency = new Map<string, { from: string; to: string; count: number }>();
  const publisherBuckets = new Map<string, Map<string, { from: string; to: string; count: number }>>();

  for (const record of records) {
    if (record.reviewStatus === "rejected") {
      continue;
    }

    const candidates = [
      ...extractCandidateCorrections(record.originalVisionOutput, record.finalMetadata),
      ...extractCandidateCorrections(
        record.originalOcrOutput
          ? {
              ...record.finalMetadata,
              rawText: record.originalOcrOutput.rawText,
              source: "ocr",
            }
          : null,
        record.finalMetadata
      ),
    ];

    const publisherKey = normalizePublisherKey(record.publisher ?? record.finalMetadata.publisher ?? null);

    for (const candidate of candidates) {
      const globalKey = `${candidate.from.toLowerCase()}=>${candidate.to.toLowerCase()}`;
      const globalEntry = globalFrequency.get(globalKey);
      if (globalEntry) {
        globalEntry.count += 1;
      } else {
        globalFrequency.set(globalKey, { ...candidate, count: 1 });
      }

      if (publisherKey) {
        const publisherMap = publisherBuckets.get(publisherKey) ?? new Map<string, { from: string; to: string; count: number }>();
        const publisherEntry = publisherMap.get(globalKey);
        if (publisherEntry) {
          publisherEntry.count += 1;
        } else {
          publisherMap.set(globalKey, { ...candidate, count: 1 });
        }
        publisherBuckets.set(publisherKey, publisherMap);
      }
    }
  }

  const globalReplacements = [...globalFrequency.values()]
    .sort((left, right) => right.count - left.count)
    .map((entry) => ({ from: entry.from, to: entry.to }));

  const publisherSpecific: CorrectionRules["publisherSpecific"] = {};
  for (const [publisherKey, frequencyMap] of publisherBuckets.entries()) {
    const replacements = [...frequencyMap.values()]
      .sort((left, right) => right.count - left.count)
      .map((entry) => ({ from: entry.from, to: entry.to }));

    publisherSpecific[publisherKey] = {
      replacements: dedupeReplacements(replacements),
    };
  }

  return {
    version: `local-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    globalReplacements: dedupeReplacements(globalReplacements),
    publisherSpecific,
  };
}

export function readLocalCorrectionRules(): CorrectionRules {
  const storage = getStorage();
  if (!storage) {
    return createEmptyCorrectionRules("local-unavailable");
  }

  return parseCorrectionRules(storage.getItem(METADATA_CORRECTION_STORAGE_KEYS.localRules)) ?? createEmptyCorrectionRules("local-empty");
}

export function writeLocalCorrectionRules(rules: CorrectionRules): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const normalized: CorrectionRules = {
    ...rules,
    updatedAt: new Date().toISOString(),
    globalReplacements: dedupeReplacements(rules.globalReplacements),
    publisherSpecific: Object.fromEntries(
      Object.entries(rules.publisherSpecific).map(([publisher, entry]) => [
        publisher,
        {
          replacements: dedupeReplacements(entry.replacements),
          patterns: Array.isArray(entry.patterns)
            ? entry.patterns.filter((pattern) => pattern.pattern.trim() && pattern.replacement.trim())
            : undefined,
        },
      ])
    ),
  };

  storage.setItem(METADATA_CORRECTION_STORAGE_KEYS.localRules, JSON.stringify(normalized));
}

export function readCloudCorrectionRules(): CorrectionRules | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  return parseCorrectionRules(storage.getItem(METADATA_CORRECTION_STORAGE_KEYS.cloudRules));
}

export function writeCloudCorrectionRules(rules: CorrectionRules): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(METADATA_CORRECTION_STORAGE_KEYS.cloudRules, JSON.stringify(rules));
}

export function getEffectiveCorrectionRules(): CorrectionRules {
  const local = readLocalCorrectionRules();
  const cloud = readCloudCorrectionRules();

  if (!cloud) {
    return local;
  }

  const mergedPublisherKeys = new Set<string>([
    ...Object.keys(local.publisherSpecific),
    ...Object.keys(cloud.publisherSpecific),
  ]);

  const publisherSpecific: CorrectionRules["publisherSpecific"] = {};
  for (const key of mergedPublisherKeys) {
    const localEntry = local.publisherSpecific[key];
    const cloudEntry = cloud.publisherSpecific[key];

    publisherSpecific[key] = {
      replacements: dedupeReplacements([
        ...(localEntry?.replacements ?? []),
        ...(cloudEntry?.replacements ?? []),
      ]),
      patterns: [
        ...(localEntry?.patterns ?? []),
        ...(cloudEntry?.patterns ?? []),
      ],
    };
  }

  return {
    version: cloud.version,
    updatedAt: cloud.updatedAt,
    globalReplacements: dedupeReplacements([
      ...local.globalReplacements,
      ...cloud.globalReplacements,
    ]),
    publisherSpecific,
  };
}

function applyLiteralReplacement(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), to);
}

export function applyCorrectionRulesToText(
  text: string,
  rules: CorrectionRules,
  context?: { publisher?: string | null }
): string {
  if (!text.trim()) {
    return text;
  }

  let next = text;

  for (const replacement of rules.globalReplacements) {
    next = applyLiteralReplacement(next, replacement.from, replacement.to);
  }

  const publisherKey = normalizePublisherKey(context?.publisher ?? null);
  if (!publisherKey) {
    return next;
  }

  const publisherRule = rules.publisherSpecific[publisherKey];
  if (!publisherRule) {
    return next;
  }

  for (const replacement of publisherRule.replacements) {
    next = applyLiteralReplacement(next, replacement.from, replacement.to);
  }

  for (const patternRule of publisherRule.patterns ?? []) {
    try {
      next = next.replace(new RegExp(patternRule.pattern, "gi"), patternRule.replacement);
    } catch {
      // Ignore invalid regex patterns from remote rules.
    }
  }

  return next;
}

export function queryCorrectionRecords(
  records: CorrectionRecord[],
  filters: CorrectionQueryFilters,
  input?: {
    sortBy?: "timestamp" | "finalConfidence" | "errorScore";
    sortDirection?: "asc" | "desc";
    page?: number;
    pageSize?: number;
  }
): { total: number; items: CorrectionRecord[] } {
  const filtered = records.filter((record) => {
    if (filters.publisher && normalizePublisherKey(record.publisher) !== normalizePublisherKey(filters.publisher)) {
      return false;
    }

    if (filters.pageType && filters.pageType !== "all" && record.pageType !== filters.pageType) {
      return false;
    }

    if (filters.source && filters.source !== "all" && record.finalMetadata.source !== filters.source) {
      return false;
    }

    if (filters.flaggedOnly && !record.flagged) {
      return false;
    }

    if (filters.reviewStatus && filters.reviewStatus !== "all" && record.reviewStatus !== filters.reviewStatus) {
      return false;
    }

    if (typeof filters.minConfidence === "number" && record.finalConfidence < filters.minConfidence) {
      return false;
    }

    if (typeof filters.maxConfidence === "number" && record.finalConfidence > filters.maxConfidence) {
      return false;
    }

    if (filters.dateFrom && record.timestamp < filters.dateFrom) {
      return false;
    }

    if (filters.dateTo && record.timestamp > filters.dateTo) {
      return false;
    }

    return true;
  });

  const sortBy = input?.sortBy ?? "errorScore";
  const sortDirection = input?.sortDirection ?? "desc";

  filtered.sort((left, right) => {
    const direction = sortDirection === "desc" ? -1 : 1;
    if (sortBy === "timestamp") {
      return left.timestamp.localeCompare(right.timestamp) * direction;
    }

    if (sortBy === "finalConfidence") {
      return (left.finalConfidence - right.finalConfidence) * direction;
    }

    return (left.errorScore - right.errorScore) * direction;
  });

  const pageSize = Math.max(1, input?.pageSize ?? 20);
  const page = Math.max(1, input?.page ?? 1);
  const start = (page - 1) * pageSize;

  return {
    total: filtered.length,
    items: filtered.slice(start, start + pageSize),
  };
}

export function didMetadataChange(original: MetadataResult | null, finalMetadata: MetadataResult): boolean {
  if (!original) {
    return true;
  }

  return (
    (asTrimmed(original.title) ?? "") !== (asTrimmed(finalMetadata.title) ?? "")
    || (asTrimmed(original.subtitle) ?? "") !== (asTrimmed(finalMetadata.subtitle) ?? "")
    || (asTrimmed(original.edition) ?? "") !== (asTrimmed(finalMetadata.edition) ?? "")
    || (asTrimmed(original.publisher) ?? "") !== (asTrimmed(finalMetadata.publisher) ?? "")
    || (asTrimmed(original.series) ?? "") !== (asTrimmed(finalMetadata.series) ?? "")
    || (asTrimmed(original.gradeLevel) ?? "") !== (asTrimmed(finalMetadata.gradeLevel) ?? "")
    || (asTrimmed(original.subject) ?? "") !== (asTrimmed(finalMetadata.subject) ?? "")
  );
}

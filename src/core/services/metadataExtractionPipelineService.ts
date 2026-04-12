import { httpsCallable } from "firebase/functions";

import { functionsClient } from "../../firebase/functions";
import type { RelatedIsbn } from "../models";
import { extractTextFromImageWithFallback, type AutoOcrProviderId } from "./autoOcrService";
import { appendDebugLogEntry } from "./debugLogService";
import { getCurrentUser } from "../../firebase/auth";
import {
  applyCorrectionRulesToText,
  getEffectiveCorrectionRules,
  type MetadataPageType,
  type MetadataResult,
} from "./metadataCorrectionLearning";
import { extractMetadataFromOcrText } from "./textbookAutoExtractionService";

const DEFAULT_VISION_CONFIDENCE_THRESHOLD = 0.72;
const MAX_METADATA_OCR_ATTEMPTS = 3;
const DEBUG_IMAGE_PREVIEW_BASE64_CHARS = 4096;
const METADATA_PIPELINE_RUNTIME_STATUS_KEY = "courseforge.metadataPipeline.runtime.v1";
const TITLE_CRITICAL_FIELDS = ["isbn", "copyrightYear"] as const;
const TITLE_TARGET_DEBUG_FIELDS = [
  "title",
  "subtitle",
  "publisher",
  "publisherLocation",
  "isbn",
  "copyrightYear",
  "platformUrl",
  "mhid",
] as const;

export interface MetadataPipelineRuntimeStatus {
  updatedAt: string;
  traceId: string | null;
  pageType: MetadataPageType | null;
  stage: "idle" | "started" | "vision_attempt" | "vision_failed" | "fallback_to_ocr" | "ocr_succeeded" | "completed";
  path: "vision_only" | "ocr_only" | "vision_ocr_merged" | null;
  secondaryAgent: {
    name: string;
    attempted: boolean;
    succeeded: boolean;
    lastError: string | null;
  };
  ocr: {
    providerId: AutoOcrProviderId | null;
    rawTextLength: number;
    attemptCount: number;
    maxAttempts: number;
  };
  parsedFieldsCount: number;
  parsedFields: string[];
  missingCriticalFields: string[];
  missingTargetFields: string[];
}

const DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS: MetadataPipelineRuntimeStatus = {
  updatedAt: new Date(0).toISOString(),
  traceId: null,
  pageType: null,
  stage: "idle",
  path: null,
  secondaryAgent: {
    name: "extractMetadataFromImageVision (OpenAI gpt-4o-mini)",
    attempted: false,
    succeeded: false,
    lastError: null,
  },
  ocr: {
    providerId: null,
    rawTextLength: 0,
    attemptCount: 0,
    maxAttempts: MAX_METADATA_OCR_ATTEMPTS,
  },
  parsedFieldsCount: 0,
  parsedFields: [],
  missingCriticalFields: [],
  missingTargetFields: [],
};

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function summarizeMetadataFields(metadata: MetadataResult): string[] {
  return [
    metadata.title ? "title" : null,
    metadata.subtitle ? "subtitle" : null,
    metadata.edition ? "edition" : null,
    metadata.publisher ? "publisher" : null,
    metadata.publisherLocation ? "publisherLocation" : null,
    metadata.series ? "series" : null,
    metadata.gradeLevel ? "gradeLevel" : null,
    metadata.subject ? "subject" : null,
    metadata.copyrightYear ? "copyrightYear" : null,
    metadata.isbn ? "isbn" : null,
    metadata.additionalIsbns && metadata.additionalIsbns.length > 0 ? "additionalIsbns" : null,
    metadata.relatedIsbns && metadata.relatedIsbns.length > 0 ? "relatedIsbns" : null,
    metadata.platformUrl ? "platformUrl" : null,
    metadata.mhid ? "mhid" : null,
  ].filter((value): value is string => Boolean(value));
}

function updateMetadataPipelineRuntimeStatus(patch: Partial<MetadataPipelineRuntimeStatus>): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const current = readMetadataPipelineRuntimeStatus();
  const next: MetadataPipelineRuntimeStatus = {
    ...current,
    ...patch,
    secondaryAgent: {
      ...current.secondaryAgent,
      ...(patch.secondaryAgent ?? {}),
    },
    ocr: {
      ...current.ocr,
      ...(patch.ocr ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };

  storage.setItem(METADATA_PIPELINE_RUNTIME_STATUS_KEY, JSON.stringify(next));
}

export function readMetadataPipelineRuntimeStatus(): MetadataPipelineRuntimeStatus {
  const storage = getStorage();
  if (!storage) {
    return DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS;
  }

  const raw = storage.getItem(METADATA_PIPELINE_RUNTIME_STATUS_KEY);
  if (!raw) {
    return DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<MetadataPipelineRuntimeStatus>;
    return {
      ...DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS,
      ...parsed,
      secondaryAgent: {
        ...DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS.secondaryAgent,
        ...(parsed.secondaryAgent ?? {}),
      },
      ocr: {
        ...DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS.ocr,
        ...(parsed.ocr ?? {}),
      },
      missingCriticalFields: Array.isArray(parsed.missingCriticalFields)
        ? parsed.missingCriticalFields.filter((value): value is string => typeof value === "string")
        : [],
      missingTargetFields: Array.isArray(parsed.missingTargetFields)
        ? parsed.missingTargetFields.filter((value): value is string => typeof value === "string")
        : [],
      parsedFields: Array.isArray(parsed.parsedFields)
        ? parsed.parsedFields.filter((value): value is string => typeof value === "string")
        : [],
    };
  } catch {
    return DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS;
  }
}

function createMetadataPipelineTraceId(prefix = "metadata-pipeline"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function emitMetadataPipelineDiagnostic(
  event: string,
  options: {
    level?: "info" | "warning" | "error";
    traceId?: string;
    context?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const level = options.level ?? "info";
  const traceId = options.traceId;
  const context = {
    ...(options.context ?? {}),
    traceId: traceId ?? null,
  };

  const eventType = level === "error"
    ? "error"
    : level === "warning"
      ? "warning"
      : "info";

  void appendDebugLogEntry({
    eventType,
    message: `Metadata pipeline ${event}`,
    context,
  }, getCurrentUser()?.uid ?? null).catch(() => {
    // Best effort diagnostics.
  });

  if (typeof fetch === "function") {
    void fetch("/api/ocr-debug-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: `metadata_pipeline_${event}`,
        level,
        traceId: traceId ?? null,
        context,
      }),
    }).catch(() => {
      // Best effort diagnostics.
    });
  }
}

export interface MetadataExtractionContext {
  pageType: MetadataPageType;
  publisherHint?: string | null;
}

export interface OcrMetadataOutput {
  rawText: string;
  providerId: AutoOcrProviderId;
}

export interface MetadataPipelineResult {
  result: MetadataResult;
  originalVisionOutput: MetadataResult | null;
  originalOcrOutput: OcrMetadataOutput | null;
}

export interface MetadataPipelineTraceRecord {
  step: MetadataPageType;
  component: "pipeline" | "vision" | "ocr" | "agent" | "mapping";
  action: string;
  severity?: "info" | "warning" | "error";
  details?: Record<string, unknown>;
}

export interface MetadataPipelineExtractionOptions {
  confidenceThreshold?: number;
  traceRecorder?: (record: MetadataPipelineTraceRecord) => void;
}

interface VisionCallableResponse {
  success?: boolean;
  message?: string;
  data?: {
    metadata?: Partial<MetadataResult>;
    rawText?: string;
    confidence?: number;
  };
}

function clampConfidence(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : fallback;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeIsbnDigits(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  return (digits.length === 10 || digits.length === 13) ? digits : null;
}

function parseCopyrightYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1900 && parsed <= new Date().getFullYear() + 5) {
      return parsed;
    }
  }

  return null;
}

function inferGradeLevelFromPlatformUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  const lowered = url.toLowerCase();
  if (/\bpre\s*-?k\s*[-_/]\s*12\b|\/prek-?12\b/.test(lowered)) {
    return "Pre-K-12";
  }

  return null;
}

function isCopyrightLikePage(metadata: MetadataResult, context: MetadataExtractionContext): boolean {
  if (context.pageType !== "title") {
    return false;
  }

  const raw = metadata.rawText.toLowerCase();
  return /send all inquiries|all rights reserved|no part of this publication|printed in the united states/.test(raw);
}

function hasCriticalCopyrightFields(metadata: MetadataResult): boolean {
  return Boolean(metadata.isbn && metadata.copyrightYear && metadata.platformUrl && metadata.publisherLocation);
}

function normalizeMetadataResult(input: Partial<MetadataResult> & Pick<MetadataResult, "source">): MetadataResult {
  const normalizedPlatformUrl = normalizeTextValue(input.platformUrl);
  const normalizedGradeLevel = normalizeTextValue(input.gradeLevel);
  const inferredGradeLevel = inferGradeLevelFromPlatformUrl(normalizedPlatformUrl);

  return {
    title: normalizeTextValue(input.title),
    subtitle: normalizeTextValue(input.subtitle),
    edition: normalizeTextValue(input.edition),
    publisher: normalizeTextValue(input.publisher),
    publisherLocation: normalizeTextValue(input.publisherLocation),
    series: normalizeTextValue(input.series),
    gradeLevel: normalizedGradeLevel ?? inferredGradeLevel,
    subject: normalizeTextValue(input.subject),
    copyrightYear: parseCopyrightYear(input.copyrightYear),
    isbn: normalizeIsbnDigits(normalizeTextValue(input.isbn)),
    additionalIsbns: Array.isArray(input.additionalIsbns)
      ? input.additionalIsbns
          .map((value) => normalizeIsbnDigits(normalizeTextValue(value)))
          .filter((value): value is string => Boolean(value))
      : undefined,
    relatedIsbns: Array.isArray(input.relatedIsbns)
      ? input.relatedIsbns.reduce<RelatedIsbn[]>((accumulator, entry) => {
          if (!entry || typeof entry.isbn !== "string" || typeof entry.type !== "string") {
            return accumulator;
          }

          const normalizedIsbn = normalizeIsbnDigits(entry.isbn.trim());
          if (!normalizedIsbn) {
            return accumulator;
          }

          const note = normalizeTextValue(entry.note) ?? undefined;
          accumulator.push(note ? { isbn: normalizedIsbn, type: entry.type, note } : { isbn: normalizedIsbn, type: entry.type });
          return accumulator;
        }, [])
      : undefined,
    platformUrl: normalizedPlatformUrl,
    mhid: normalizeTextValue(input.mhid),
    confidence: clampConfidence(input.confidence),
    rawText: typeof input.rawText === "string" ? input.rawText : "",
    source: input.source,
  };
}

function metadataHasRequiredFields(metadata: MetadataResult): boolean {
  return Boolean(metadata.title && metadata.title.trim().length >= 2);
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function removeRepeatedAdjacentWords(value: string): string {
  return value.replace(/\b([A-Za-z][A-Za-z0-9'’.-]*)\s+\1\b/gi, "$1");
}

function postProcessOcrText(rawText: string, context: MetadataExtractionContext): string {
  const cleaned = rawText.replace(/\r/g, "\n");
  const deduped = removeRepeatedAdjacentWords(cleaned);
  const normalized = normalizeWhitespace(deduped);
  return applyCorrectionRulesToText(normalized, getEffectiveCorrectionRules(), {
    publisher: context.publisherHint,
  });
}

function extractFocusedIdentifierBackfill(rawText: string): Partial<MetadataResult> {
  const normalized = rawText.replace(/\r/g, "\n");
  const fallback: Partial<MetadataResult> = {};

  const copyrightMatch = normalized.match(/(?:copyright|©)[^\d]{0,12}((?:19|20)\d{2})/i)
    ?? normalized.match(/\b((?:19|20)\d{2})\b/);
  if (copyrightMatch) {
    const parsedYear = Number.parseInt(copyrightMatch[1] ?? "", 10);
    if (Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= new Date().getFullYear() + 5) {
      fallback.copyrightYear = parsedYear;
    }
  }

  const mhidMatch = normalized.match(/\bmhid\b[^A-Z0-9]{0,8}([A-Z0-9-]{5,})/i);
  if (mhidMatch?.[1]) {
    fallback.mhid = mhidMatch[1].trim();
  }

  const isbnMatch = normalized.match(/(?:isbn[^0-9]*)?(97[89][\d\-\s]{10,20}|\b\d{9}[\dXx]\b)/i);
  if (isbnMatch?.[1]) {
    const normalizedIsbn = normalizeIsbnDigits(isbnMatch[1]);
    if (normalizedIsbn) {
      fallback.isbn = normalizedIsbn;
    }
  }

  const urlMatch = normalized.match(/\b(https?:\/\/[a-z0-9.-]+(?:\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]*)?|www\.[a-z0-9.-]+(?:\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]*)?|[a-z0-9.-]+\.[a-z]{2,}(?:\/[A-Za-z0-9._~:\/?#[\]@!$&'()*+,;=%-]*)?)\b/i);
  if (urlMatch?.[1]) {
    const trimmed = urlMatch[1].trim().replace(/[),.;:"'`]+$/, "").trim();
    fallback.platformUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const inquiriesIndex = lines.findIndex((line) => /^send all inquiries\s*to\s*[:\-]?/i.test(line));
  if (inquiriesIndex >= 0) {
    const locationLines: string[] = [];
    for (let index = inquiriesIndex + 1; index < lines.length && index <= inquiriesIndex + 8; index += 1) {
      const line = lines[index];
      if (!line) {
        if (locationLines.length > 0) {
          break;
        }
        continue;
      }

      if (/^isbn\b|^mhid\b|^printed in|^copyright|^all rights reserved|^no part of this publication/i.test(line)) {
        break;
      }

      locationLines.push(line);
    }

    if (locationLines.length > 0) {
      fallback.publisherLocation = locationLines.join("\n");
    }
  }

  return fallback;
}

function backfillMissingHighValueFields(metadata: MetadataResult, rawText: string): MetadataResult {
  const focused = extractFocusedIdentifierBackfill(rawText);
  return {
    ...metadata,
    copyrightYear: metadata.copyrightYear ?? focused.copyrightYear ?? null,
    mhid: metadata.mhid ?? (typeof focused.mhid === "string" ? focused.mhid : null),
    isbn: metadata.isbn ?? (typeof focused.isbn === "string" ? focused.isbn : null),
    platformUrl: metadata.platformUrl ?? (typeof focused.platformUrl === "string" ? focused.platformUrl : null),
    publisherLocation: metadata.publisherLocation ?? (typeof focused.publisherLocation === "string" ? focused.publisherLocation : null),
  };
}

function hasMetadataField(metadata: MetadataResult, field: string): boolean {
  const value = metadata[field as keyof MetadataResult];
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function collectMissingFields(metadata: MetadataResult, fields: readonly string[]): string[] {
  return fields.filter((field) => !hasMetadataField(metadata, field));
}

function createDebugImageArtifact(imageDataUrl: string): Record<string, unknown> | null {
  const dataUrlMatch = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!dataUrlMatch) {
    return null;
  }

  const mimeType = dataUrlMatch[1] ?? "application/octet-stream";
  const base64Payload = dataUrlMatch[2] ?? "";
  if (!base64Payload) {
    return null;
  }

  const previewPayload = base64Payload.slice(0, DEBUG_IMAGE_PREVIEW_BASE64_CHARS);
  return {
    mimeType,
    estimatedByteLength: Math.floor((base64Payload.length * 3) / 4),
    previewDataUrl: `data:${mimeType};base64,${previewPayload}`,
    isTruncated: base64Payload.length > DEBUG_IMAGE_PREVIEW_BASE64_CHARS,
  };
}

function buildMetadataFailureSnapshot(metadata: MetadataResult, ocrText: string, imageDataUrl: string): Record<string, unknown> {
  return {
    source: metadata.source,
    confidence: metadata.confidence,
    parsedFields: summarizeMetadataFields(metadata),
    missingCriticalFields: collectMissingFields(metadata, TITLE_CRITICAL_FIELDS),
    missingTargetFields: collectMissingFields(metadata, TITLE_TARGET_DEBUG_FIELDS),
    title: metadata.title,
    publisher: metadata.publisher,
    isbn: metadata.isbn,
    copyrightYear: metadata.copyrightYear,
    platformUrl: metadata.platformUrl,
    mhid: metadata.mhid,
    publisherLocation: metadata.publisherLocation,
    rawTextPreview: metadata.rawText.slice(0, 800),
    ocrTextPreview: ocrText.slice(0, 800),
    imageArtifact: createDebugImageArtifact(imageDataUrl),
  };
}

function metadataCoverageScore(metadata: MetadataResult): number {
  return summarizeMetadataFields(metadata).length;
}

function mergeVisionAndOcrMetadata(
  visionMetadata: MetadataResult,
  ocrMetadata: MetadataResult,
  ocrRawText: string
): MetadataResult {
  const mergedBase: MetadataResult = {
    title: visionMetadata.title ?? ocrMetadata.title,
    subtitle: visionMetadata.subtitle ?? ocrMetadata.subtitle,
    edition: visionMetadata.edition ?? ocrMetadata.edition,
    publisher: visionMetadata.publisher ?? ocrMetadata.publisher,
    publisherLocation: visionMetadata.publisherLocation ?? ocrMetadata.publisherLocation,
    series: visionMetadata.series ?? ocrMetadata.series,
    gradeLevel: visionMetadata.gradeLevel ?? ocrMetadata.gradeLevel,
    subject: crossValidateSubject(visionMetadata.subject, ocrRawText, ocrMetadata.subject),
    copyrightYear: visionMetadata.copyrightYear ?? ocrMetadata.copyrightYear,
    isbn: visionMetadata.isbn ?? ocrMetadata.isbn,
    additionalIsbns: Array.from(new Set([...(visionMetadata.additionalIsbns ?? []), ...(ocrMetadata.additionalIsbns ?? [])])),
    relatedIsbns: Array.from(new Map([...(visionMetadata.relatedIsbns ?? []), ...(ocrMetadata.relatedIsbns ?? [])].map((entry) => [`${entry.type}:${entry.isbn}`, entry])).values()),
    platformUrl: visionMetadata.platformUrl ?? ocrMetadata.platformUrl,
    mhid: visionMetadata.mhid ?? ocrMetadata.mhid,
    confidence: Math.max(ocrMetadata.confidence, visionMetadata.confidence),
    rawText: [visionMetadata.rawText, ocrMetadata.rawText].filter(Boolean).join("\n\n").trim(),
    source: "vision+ocr",
  };

  return backfillMissingHighValueFields(mergedBase, mergedBase.rawText);
}

function normalizeSubjectLabel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "math" || normalized === "mathematics") {
    return "Math";
  }

  if (normalized === "science" || normalized.includes("physical science") || normalized.includes("earth science")) {
    return "Science";
  }

  if (normalized === "social studies" || normalized === "history") {
    return "Social Studies";
  }

  if (normalized === "ela" || normalized === "english language arts") {
    return "ELA";
  }

  if (normalized === "computer science") {
    return "Computer Science";
  }

  return value.trim();
}

function hasSubjectEvidence(subject: string, rawText: string): boolean {
  const source = rawText.toLowerCase();
  if (subject === "Science") {
    return /physical science|earth science|life science|science|biology|chemistry|physics|anatomy|geology/.test(source);
  }

  if (subject === "Math") {
    return /math|mathematics|algebra|geometry|calculus|numbers?/.test(source);
  }

  if (subject === "Social Studies") {
    return /social studies|history|government|civics|geography/.test(source);
  }

  if (subject === "ELA") {
    // Require an explicit ELA-specific phrase to confirm evidence.
    // "reading" and "writing" alone are not sufficient — they appear in every subject.
    return /english language arts|language arts|\bliterature\b|\bgrammar\b/.test(source);
  }

  if (subject === "Computer Science") {
    return /computer science|coding|programming|algorithm/.test(source);
  }

  return false;
}

/**
 * Cross-validates the subject field from vision output against OCR-derived text.
 * Prevents the vision model from overriding a clearly science-subject text with "ELA"
 * (or another non-science category) when the raw OCR contains strong science keywords.
 */
function crossValidateSubject(
  visionSubject: string | null,
  ocrRawText: string,
  ocrSubject: string | null
): string | null {
  const normalizedVisionSubject = normalizeSubjectLabel(visionSubject);
  const normalizedOcrSubject = normalizeSubjectLabel(ocrSubject);

  if (normalizedVisionSubject && normalizedOcrSubject && normalizedVisionSubject !== normalizedOcrSubject) {
    return normalizedOcrSubject;
  }

  if (normalizedVisionSubject && !hasSubjectEvidence(normalizedVisionSubject, ocrRawText)) {
    return normalizedOcrSubject;
  }

  return normalizedVisionSubject ?? normalizedOcrSubject;
}

function crossValidateVisionSubjectFromRawText(metadata: MetadataResult): MetadataResult {
  if (!metadata.rawText.trim()) {
    return metadata;
  }

  const rawTextSubject = autoMetadataToMetadataResult(metadata.rawText, "ocr").subject;
  const subject = crossValidateSubject(metadata.subject, metadata.rawText, rawTextSubject);
  if (subject === metadata.subject) {
    return metadata;
  }

  return {
    ...metadata,
    subject,
  };
}

function autoMetadataToMetadataResult(rawText: string, source: MetadataResult["source"]): MetadataResult {
  const parsed = extractMetadataFromOcrText(rawText);

  return {
    title: parsed.title ?? null,
    subtitle: parsed.subtitle ?? null,
    edition: parsed.edition ?? null,
    publisher: parsed.publisher ?? null,
    publisherLocation: parsed.publisherLocation ?? null,
    series: parsed.seriesName ?? null,
    gradeLevel: parsed.gradeBand ?? null,
    subject: parsed.subject ?? null,
    copyrightYear: parsed.copyrightYear ?? null,
    isbn: parsed.isbn ?? null,
    additionalIsbns: parsed.additionalIsbns,
    relatedIsbns: parsed.relatedIsbns,
    platformUrl: parsed.platformUrl ?? null,
    mhid: parsed.mhid ?? null,
    confidence: source === "ocr" ? 0.58 : 0.66,
    rawText,
    source,
  };
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function imageBufferToDataUrl(imageBuffer: ArrayBuffer | Uint8Array, mimeType = "image/jpeg"): string {
  const bytes = imageBuffer instanceof Uint8Array ? imageBuffer : new Uint8Array(imageBuffer);
  const base64 = base64FromBytes(bytes);
  return `data:${mimeType};base64,${base64}`;
}

export async function extractMetadataFromImageDataUrl(
  imageDataUrl: string,
  context: MetadataExtractionContext
): Promise<MetadataResult> {
  const callable = httpsCallable(functionsClient, "extractMetadataFromImageVision");

  const response = await callable({
    imageDataUrl,
    context: {
      pageType: context.pageType,
      publisherHint: context.publisherHint ?? null,
    },
  });

  const payload = response.data as VisionCallableResponse;
  if (payload?.success !== true) {
    throw new Error(payload?.message ?? "Vision metadata extraction failed.");
  }

  const incoming = payload.data?.metadata;
  if (!incoming || typeof incoming !== "object") {
    throw new Error("Vision metadata extraction returned an invalid payload.");
  }

  const normalized = normalizeMetadataResult({
    ...incoming,
    rawText: payload.data?.rawText ?? incoming.rawText,
    confidence: payload.data?.confidence ?? incoming.confidence,
    source: "vision",
  });

  if (!metadataHasRequiredFields(normalized)) {
    throw new Error("Vision metadata extraction did not return enough fields.");
  }

  return normalized;
}

export async function extractMetadataFromImage(
  imageBuffer: ArrayBuffer | Uint8Array,
  context: MetadataExtractionContext
): Promise<MetadataResult> {
  const imageDataUrl = imageBufferToDataUrl(imageBuffer);
  return extractMetadataFromImageDataUrl(imageDataUrl, context);
}

export async function extractMetadataWithOcrFallbackFromDataUrl(
  imageDataUrl: string,
  context: MetadataExtractionContext,
  options: MetadataPipelineExtractionOptions = {}
): Promise<MetadataPipelineResult> {
  const emitTrace = (record: MetadataPipelineTraceRecord): void => {
    options.traceRecorder?.(record);
  };
  const traceId = createMetadataPipelineTraceId();
  const confidenceThreshold = clampConfidence(options.confidenceThreshold, DEFAULT_VISION_CONFIDENCE_THRESHOLD);

  emitTrace({
    step: context.pageType,
    component: "pipeline",
    action: "started",
    details: {
      traceId,
      imageBytes: imageDataUrl.length,
      confidenceThreshold,
    },
  });

  void emitMetadataPipelineDiagnostic("started", {
    traceId,
    context: {
      pageType: context.pageType,
      imageBytes: imageDataUrl.length,
      confidenceThreshold,
    },
  });
  updateMetadataPipelineRuntimeStatus({
    traceId,
    pageType: context.pageType,
    stage: "started",
    path: null,
    secondaryAgent: {
      name: DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS.secondaryAgent.name,
      attempted: false,
      succeeded: false,
      lastError: null,
    },
    ocr: {
      providerId: null,
      rawTextLength: 0,
      attemptCount: 0,
      maxAttempts: MAX_METADATA_OCR_ATTEMPTS,
    },
    parsedFieldsCount: 0,
    parsedFields: [],
    missingCriticalFields: [],
    missingTargetFields: [],
  });

  let originalVisionOutput: MetadataResult | null = null;
  try {
    emitTrace({
      step: context.pageType,
      component: "vision",
      action: "request_started",
      details: {
        traceId,
      },
    });
    void emitMetadataPipelineDiagnostic("vision_attempt_started", {
      traceId,
      context: { pageType: context.pageType },
    });
    originalVisionOutput = await extractMetadataFromImageDataUrl(imageDataUrl, context);
    updateMetadataPipelineRuntimeStatus({
      stage: "vision_attempt",
      secondaryAgent: {
        name: DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS.secondaryAgent.name,
        attempted: true,
        succeeded: true,
        lastError: null,
      },
    });
    void emitMetadataPipelineDiagnostic("vision_attempt_succeeded", {
      traceId,
      context: {
        confidence: originalVisionOutput.confidence,
        hasRequiredFields: metadataHasRequiredFields(originalVisionOutput),
        source: originalVisionOutput.source,
      },
    });
    emitTrace({
      step: context.pageType,
      component: "vision",
      action: "request_succeeded",
      details: {
        traceId,
        confidence: originalVisionOutput.confidence,
        subject: originalVisionOutput.subject,
      },
    });
  } catch {
    originalVisionOutput = null;
    updateMetadataPipelineRuntimeStatus({
      stage: "vision_failed",
      secondaryAgent: {
        name: DEFAULT_METADATA_PIPELINE_RUNTIME_STATUS.secondaryAgent.name,
        attempted: true,
        succeeded: false,
        lastError: "Vision metadata extraction failed.",
      },
    });
    void emitMetadataPipelineDiagnostic("vision_attempt_failed", {
      level: "warning",
      traceId,
      context: { pageType: context.pageType },
    });
    emitTrace({
      step: context.pageType,
      component: "vision",
      action: "request_failed",
      severity: "warning",
      details: {
        traceId,
      },
    });
  }

  const visionLooksUsable = Boolean(
    originalVisionOutput
    && originalVisionOutput.confidence >= confidenceThreshold
    && metadataHasRequiredFields(originalVisionOutput)
  );
  const copyrightFieldsSufficient = originalVisionOutput
    ? !isCopyrightLikePage(originalVisionOutput, context) || hasCriticalCopyrightFields(originalVisionOutput)
    : false;

  const shouldForceOcrEnrichment = Boolean(originalVisionOutput) && context.pageType === "title";
  const requiresOcrForCompleteness = !visionLooksUsable || !copyrightFieldsSufficient;
  const shouldAttemptOcr = shouldForceOcrEnrichment || requiresOcrForCompleteness;

  if (!shouldAttemptOcr && visionLooksUsable && copyrightFieldsSufficient && originalVisionOutput) {
    const crossValidatedVisionOutput = crossValidateVisionSubjectFromRawText(originalVisionOutput);
    const enrichedVisionOutput = backfillMissingHighValueFields(crossValidatedVisionOutput, crossValidatedVisionOutput.rawText);
    const parsedFields = summarizeMetadataFields(enrichedVisionOutput);
    updateMetadataPipelineRuntimeStatus({
      stage: "completed",
      path: "vision_only",
      parsedFieldsCount: parsedFields.length,
      parsedFields,
      missingCriticalFields: collectMissingFields(enrichedVisionOutput, TITLE_CRITICAL_FIELDS),
      missingTargetFields: collectMissingFields(enrichedVisionOutput, TITLE_TARGET_DEBUG_FIELDS),
    });
    void emitMetadataPipelineDiagnostic("completed", {
      traceId,
      context: {
        path: "vision_only",
        confidence: enrichedVisionOutput.confidence,
        subject: enrichedVisionOutput.subject,
      },
    });
    emitTrace({
      step: context.pageType,
      component: "pipeline",
      action: "completed_vision_only",
      details: {
        traceId,
        subject: enrichedVisionOutput.subject,
        parsedFields,
      },
    });
    return {
      result: enrichedVisionOutput,
      originalVisionOutput,
      originalOcrOutput: null,
    };
  }

  void emitMetadataPipelineDiagnostic("fallback_to_ocr", {
    traceId,
    context: {
      reason: originalVisionOutput ? "low_confidence_or_missing_fields" : "vision_failed",
      visionConfidence: originalVisionOutput?.confidence ?? null,
      copyrightFieldsSufficient: originalVisionOutput ? hasCriticalCopyrightFields(originalVisionOutput) : null,
    },
  });
  updateMetadataPipelineRuntimeStatus({
    stage: "fallback_to_ocr",
  });

  const maxOcrAttempts = requiresOcrForCompleteness ? MAX_METADATA_OCR_ATTEMPTS : 1;
  let ocrAttemptCount = 0;
  let lastOcrError: Error | null = null;
  let bestResult: MetadataResult | null = null;
  let bestOriginalOcrOutput: OcrMetadataOutput | null = null;

  while (ocrAttemptCount < maxOcrAttempts) {
    ocrAttemptCount += 1;
    let ocrResult: Awaited<ReturnType<typeof extractTextFromImageWithFallback>>;
    try {
      emitTrace({
        step: context.pageType,
        component: "ocr",
        action: "request_started",
        details: {
          traceId,
          attempt: ocrAttemptCount,
          maxAttempts: maxOcrAttempts,
        },
      });
      ocrResult = await extractTextFromImageWithFallback(imageDataUrl);
      if (!ocrResult || typeof ocrResult.text !== "string" || typeof ocrResult.providerId !== "string") {
        throw new Error("OCR enrichment returned an invalid response payload.");
      }
    } catch (error) {
      lastOcrError = error instanceof Error ? error : new Error(String(error));
      void emitMetadataPipelineDiagnostic("ocr_pass_failed", {
        level: "warning",
        traceId,
        context: {
          attempt: ocrAttemptCount,
          maxAttempts: maxOcrAttempts,
          pageType: context.pageType,
          message: lastOcrError.message,
        },
      });
      emitTrace({
        step: context.pageType,
        component: "ocr",
        action: "request_failed",
        severity: "warning",
        details: {
          traceId,
          attempt: ocrAttemptCount,
          maxAttempts: maxOcrAttempts,
          message: lastOcrError.message,
        },
      });
      continue;
    }

    updateMetadataPipelineRuntimeStatus({
      stage: "ocr_succeeded",
      ocr: {
        providerId: ocrResult.providerId,
        rawTextLength: ocrResult.text.length,
        attemptCount: ocrAttemptCount,
        maxAttempts: maxOcrAttempts,
      },
    });
    void emitMetadataPipelineDiagnostic("ocr_fallback_succeeded", {
      traceId,
      context: {
        attempt: ocrAttemptCount,
        maxAttempts: maxOcrAttempts,
        ocrProviderId: ocrResult.providerId,
        rawTextLength: ocrResult.text.length,
      },
    });
    emitTrace({
      step: context.pageType,
      component: "ocr",
      action: "request_succeeded",
      details: {
        traceId,
        attempt: ocrAttemptCount,
        providerId: ocrResult.providerId,
        rawTextLength: ocrResult.text.length,
      },
    });

    const correctedRawText = postProcessOcrText(ocrResult.text, context);
    const ocrMetadata = backfillMissingHighValueFields(autoMetadataToMetadataResult(correctedRawText, "ocr"), correctedRawText);
    const candidateResult = originalVisionOutput
      ? mergeVisionAndOcrMetadata(originalVisionOutput, ocrMetadata, ocrResult.text)
      : ocrMetadata;

    if (!bestResult || metadataCoverageScore(candidateResult) >= metadataCoverageScore(bestResult)) {
      bestResult = candidateResult;
      bestOriginalOcrOutput = {
        rawText: ocrResult.text,
        providerId: ocrResult.providerId,
      };
    }

    emitTrace({
      step: context.pageType,
      component: "mapping",
      action: "field_mapping_completed",
      details: {
        traceId,
        attempt: ocrAttemptCount,
        subject: candidateResult.subject,
        parsedFields: summarizeMetadataFields(candidateResult),
      },
    });

    const missingCriticalFields = collectMissingFields(candidateResult, TITLE_CRITICAL_FIELDS);
    const missingTargetFields = collectMissingFields(candidateResult, TITLE_TARGET_DEBUG_FIELDS);

    updateMetadataPipelineRuntimeStatus({
      missingCriticalFields,
      missingTargetFields,
      ocr: {
        providerId: ocrResult.providerId,
        rawTextLength: ocrResult.text.length,
        attemptCount: ocrAttemptCount,
        maxAttempts: maxOcrAttempts,
      },
    });

    void emitMetadataPipelineDiagnostic("ocr_pass_completed", {
      traceId,
      context: {
        attempt: ocrAttemptCount,
        maxAttempts: maxOcrAttempts,
        missingCriticalFields,
        missingTargetFields,
      },
    });

    if (!requiresOcrForCompleteness || missingCriticalFields.length === 0) {
      break;
    }
  }

  if (!bestResult) {
    if (shouldForceOcrEnrichment && originalVisionOutput && visionLooksUsable) {
      const crossValidatedVisionOutput = crossValidateVisionSubjectFromRawText(originalVisionOutput);
      const enrichedVisionOutput = backfillMissingHighValueFields(crossValidatedVisionOutput, crossValidatedVisionOutput.rawText);
      const parsedFields = summarizeMetadataFields(enrichedVisionOutput);
      updateMetadataPipelineRuntimeStatus({
        stage: "completed",
        path: "vision_only",
        parsedFieldsCount: parsedFields.length,
        parsedFields,
        ocr: {
          providerId: null,
          rawTextLength: 0,
          attemptCount: ocrAttemptCount,
          maxAttempts: maxOcrAttempts,
        },
        missingCriticalFields: collectMissingFields(enrichedVisionOutput, TITLE_CRITICAL_FIELDS),
        missingTargetFields: collectMissingFields(enrichedVisionOutput, TITLE_TARGET_DEBUG_FIELDS),
      });
      void emitMetadataPipelineDiagnostic("ocr_enrichment_failed_using_vision", {
        level: "warning",
        traceId,
        context: {
          pageType: context.pageType,
          attempts: ocrAttemptCount,
          message: lastOcrError?.message ?? "All OCR attempts failed.",
        },
      });
      emitTrace({
        step: context.pageType,
        component: "pipeline",
        action: "completed_with_vision_after_ocr_failure",
        severity: "warning",
        details: {
          traceId,
          attempts: ocrAttemptCount,
          message: lastOcrError?.message ?? "All OCR attempts failed.",
        },
      });

      return {
        result: enrichedVisionOutput,
        originalVisionOutput,
        originalOcrOutput: null,
      };
    }

    throw lastOcrError ?? new Error("OCR extraction failed after all attempts.");
  }

  const finalMissingCriticalFields = collectMissingFields(bestResult, TITLE_CRITICAL_FIELDS);
  const finalMissingTargetFields = collectMissingFields(bestResult, TITLE_TARGET_DEBUG_FIELDS);
  const bestPath: MetadataPipelineRuntimeStatus["path"] = originalVisionOutput ? "vision_ocr_merged" : "ocr_only";
  const parsedFields = summarizeMetadataFields(bestResult);

  if (finalMissingCriticalFields.length > 0) {
    const failureSnapshot = buildMetadataFailureSnapshot(bestResult, bestOriginalOcrOutput?.rawText ?? "", imageDataUrl);
    void emitMetadataPipelineDiagnostic("ocr_max_attempts_reached", {
      level: "warning",
      traceId,
      context: {
        pageType: context.pageType,
        attempts: ocrAttemptCount,
        maxAttempts: maxOcrAttempts,
        missingCriticalFields: finalMissingCriticalFields,
        missingTargetFields: finalMissingTargetFields,
        failureSnapshot,
      },
    });
    emitTrace({
      step: context.pageType,
      component: "pipeline",
      action: "critical_fields_missing_after_attempts",
      severity: "warning",
      details: {
        traceId,
        missingCriticalFields: finalMissingCriticalFields,
        missingTargetFields: finalMissingTargetFields,
      },
    });
  }

  updateMetadataPipelineRuntimeStatus({
    stage: "completed",
    path: bestPath,
    parsedFieldsCount: parsedFields.length,
    parsedFields,
    missingCriticalFields: finalMissingCriticalFields,
    missingTargetFields: finalMissingTargetFields,
    ocr: {
      providerId: bestOriginalOcrOutput?.providerId ?? null,
      rawTextLength: bestOriginalOcrOutput?.rawText.length ?? 0,
      attemptCount: ocrAttemptCount,
      maxAttempts: maxOcrAttempts,
    },
  });

  void emitMetadataPipelineDiagnostic("completed", {
    traceId,
    context: {
      path: bestPath,
      ocrProviderId: bestOriginalOcrOutput?.providerId ?? null,
      mergedConfidence: bestResult.confidence,
      visionConfidence: originalVisionOutput?.confidence ?? null,
      ocrAttempts: ocrAttemptCount,
      maxOcrAttempts: maxOcrAttempts,
      missingCriticalFields: finalMissingCriticalFields,
    },
  });

  emitTrace({
    step: context.pageType,
    component: "pipeline",
    action: "completed",
    details: {
      traceId,
      path: bestPath,
      ocrAttempts: ocrAttemptCount,
      parsedFields,
      missingCriticalFields: finalMissingCriticalFields,
    },
  });

  return {
    result: bestResult,
    originalVisionOutput,
    originalOcrOutput: bestOriginalOcrOutput,
  };
}

export async function extractMetadataWithOcrFallback(
  imageBuffer: ArrayBuffer | Uint8Array,
  context: MetadataExtractionContext,
  options: MetadataPipelineExtractionOptions = {}
): Promise<MetadataPipelineResult> {
  const imageDataUrl = imageBufferToDataUrl(imageBuffer);
  return extractMetadataWithOcrFallbackFromDataUrl(imageDataUrl, context, options);
}

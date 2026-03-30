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
const METADATA_PIPELINE_RUNTIME_STATUS_KEY = "courseforge.metadataPipeline.runtime.v1";

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
  };
  parsedFieldsCount: number;
  parsedFields: string[];
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
  },
  parsedFieldsCount: 0,
  parsedFields: [],
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
  if (!visionSubject) return ocrSubject;
  const lower = ocrRawText.toLowerCase();
  const hasStrongScienceKeywords = /physical science|earth science|life science|biology|chemistry|physics|anatomy|geology/.test(lower);
  const visionIsScienceCategory = /science/i.test(visionSubject);
  if (hasStrongScienceKeywords && !visionIsScienceCategory) {
    // OCR text clearly indicates a science subject — trust OCR subject over vision's guess
    return ocrSubject ?? visionSubject;
  }
  return visionSubject;
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
  options: { confidenceThreshold?: number } = {}
): Promise<MetadataPipelineResult> {
  const traceId = createMetadataPipelineTraceId();
  const confidenceThreshold = clampConfidence(options.confidenceThreshold, DEFAULT_VISION_CONFIDENCE_THRESHOLD);

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
    },
    parsedFieldsCount: 0,
    parsedFields: [],
  });

  let originalVisionOutput: MetadataResult | null = null;
  try {
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
  }

  const visionLooksUsable = Boolean(
    originalVisionOutput
    && originalVisionOutput.confidence >= confidenceThreshold
    && metadataHasRequiredFields(originalVisionOutput)
  );
  const copyrightFieldsSufficient = originalVisionOutput
    ? !isCopyrightLikePage(originalVisionOutput, context) || hasCriticalCopyrightFields(originalVisionOutput)
    : false;

  if (visionLooksUsable && copyrightFieldsSufficient && originalVisionOutput) {
    const crossValidatedVisionOutput = crossValidateVisionSubjectFromRawText(originalVisionOutput);
    const parsedFields = summarizeMetadataFields(crossValidatedVisionOutput);
    updateMetadataPipelineRuntimeStatus({
      stage: "completed",
      path: "vision_only",
      parsedFieldsCount: parsedFields.length,
      parsedFields,
    });
    void emitMetadataPipelineDiagnostic("completed", {
      traceId,
      context: {
        path: "vision_only",
        confidence: crossValidatedVisionOutput.confidence,
        subject: crossValidatedVisionOutput.subject,
      },
    });
    return {
      result: crossValidatedVisionOutput,
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

  const ocrResult = await extractTextFromImageWithFallback(imageDataUrl);
  updateMetadataPipelineRuntimeStatus({
    stage: "ocr_succeeded",
    ocr: {
      providerId: ocrResult.providerId,
      rawTextLength: ocrResult.text.length,
    },
  });
  void emitMetadataPipelineDiagnostic("ocr_fallback_succeeded", {
    traceId,
    context: {
      ocrProviderId: ocrResult.providerId,
      rawTextLength: ocrResult.text.length,
    },
  });
  const correctedRawText = postProcessOcrText(ocrResult.text, context);
  const ocrMetadata = autoMetadataToMetadataResult(correctedRawText, "ocr");

  if (!originalVisionOutput) {
    const parsedFields = summarizeMetadataFields(ocrMetadata);
    updateMetadataPipelineRuntimeStatus({
      stage: "completed",
      path: "ocr_only",
      parsedFieldsCount: parsedFields.length,
      parsedFields,
    });
    void emitMetadataPipelineDiagnostic("completed", {
      traceId,
      context: {
        path: "ocr_only",
        ocrProviderId: ocrResult.providerId,
      },
    });
    return {
      result: ocrMetadata,
      originalVisionOutput: null,
      originalOcrOutput: {
        rawText: ocrResult.text,
        providerId: ocrResult.providerId,
      },
    };
  }

  const merged: MetadataResult = {
    title: originalVisionOutput.title ?? ocrMetadata.title,
    subtitle: originalVisionOutput.subtitle ?? ocrMetadata.subtitle,
    edition: originalVisionOutput.edition ?? ocrMetadata.edition,
    publisher: originalVisionOutput.publisher ?? ocrMetadata.publisher,
    publisherLocation: originalVisionOutput.publisherLocation ?? ocrMetadata.publisherLocation,
    series: originalVisionOutput.series ?? ocrMetadata.series,
    gradeLevel: originalVisionOutput.gradeLevel ?? ocrMetadata.gradeLevel,
    subject: crossValidateSubject(originalVisionOutput.subject, ocrResult.text, ocrMetadata.subject),
    copyrightYear: originalVisionOutput.copyrightYear ?? ocrMetadata.copyrightYear,
    isbn: originalVisionOutput.isbn ?? ocrMetadata.isbn,
    additionalIsbns: Array.from(new Set([...(originalVisionOutput.additionalIsbns ?? []), ...(ocrMetadata.additionalIsbns ?? [])])),
    relatedIsbns: Array.from(new Map([...(originalVisionOutput.relatedIsbns ?? []), ...(ocrMetadata.relatedIsbns ?? [])].map((entry) => [`${entry.type}:${entry.isbn}`, entry])).values()),
    platformUrl: originalVisionOutput.platformUrl ?? ocrMetadata.platformUrl,
    mhid: originalVisionOutput.mhid ?? ocrMetadata.mhid,
    confidence: Math.max(ocrMetadata.confidence, originalVisionOutput.confidence),
    rawText: [originalVisionOutput.rawText, correctedRawText].filter(Boolean).join("\n\n").trim(),
    source: "vision+ocr",
  };
  const parsedFields = summarizeMetadataFields(merged);
  updateMetadataPipelineRuntimeStatus({
    stage: "completed",
    path: "vision_ocr_merged",
    parsedFieldsCount: parsedFields.length,
    parsedFields,
  });

  void emitMetadataPipelineDiagnostic("completed", {
    traceId,
    context: {
      path: "vision_ocr_merged",
      ocrProviderId: ocrResult.providerId,
      mergedConfidence: merged.confidence,
      visionConfidence: originalVisionOutput.confidence,
    },
  });

  return {
    result: merged,
    originalVisionOutput,
    originalOcrOutput: {
      rawText: ocrResult.text,
      providerId: ocrResult.providerId,
    },
  };
}

export async function extractMetadataWithOcrFallback(
  imageBuffer: ArrayBuffer | Uint8Array,
  context: MetadataExtractionContext,
  options: { confidenceThreshold?: number } = {}
): Promise<MetadataPipelineResult> {
  const imageDataUrl = imageBufferToDataUrl(imageBuffer);
  return extractMetadataWithOcrFallbackFromDataUrl(imageDataUrl, context, options);
}

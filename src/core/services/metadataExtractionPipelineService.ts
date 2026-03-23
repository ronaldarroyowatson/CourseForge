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
import { extractMetadataFromOcrText, preprocessMetadataOcrText } from "./textbookAutoExtractionService";

const DEFAULT_VISION_CONFIDENCE_THRESHOLD = 0.72;

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

function normalizeMetadataResult(input: Partial<MetadataResult> & Pick<MetadataResult, "source">): MetadataResult {
  return {
    title: normalizeTextValue(input.title),
    subtitle: normalizeTextValue(input.subtitle),
    edition: normalizeTextValue(input.edition),
    publisher: normalizeTextValue(input.publisher),
    publisherLocation: normalizeTextValue(input.publisherLocation),
    series: normalizeTextValue(input.series),
    gradeLevel: normalizeTextValue(input.gradeLevel),
    subject: normalizeTextValue(input.subject),
    copyrightYear: typeof input.copyrightYear === "number" && Number.isInteger(input.copyrightYear) ? input.copyrightYear : null,
    isbn: normalizeTextValue(input.isbn),
    additionalIsbns: Array.isArray(input.additionalIsbns)
      ? input.additionalIsbns.map((value) => normalizeTextValue(value)).filter((value): value is string => Boolean(value))
      : undefined,
    relatedIsbns: Array.isArray(input.relatedIsbns)
      ? input.relatedIsbns
          .filter((entry): entry is RelatedIsbn => Boolean(entry) && typeof entry.isbn === "string" && typeof entry.type === "string")
          .map((entry) => ({ isbn: entry.isbn.trim(), type: entry.type, note: normalizeTextValue(entry.note) ?? undefined }))
      : undefined,
    platformUrl: normalizeTextValue(input.platformUrl),
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
  const cleaned = preprocessMetadataOcrText(rawText);
  const deduped = removeRepeatedAdjacentWords(cleaned);
  const normalized = normalizeWhitespace(deduped);
  return applyCorrectionRulesToText(normalized, getEffectiveCorrectionRules(), {
    publisher: context.publisherHint,
  });
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

  let originalVisionOutput: MetadataResult | null = null;
  try {
    void emitMetadataPipelineDiagnostic("vision_attempt_started", {
      traceId,
      context: { pageType: context.pageType },
    });
    originalVisionOutput = await extractMetadataFromImageDataUrl(imageDataUrl, context);
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
    void emitMetadataPipelineDiagnostic("vision_attempt_failed", {
      level: "warning",
      traceId,
      context: { pageType: context.pageType },
    });
  }

  if (originalVisionOutput && originalVisionOutput.confidence >= confidenceThreshold && metadataHasRequiredFields(originalVisionOutput)) {
    void emitMetadataPipelineDiagnostic("completed", {
      traceId,
      context: {
        path: "vision_only",
        confidence: originalVisionOutput.confidence,
      },
    });
    return {
      result: originalVisionOutput,
      originalVisionOutput,
      originalOcrOutput: null,
    };
  }

  void emitMetadataPipelineDiagnostic("fallback_to_ocr", {
    traceId,
    context: {
      reason: originalVisionOutput ? "low_confidence_or_missing_fields" : "vision_failed",
      visionConfidence: originalVisionOutput?.confidence ?? null,
    },
  });

  const ocrResult = await extractTextFromImageWithFallback(imageDataUrl);
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
    subject: originalVisionOutput.subject ?? ocrMetadata.subject,
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

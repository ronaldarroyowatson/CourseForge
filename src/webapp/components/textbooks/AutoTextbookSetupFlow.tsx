import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter, RelatedIsbn, RelatedIsbnType, Section, Textbook } from "../../../core/models";

import {
  type AutoConflictResolutionMode,
  buildAutoConflictResolutionPlan,
} from "../../../core/services/autoTextbookConflictService";
import { extractTextFromImageWithFallback, getAutoOcrCooldownExpiryMs, type AutoOcrProviderId } from "../../../core/services/autoOcrService";
import { getBrowserOcrSettingsManager } from "../../../core/services/ocrSettingsService";
import { RateLimitCooldownBadge } from "../shared/RateLimitCooldownBadge";
import { appendDebugLogEntry } from "../../../core/services";
import { persistAutoTextbook } from "../../../core/services/autoTextbookPersistenceService";
import { uploadTextbookCoverFromDataUrl, uploadTextbookOwnershipProofFromDataUrl } from "../../../core/services/coverImageService";
import {
  AUTO_MODE_SCOPE_MESSAGE,
  createInitialAutoCaptureUsage,
  DEFAULT_AUTO_CAPTURE_LIMITS,
  detectPageBoundaryFromRgba,
  detectTwoColumnTocRegionFromRgba,
  enforceAutoCaptureLimit,
  assessImageModerationSignal,
  evaluateAutoCaptureSafety,
  extractMetadataFromOcrText,
  isLikelyTocText,
  mergeAutoMetadata,
  parseTocFromOcrText,
  preprocessMetadataOcrText,
  scoreMetadataConfidence,
  stitchTocPages,
  type AutoMetadataConfidenceMap,
  type AutoMetadataFieldKey,
  type AutoTextbookMetadata,
  type ImageModerationAssessment,
  type ParsedTocResult,
  type TocPage,
  type TocChapter,
} from "../../../core/services/textbookAutoExtractionService";
import {
  applyCorrectionRulesToText,
  didMetadataChange,
  getEffectiveCorrectionRules,
  isMetadataCorrectionSharingEnabled,
  saveCorrectionRecord,
  type MetadataResult,
} from "../../../core/services/metadataCorrectionLearningService";
import {
  clearAutoExtractionCheckpoints,
  deleteAutoExtractionCheckpoint,
  getExtractionContentOrder,
  resolveSubjectPriority,
  saveAutoExtractionCheckpoint,
  shouldPauseAutoExtraction,
  type AutoExtractionCheckpoint,
} from "../../../core/services/autoExtractionOrchestrationService";
import {
  clearGuidedCue,
  createEmptyGuidedCaptureCuePlan,
  getGuidedCueCompletion,
  getGuidedCueLabel,
  getMissingGuidedCuesForAutomation,
  markGuidedCue,
  type GuidedCaptureCuePlan,
  type GuidedCueType,
} from "../../../core/services/guidedCaptureCueService";
import {
  extractMetadataWithOcrFallbackFromDataUrl,
  type MetadataPipelineResult,
} from "../../../core/services/metadataExtractionPipelineService";
import { normalizeISBN } from "../../../core/services/isbnService";
import { syncMetadataCorrectionLearning } from "../../../core/services/metadataCorrectionSyncService";
import { syncNow } from "../../../core/services/syncService";
import { TocPreviewTree } from "./tocPreview/TocPreviewTree";
import type { TocPreviewNodeModel } from "./tocPreview/PageRangeCalculator";
import { useRepositories } from "../../hooks/useRepositories";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";
import { t as translate } from "../../../core/services/i18nService";
import {
  captureDisplayFrame,
  getDisplayCaptureSupportInfo,
  normalizeDisplayCaptureError,
  resetDisplayCaptureSession,
} from "../../utils/displayCapture";
import { stitchCueImagesWithOverlap } from "../../utils/cueImageStitch";
import { isLikelyCourseForgeSelfCapture } from "../../utils/liveCueCapture";
import { mergeOcrTextWithOverlap } from "../../utils/ocrTextMerge";
import { isChromeOSRuntime, isSmallChromebookViewport } from "../../utils/platform";
import { executeGuiCliBoundCommand } from "../../../core/services/guiCliParityService";
import { getCurrentUser } from "../../../firebase/auth";
import { emitClientDebugTrace } from "../../../core/services/clientDebugTraceService";

type AutoFlowStep = "cover" | "title" | "toc" | "toc-editor";
type OcrBufferStep = "cover" | "title" | "toc";
type OcrStepBuffers = Record<OcrBufferStep, { raw: string; draft: string }>;
type TocPreviewExpansionMode = "default" | "collapse-all" | "expand-latest";
type AutoPrimaryHelperAction =
  | "capture-cover"
  | "upload-cover"
  | "capture-title"
  | "upload-title"
  | "capture-toc"
  | "finish-toc"
  | "switch-manual";
type MetadataTileKey =
  | "title"
  | "subtitle"
  | "grade"
  | "gradeBand"
  | "subject"
  | "edition"
  | "publicationYear"
  | "copyrightYear"
  | "isbnRaw"
  | "additionalIsbnsCsv"
  | "relatedIsbns"
  | "authorsCsv"
  | "publisher"
  | "publisherLocation"
  | "platformUrl"
  | "mhid"
  | "seriesName";

const AUTO_HELPER_HOVER_DELAY_MS = 480;
const AUTO_HELPER_FOCUS_DELAY_MS = 640;
const AUTO_HELPER_POINTER_OFFSET_X = 6;
const AUTO_HELPER_POINTER_OFFSET_Y = 8;
const AUTO_HELPER_FOCUS_OFFSET_Y = 6;
const HIGH_CONFIDENCE_THRESHOLD = 0.8;

const COVER_PRIMARY_TILE_FIELDS: MetadataTileKey[] = ["title", "subtitle", "subject", "seriesName", "publisher"];
const COVER_EXTRA_COMPACT_TILE_FIELDS: MetadataTileKey[] = ["grade", "gradeBand", "edition"];
const COVER_NANO_COMPACT_TILE_FIELDS: MetadataTileKey[] = ["grade", "mhid", "isbnRaw"];
const METADATA_TILE_FIELD_ORDER: MetadataTileKey[] = [
  "title",
  "subtitle",
  "grade",
  "gradeBand",
  "subject",
  "edition",
  "publicationYear",
  "copyrightYear",
  "isbnRaw",
  "additionalIsbnsCsv",
  "relatedIsbns",
  "authorsCsv",
  "publisher",
  "publisherLocation",
  "platformUrl",
  "mhid",
  "seriesName",
];
const METADATA_TILE_LABELS: Record<MetadataTileKey, string> = {
  title: "Title",
  subtitle: "Subtitle",
  grade: "Grade",
  gradeBand: "Grade Band",
  subject: "Subject",
  edition: "Edition",
  publicationYear: "Publication Year",
  copyrightYear: "Copyright Year",
  isbnRaw: "ISBN",
  additionalIsbnsCsv: "Additional ISBNs",
  relatedIsbns: "Related ISBNs",
  authorsCsv: "Authors",
  publisher: "Publisher",
  publisherLocation: "Publisher Location",
  platformUrl: "Publisher URL",
  mhid: "MHID",
  seriesName: "Series Name",
};

const RELATED_ISBN_TYPES: RelatedIsbnType[] = ["student", "teacher", "digital", "workbook", "assessment", "other"];
const IMMEDIATE_UPLOAD_SYNC_TIMEOUT_MS = 4500;
const IMMEDIATE_UPLOAD_SYNC_RETRY_DELAY_MS = 5500;
const TOC_SAMPLE_TARGET_COUNT = 5;
const TOC_SAMPLE_MAX_COUNT = 10;
const TOC_SAMPLE_GAP_MS = 250;
const TOC_SAMPLE_GOOD_CONFIDENCE = 0.94;
const TOC_RESCUE_PROVIDER_ORDER: AutoOcrProviderId[] = ["cloud_openai_vision", "cloud_github_models_vision", "local_tesseract"];

async function getTocOcrRuntimeOptions(): Promise<{
  providerOrder: AutoOcrProviderId[];
  preferPrimaryCloudWait: boolean;
  waitForPrimaryCloudCooldownMs: number;
  maxPrimaryCloudWaitMs: number;
}> {
  const manager = await getBrowserOcrSettingsManager();
  const runtime = await manager.getRuntimeOptions();
  return {
    providerOrder: runtime.providerOrder as AutoOcrProviderId[],
    preferPrimaryCloudWait: runtime.preferPrimaryCloudWait,
    waitForPrimaryCloudCooldownMs: runtime.waitForPrimaryCloudCooldownMs,
    maxPrimaryCloudWaitMs: runtime.maxPrimaryCloudWaitMs,
  };
}

function toOcrBufferStep(step: AutoFlowStep): OcrBufferStep {
  return step === "toc-editor" ? "toc" : step;
}

function isLikelyStretchGarbageToken(token: string): boolean {
  const cleaned = token.replace(/[^A-Za-z]/g, "");
  if (cleaned.length < 6) {
    return false;
  }

  if (/(.)\1{4,}/i.test(cleaned)) {
    return true;
  }

  const vowels = cleaned.match(/[aeiou]/gi)?.length ?? 0;
  return vowels <= 1;
}

function sanitizeTocDraftText(rawText: string): string {
  const structuralPattern = /^(?:unit|module|chapter|ch\.?|lesson)\b|^[0-9]+(?:\.[0-9]+)+\s+|\.{2,}\s*\d+\s*$/i;
  const headingWhitelist = /\b(?:science|forces|motion|newton|claim|evidence|reasoning|standards|measurement|module|unit|chapter|lesson|phenomenon|society|altitudes)\b/i;
  const chromeNoisePattern = /\b(?:teacher\s+edition|return\s+to\s+double[-\s]?page\s+view|double[-\s]?page\s+view|stop\s+sharing|sharing\b|zoom\b|\d{1,3}%|localhost:\d+|m\.mheducation\.com|edge\b|favorites\b|profiles\b|tab\b|window\b)\b/i;

  return rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => {
      if (chromeNoisePattern.test(line)) {
        return false;
      }

      const compact = line.replace(/\s+/g, "");
      const letters = line.match(/[A-Za-z]/g)?.length ?? 0;
      const symbols = line.match(/[^A-Za-z0-9\s.,:;()'\-–/&]/g)?.length ?? 0;
      const noiseRatio = symbols / Math.max(1, compact.length);
      const gibberishTokenCount = line
        .split(/\s+/)
        .filter((token) => /[A-Za-z]{4,}/.test(token))
        .filter((token) => {
          if (isLikelyStretchGarbageToken(token)) {
            return true;
          }
          const vowels = token.match(/[aeiou]/gi)?.length ?? 0;
          return vowels <= 1 && !headingWhitelist.test(token);
        }).length;

      if (structuralPattern.test(line)) {
        return true;
      }

      if (letters < 3) {
        return false;
      }

      if (noiseRatio >= 0.2) {
        return false;
      }

      if (/\b(?:x|xx|x\?)\s*$/i.test(line) && !/\b(?:module|chapter|lesson)\b/i.test(line)) {
        return false;
      }

      if (gibberishTokenCount >= 2) {
        return false;
      }

      if (line.length < 6 && !/\d/.test(line)) {
        return false;
      }

      return true;
    })
    .join("\n");
}

function computeCaptureFingerprint(imageDataUrl: string): string {
  const commaIndex = imageDataUrl.indexOf(",");
  const payload = commaIndex >= 0 ? imageDataUrl.slice(commaIndex + 1) : imageDataUrl;
  const length = payload.length;
  const quarter = Math.floor(length / 4);
  const half = Math.floor(length / 2);
  const sample = `${payload.slice(0, 512)}|${payload.slice(Math.max(0, quarter - 128), quarter + 128)}|${payload.slice(Math.max(0, half - 128), half + 128)}|${payload.slice(Math.max(0, length - 512))}`;

  let hash = 2166136261;
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${length}-${(hash >>> 0).toString(16)}`;
}

function waitForOcrGap(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

function scoreTocNoise(rawText: string): number {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return 1;
  }

  const tocSignalCount = lines.filter((line) => /^(?:unit|module|chapter|ch\.?|lesson)\b|^[0-9]+(?:\.[0-9]+)+\s+|\.{2,}\s*\d+\s*$/i.test(line)).length;
  const suspiciousCount = lines.filter((line) => {
    const symbols = line.match(/[^A-Za-z0-9\s.,:;()'\-–/&]/g)?.length ?? 0;
    const compactLength = Math.max(1, line.replace(/\s+/g, "").length);
    const symbolRatio = symbols / compactLength;
    const noiseTokens = line
      .split(/\s+/)
      .filter((token) => /[A-Za-z]{4,}/.test(token))
      .filter((token) => {
        const vowels = token.match(/[aeiou]/gi)?.length ?? 0;
        return vowels <= 1;
      }).length;
    return symbolRatio >= 0.2 || noiseTokens >= 2;
  }).length;

  const structuralPenalty = tocSignalCount > 0 ? 0 : 0.35;
  return Math.min(1, (suspiciousCount / lines.length) + structuralPenalty);
}

function scoreTocAnchorSignals(rawText: string): number {
  const normalized = rawText.replace(/\r/g, "\n").toLowerCase();
  let score = 0;

  if (/\bunit\s+[0-9ivx]+\b/.test(normalized)) {
    score += 1;
  }

  if (/\bmodule\s+1\b/.test(normalized)) {
    score += 1;
  }

  if (/\bmodule\s+2\b/.test(normalized)) {
    score += 1;
  }

  if (/\bmodule\s+3\b/.test(normalized)) {
    score += 1;
  }

  if (/\b(?:sep\s+go\s+further|stem\s+unit\s+[0-9]+\s+project|module\s+wrap\s*[-–—]?\s*up)\b/.test(normalized)) {
    score += 1;
  }

  return score;
}

function hasImmediateTocGarbageSignals(rawText: string): boolean {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return true;
  }

  const structuralPattern = /^(?:unit|module|chapter|ch\.?|lesson)\b|^[0-9]+(?:\.[0-9]+)+\s+|\.{2,}\s*\d+\s*$/i;
  const headingWhitelist = /\b(?:science|forces|motion|newton|claim|evidence|reasoning|standards|measurement|module|unit|chapter|lesson|phenomenon|society|altitudes|analysis|wrap|project)\b/i;
  const chromeNoisePattern = /\b(?:teacher\s+edition|return\s+to\s+double[-\s]?page\s+view|double[-\s]?page\s+view|stop\s+sharing|sharing\b|zoom\b|\d{1,3}%|localhost:\d+|m\.mheducation\.com|edge\b|favorites\b|profiles\b|tab\b|window\b)\b/i;
  const hudNoisePattern = /\b(?:encounter\s+the\s+phenomenon|unit\s+\d+\s*project|engineering\s*&\s*technology|resources|edit\b|regenerate\s+from\s+image)\b/i;

  return lines.some((line) => {
    if (structuralPattern.test(line)) {
      return false;
    }

    if (chromeNoisePattern.test(line)) {
      return true;
    }

    if (hudNoisePattern.test(line) && !/\.\.+\s*\d+\s*$/i.test(line)) {
      return true;
    }

    if (/[#@%$^*_=+~`]{3,}/.test(line)) {
      return true;
    }

    const compact = line.replace(/\s+/g, "");
    const symbols = line.match(/[^A-Za-z0-9\s.,:;()'\-–/&]/g)?.length ?? 0;
    const symbolRatio = symbols / Math.max(1, compact.length);
    if (symbolRatio >= 0.16) {
      return true;
    }

    const gibberishWords = line
      .split(/\s+/)
      .filter((token) => /[A-Za-z]{4,}/.test(token))
      .filter((token) => {
        if (isLikelyStretchGarbageToken(token)) {
          return true;
        }
        if (headingWhitelist.test(token)) {
          return false;
        }
        const vowels = token.match(/[aeiou]/gi)?.length ?? 0;
        return vowels <= 1;
      }).length;

    if (/\b(?:x|xx|x\?)\s*$/i.test(line) && !/\b(?:lesson|module|chapter)\b/i.test(line)) {
      return true;
    }

    if (line.split(/\s+/).some((token) => isLikelyStretchGarbageToken(token))) {
      return true;
    }

    return gibberishWords >= 2;
  });
}

function parseRomanNumeral(value: string): number | null {
  const roman = value.trim().toUpperCase();
  if (!/^[IVXLCDM]+$/.test(roman)) {
    return null;
  }

  const romanMap: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };

  let total = 0;
  let previous = 0;
  for (let index = roman.length - 1; index >= 0; index -= 1) {
    const current = romanMap[roman[index]];
    if (!current) {
      return null;
    }

    if (current < previous) {
      total -= current;
    } else {
      total += current;
      previous = current;
    }
  }

  return total > 0 ? total : null;
}

function parseChapterOrdinalToken(token: string): number | null {
  const normalized = token
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[OQ]/g, "0")
    .replace(/[IL|!]/g, "1")
    .replace(/[S]/g, "5")
    .replace(/[B]/g, "8");

  if (!normalized) {
    return null;
  }

  const digitMatch = normalized.match(/[0-9]+/);
  if (digitMatch) {
    const parsed = Number.parseInt(digitMatch[0], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return parseRomanNumeral(normalized);
}

function extractChapterHeadingOrdinals(rawText: string): number[] {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const headingOrdinals = new Set<number>();
  for (const line of lines) {
    const matches = line.matchAll(/(?:^|\s)(?:module|chapter|unit)\s+([A-Za-z0-9+|!]+)/gi);
    for (const match of matches) {
      const parsed = parseChapterOrdinalToken(match[1]);
      if (typeof parsed === "number") {
        headingOrdinals.add(parsed);
      }
    }
  }

  return Array.from(headingOrdinals).sort((left, right) => left - right);
}

function scoreTocLineQuality(line: string): number {
  const trimmed = line.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return -1;
  }

  const structuralSignal = /^(?:unit|module|chapter|ch\.?|lesson)\b|^[0-9]+(?:\.[0-9]+)+\s+|\.{2,}\s*\d+\s*$/i.test(trimmed) ? 0.5 : 0;
  const symbolCount = trimmed.match(/[^A-Za-z0-9\s.,:;()'\-–/&]/g)?.length ?? 0;
  const symbolRatio = symbolCount / Math.max(1, trimmed.replace(/\s+/g, "").length);

  const words = trimmed.split(/\s+/).filter(Boolean);
  const englishLikeWordCount = words
    .filter((word) => /[A-Za-z]{3,}/.test(word))
    .filter((word) => {
      const vowels = word.match(/[aeiou]/gi)?.length ?? 0;
      return vowels >= 1;
    }).length;

  const englishSignal = words.length > 0 ? englishLikeWordCount / words.length : 0;
  return structuralSignal + englishSignal - symbolRatio;
}

function mergeTocTextByLineQuality(baseText: string, candidateText: string): string {
  const baseLines = baseText.replace(/\r/g, "").split("\n");
  const candidateLines = candidateText.replace(/\r/g, "").split("\n");
  const mergedLines: string[] = [];
  const maxLength = Math.max(baseLines.length, candidateLines.length);

  for (let index = 0; index < maxLength; index += 1) {
    const baseLine = (baseLines[index] ?? "").trim();
    const candidateLine = (candidateLines[index] ?? "").trim();

    if (!baseLine && !candidateLine) {
      continue;
    }

    if (!baseLine) {
      mergedLines.push(candidateLine);
      continue;
    }

    if (!candidateLine) {
      mergedLines.push(baseLine);
      continue;
    }

    const baseScore = scoreTocLineQuality(baseLine);
    const candidateScore = scoreTocLineQuality(candidateLine);
    mergedLines.push(candidateScore > baseScore + 0.2 ? candidateLine : baseLine);
  }

  return mergedLines.join("\n");
}

interface AutoTextbookSetupFlowProps {
  runtime?: "webapp" | "extension";
  onSaved: () => void;
  onSwitchToManual: () => void;
  externalNavigationRequest?: {
    token: number;
    direction: "back" | "next";
  } | null;
  onProgressChange?: (progress: {
    currentStep: 1 | 2 | 3 | 4;
    currentLabel: string;
    completed: [boolean, boolean, boolean, boolean];
  }) => void;
  testingSeedState?: {
    step?: AutoFlowStep;
    usage?: { cover: number; title: number; toc: number };
    metadataDraft?: AutoTextbookMetadata;
    metadataConfidence?: AutoMetadataConfidenceMap;
    metadataForm?: Partial<MetadataFormState>;
    coverImageDataUrl?: string | null;
    ownershipProofDataUrl?: string | null;
    ocrDraft?: string;
    tocResult?: ParsedTocResult;
    tocPages?: TocPage[];
    tocCaptureImageDataUrl?: string | null;
    guidedCuePlan?: GuidedCaptureCuePlan;
    bypassImageModeration?: boolean;
  };
}

interface CaptureDialogState {
  open: boolean;
  imageDataUrl: string;
}

interface UploadPreviewState {
  open: boolean;
  step: "cover" | "title";
  imageDataUrl: string;
  ocrText: string;
  ocrProviderId: string;
  editableOcrText: string;
  metadataResult: MetadataResult | null;
  pipelineResult: MetadataPipelineResult | null;
}

interface SaveUploadProgressState {
  visible: boolean;
  percent: number;
  detail: string;
}

interface CaptureResult {
  imageDataUrl: string;
  ocrText: string;
  ocrProviderId: string;
  metadataResult: MetadataResult | null;
  pipelineResult: MetadataPipelineResult | null;
}

function describeMetadataCaptureStep(step: "cover" | "title"): string {
  return step === "cover" ? "Cover" : "Copyright page";
}

interface DuplicateTextbookMatch {
  id: string;
  title: string;
  isbnRaw: string;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MetadataFormState {
  title: string;
  subtitle: string;
  grade: string;
  gradeBand: string;
  subject: string;
  edition: string;
  publicationYear: string;
  copyrightYear: string;
  isbnRaw: string;
  additionalIsbnsCsv: string;
  seriesName: string;
  publisher: string;
  publisherLocation: string;
  platformUrl: string;
  mhid: string;
  authorsCsv: string;
  tocExtractionConfidence: string;
}

const SUBJECTS = [
  "ELA",
  "Math",
  "Science",
  "History",
  "Social Studies",
  "Art",
  "Music",
  "Physical Education",
  "Computer Science",
  "Foreign Language",
  "Other",
];

const INITIAL_TOC_RESULT: ParsedTocResult = {
  chapters: [],
  confidence: 0,
};

const FORM_TO_METADATA_FIELD: Partial<Record<keyof MetadataFormState, AutoMetadataFieldKey>> = {
  title: "title",
  subtitle: "subtitle",
  gradeBand: "gradeBand",
  subject: "subject",
  edition: "edition",
  copyrightYear: "copyrightYear",
  isbnRaw: "isbn",
  additionalIsbnsCsv: "additionalIsbns",
  seriesName: "seriesName",
  publisher: "publisher",
  publisherLocation: "publisherLocation",
  platformUrl: "platformUrl",
  mhid: "mhid",
  authorsCsv: "authors",
};

const KNOWN_TEXTBOOK_DOMAINS = [
  "savvasrealize.com",
  "my.hrw.com",
  "clever.com",
  "pearsonrealize.com",
  "mydigitalpublication.com",
  "mcgrawhill.com",
];

const GUIDED_CUE_TYPES: GuidedCueType[] = ["openToc", "openGlossary", "openChapter", "openSection", "nextPage"];

interface GuidedTraversalTarget {
  chapterIndex: number;
  sectionIndex: number;
  chapterTitle: string;
  sectionTitle: string;
  chapterNumberLabel: string;
  sectionNumberLabel: string;
}

function buildGuidedTraversalTargets(chapters: TocChapter[]): GuidedTraversalTarget[] {
  const targets: GuidedTraversalTarget[] = [];

  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
    const chapter = chapters[chapterIndex];
    if (!chapter) {
      continue;
    }

    const chapterNumberLabel = chapter.chapterNumber?.trim() || String(chapterIndex + 1);
    if (!Array.isArray(chapter.sections) || chapter.sections.length === 0) {
      targets.push({
        chapterIndex,
        sectionIndex: -1,
        chapterTitle: chapter.title || `Chapter ${chapterNumberLabel}`,
        sectionTitle: "Chapter intro",
        chapterNumberLabel,
        sectionNumberLabel: "intro",
      });
      continue;
    }

    for (let sectionIndex = 0; sectionIndex < chapter.sections.length; sectionIndex += 1) {
      const section = chapter.sections[sectionIndex];
      if (!section) {
        continue;
      }

      targets.push({
        chapterIndex,
        sectionIndex,
        chapterTitle: chapter.title || `Chapter ${chapterNumberLabel}`,
        sectionTitle: section.title || `Section ${sectionIndex + 1}`,
        chapterNumberLabel,
        sectionNumberLabel: section.sectionNumber?.trim() || String(sectionIndex + 1),
      });
    }
  }

  return targets;
}

const AUTO_CAPTURE_USAGE_STORAGE_KEY = "courseforge.autoCaptureUsageByDraft";

const OCR_REFUSAL_PATTERNS: RegExp[] = [
  /unable to extract text from images/i,
  /can't extract text from images/i,
  /cannot extract text from images/i,
  /i[\u2019']?m unable to/i,
  /i am unable to/i,
  /i can(?:not|'t) (?:view|read|extract).*(?:image|images)/i,
  /as an ai(?: language model)?[, ]+i can(?:not|'t).*(?:image|images)/i,
  /specific text or content you need help with/i,
  /if you have a different request/i,
  /if you have a specific text/i,
  /feel free to ask/i,
  /feel free to share/i,
];

function isLikelyUnusableOcrText(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return true;
  }

  return OCR_REFUSAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function createDraftCaptureKey(): string {
  return `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readPersistedCaptureUsage(draftKey: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(AUTO_CAPTURE_USAGE_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, { cover: number; title: number; toc: number }>;
    return parsed[draftKey] ?? null;
  } catch {
    return null;
  }
}

function persistCaptureUsage(draftKey: string, usage: { cover: number; title: number; toc: number }): void {
  if (typeof window === "undefined") {
    return;
  }

  const raw = window.localStorage.getItem(AUTO_CAPTURE_USAGE_STORAGE_KEY);
  let parsed: Record<string, { cover: number; title: number; toc: number }> = {};

  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, { cover: number; title: number; toc: number }>;
    } catch {
      parsed = {};
    }
  }

  parsed[draftKey] = usage;

  const keys = Object.keys(parsed);
  if (keys.length > 30) {
    keys.slice(0, keys.length - 30).forEach((key) => {
      delete parsed[key];
    });
  }

  window.localStorage.setItem(AUTO_CAPTURE_USAGE_STORAGE_KEY, JSON.stringify(parsed));
}

function clearPersistedCaptureUsage(draftKey: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const raw = window.localStorage.getItem(AUTO_CAPTURE_USAGE_STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, { cover: number; title: number; toc: number }>;
    delete parsed[draftKey];
    window.localStorage.setItem(AUTO_CAPTURE_USAGE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore malformed storage and keep flow functional.
  }
}

// â”€â”€ Auto Session Draft â€” resumable workflow across page reloads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const AUTO_SESSION_DRAFTS_KEY = "courseforge.autoSessionDrafts.v2";
const AUTO_SESSION_DRAFT_KEY = "courseforge.autoSessionDraft.v1"; // legacy key
const AUTO_SESSION_MAX_AGE_MS = 86_400_000; // 24 hours
const MAX_AUTO_SESSION_DRAFTS = 3;

interface AutoSessionDraft {
  id: string;
  version: 1;
  savedAt: number;
  /** Compact base64 data URL; may be null if cover not yet captured. */
  coverImageDataUrl: string | null;
  /** Compact base64 data URL for the copyright-page ownership proof capture. */
  ownershipProofDataUrl?: string | null;
  /** Original raw OCR text (before any user editing). */
  rawOcrText: string;
  /** Snapshot of key metadata fields so the resume card is informative. */
  metadataTitle: string;
  metadataSubject: string;
  metadataPublisher: string;
  metadataFormSnapshot?: MetadataFormState;
  relatedIsbnsSnapshot?: RelatedIsbn[];
  extractionCheckpoint?: AutoExtractionCheckpoint;
  guidedCuePlan?: GuidedCaptureCuePlan;
  tocCaptureImageDataUrl?: string | null;
  tocResultSnapshot?: ParsedTocResult;
  tocPagesSnapshot?: TocPage[];
  step: AutoFlowStep;
  stepsCompleted: { cover: boolean; copyright: boolean };
}

function isAutoSessionDraft(value: unknown): value is AutoSessionDraft {
  if (!value || typeof value !== "object") {
    return false;
  }

  const draft = value as Partial<AutoSessionDraft>;
  return (
    typeof draft.id === "string"
    && draft.version === 1
    && typeof draft.savedAt === "number"
    && (typeof draft.coverImageDataUrl === "string" || draft.coverImageDataUrl === null)
    && (draft.ownershipProofDataUrl === undefined || typeof draft.ownershipProofDataUrl === "string" || draft.ownershipProofDataUrl === null)
    && typeof draft.rawOcrText === "string"
    && typeof draft.metadataTitle === "string"
    && typeof draft.metadataSubject === "string"
    && typeof draft.metadataPublisher === "string"
    && (draft.metadataFormSnapshot === undefined || typeof draft.metadataFormSnapshot === "object")
    && (draft.relatedIsbnsSnapshot === undefined || Array.isArray(draft.relatedIsbnsSnapshot))
    && (draft.extractionCheckpoint === undefined || typeof draft.extractionCheckpoint === "object")
    && (draft.guidedCuePlan === undefined || typeof draft.guidedCuePlan === "object")
    && (draft.tocCaptureImageDataUrl === undefined || typeof draft.tocCaptureImageDataUrl === "string" || draft.tocCaptureImageDataUrl === null)
    && (draft.tocResultSnapshot === undefined || typeof draft.tocResultSnapshot === "object")
    && (draft.tocPagesSnapshot === undefined || Array.isArray(draft.tocPagesSnapshot))
    && (draft.step === "cover" || draft.step === "title" || draft.step === "toc" || draft.step === "toc-editor")
    && typeof draft.stepsCompleted?.cover === "boolean"
    && typeof draft.stepsCompleted?.copyright === "boolean"
  );
}

function normalizeAutoSessionDrafts(drafts: AutoSessionDraft[]): AutoSessionDraft[] {
  const now = Date.now();
  const deduped = new Map<string, AutoSessionDraft>();
  for (const draft of drafts) {
    if (!isAutoSessionDraft(draft)) {
      continue;
    }

    if (now - draft.savedAt > AUTO_SESSION_MAX_AGE_MS) {
      continue;
    }

    const existing = deduped.get(draft.id);
    if (!existing || existing.savedAt < draft.savedAt) {
      deduped.set(draft.id, draft);
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_AUTO_SESSION_DRAFTS);
}

function readAutoSessionDrafts(): AutoSessionDraft[] {
  if (typeof window === "undefined") {
    return [];
  }

  const rawV2 = window.localStorage.getItem(AUTO_SESSION_DRAFTS_KEY);

  try {
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as unknown;
      if (Array.isArray(parsed)) {
        const normalized = normalizeAutoSessionDrafts(parsed as AutoSessionDraft[]);
        window.localStorage.setItem(AUTO_SESSION_DRAFTS_KEY, JSON.stringify(normalized));
        return normalized;
      }
    }
  } catch {
    // Fall through to legacy migration path.
  }

  // Legacy migration from single-draft v1 key.
  const rawLegacy = window.localStorage.getItem(AUTO_SESSION_DRAFT_KEY);
  if (!rawLegacy) {
    return [];
  }

  try {
    const parsedLegacy = JSON.parse(rawLegacy) as Omit<AutoSessionDraft, "id">;
    if (!parsedLegacy || parsedLegacy.version !== 1) {
      window.localStorage.removeItem(AUTO_SESSION_DRAFT_KEY);
      return [];
    }

    if (Date.now() - parsedLegacy.savedAt > AUTO_SESSION_MAX_AGE_MS) {
      window.localStorage.removeItem(AUTO_SESSION_DRAFT_KEY);
      return [];
    }

    const migrated: AutoSessionDraft = {
      id: createAutoFlowTraceId("auto-draft"),
      ...parsedLegacy,
    };

    const normalized = normalizeAutoSessionDrafts([migrated]);
    window.localStorage.setItem(AUTO_SESSION_DRAFTS_KEY, JSON.stringify(normalized));
    window.localStorage.removeItem(AUTO_SESSION_DRAFT_KEY);
    return normalized;
  } catch {
    return [];
  }
}

function saveAutoSessionDraft(draft: AutoSessionDraft): AutoSessionDraft[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const existing = readAutoSessionDrafts().filter((entry) => entry.id !== draft.id);
    const merged = normalizeAutoSessionDrafts([draft, ...existing]);
    window.localStorage.setItem(AUTO_SESSION_DRAFTS_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    // Ignore quota or serialization errors; resumability is best-effort.
    return readAutoSessionDrafts();
  }
}

function deleteAutoSessionDraft(draftId: string): AutoSessionDraft[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const remaining = readAutoSessionDrafts().filter((entry) => entry.id !== draftId);
    window.localStorage.setItem(AUTO_SESSION_DRAFTS_KEY, JSON.stringify(remaining));
    return remaining;
  } catch {
    return readAutoSessionDrafts();
  }
}

function clearAllAutoSessionDrafts(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTO_SESSION_DRAFTS_KEY);
  window.localStorage.removeItem(AUTO_SESSION_DRAFT_KEY);
}

async function detectExtensionTabReadiness(): Promise<{ hasTabs: boolean; hasKnownTextbookTab: boolean }> {
  try {
    const extensionApi = (globalThis as { chrome?: { tabs?: { query?: (queryInfo: Record<string, unknown>) => Promise<Array<{ url?: string }>> } } }).chrome;
    if (!extensionApi?.tabs?.query) {
      return { hasTabs: false, hasKnownTextbookTab: false };
    }

    const tabs = await extensionApi.tabs.query({});
    const httpTabs = tabs.filter((tab) => typeof tab.url === "string" && /^https?:\/\//i.test(tab.url ?? ""));
    const hasKnownTextbookTab = httpTabs.some((tab) => {
      try {
        const hostname = new URL(tab.url ?? "").hostname.toLowerCase();
        return KNOWN_TEXTBOOK_DOMAINS.some((domain) => hostname.includes(domain));
      } catch {
        return false;
      }
    });

    return {
      hasTabs: httpTabs.length > 0,
      hasKnownTextbookTab,
    };
  } catch {
    return { hasTabs: false, hasKnownTextbookTab: false };
  }
}

function toMetadataFormState(metadata: AutoTextbookMetadata, tocConfidence: number): MetadataFormState {
  const publisherLocation = (metadata.publisherLocation ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");

  return {
    title: metadata.title ?? "",
    subtitle: metadata.subtitle ?? "",
    grade: metadata.gradeBand ?? "",
    gradeBand: metadata.gradeBand ?? "",
    subject: metadata.subject ?? "",
    edition: metadata.edition ?? "",
    publicationYear: metadata.copyrightYear?.toString() ?? "",
    copyrightYear: metadata.copyrightYear?.toString() ?? "",
    isbnRaw: metadata.isbn ?? "",
    additionalIsbnsCsv: (metadata.additionalIsbns ?? []).join(", "),
    seriesName: metadata.seriesName ?? "",
    publisher: metadata.publisher ?? "",
    publisherLocation,
    platformUrl: metadata.platformUrl ?? "",
    mhid: metadata.mhid ?? "",
    authorsCsv: (metadata.authors ?? []).join(", "),
    tocExtractionConfidence: tocConfidence > 0 ? tocConfidence.toFixed(2) : "",
  };
}

function choosePreferredSubject(
  pipelineSubject: string | null | undefined,
  ocrDerivedSubject: string | null | undefined,
  rawText: string
): string | undefined {
  const pipeline = pipelineSubject?.trim() ?? "";
  const ocrDerived = ocrDerivedSubject?.trim() ?? "";

  if (!pipeline) {
    return ocrDerived || undefined;
  }

  if (!ocrDerived || pipeline.toLowerCase() === ocrDerived.toLowerCase()) {
    return pipeline;
  }

  const lower = rawText.toLowerCase();
  const hasScienceSignal = /physical science|earth science|life science|biology|chemistry|physics|\bscience\b|\bstem\b/.test(lower);
  if (hasScienceSignal) {
    if (ocrDerived.toLowerCase() === "science") {
      return ocrDerived;
    }
    if (pipeline.toLowerCase() !== "science") {
      return "Science";
    }
  }

  if (pipeline.toLowerCase() === "ela") {
    return ocrDerived;
  }

  return pipeline;
}

function choosePreferredPublisherLocation(
  pipelineLocation: string | null | undefined,
  ocrDerivedLocation: string | null | undefined
): string | undefined {
  const pipeline = pipelineLocation?.trim() ?? "";
  const ocrDerived = ocrDerivedLocation?.trim() ?? "";

  if (!pipeline) {
    return ocrDerived || undefined;
  }

  if (!ocrDerived) {
    return pipeline;
  }

  const pipelineLooksFused = !/[\n,]/.test(pipeline) && /[a-z][A-Z]/.test(pipeline);
  const ocrLooksDelimited = /[\n,]/.test(ocrDerived);

  if (pipelineLooksFused && ocrLooksDelimited) {
    return ocrDerived;
  }

  return pipeline;
}

function fromMetadataFormState(form: MetadataFormState): AutoTextbookMetadata {
  const additionalIsbns = form.additionalIsbnsCsv
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const authors = form.authorsCsv
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    title: form.title.trim() || undefined,
    subtitle: form.subtitle.trim() || undefined,
    gradeBand: form.gradeBand.trim() || undefined,
    subject: form.subject.trim() || undefined,
    edition: form.edition.trim() || undefined,
    isbn: form.isbnRaw.trim() || undefined,
    additionalIsbns: additionalIsbns.length > 0 ? additionalIsbns : undefined,
    seriesName: form.seriesName.trim() || undefined,
    publisher: form.publisher.trim() || undefined,
    publisherLocation: form.publisherLocation.trim() || undefined,
    platformUrl: form.platformUrl.trim() || undefined,
    mhid: form.mhid.trim() || undefined,
    authors: authors.length > 0 ? authors : undefined,
    copyrightYear: form.copyrightYear ? Number(form.copyrightYear) : undefined,
  };
}

function toPageInputValue(page: number | undefined): string {
  return typeof page === "number" && Number.isFinite(page) ? String(page) : "";
}

function parsePageInputValue(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getChapterDerivedPageEnd(chapters: TocChapter[], chapterIndex: number): number | undefined {
  const chapter = chapters[chapterIndex];
  if (!chapter) {
    return undefined;
  }

  if (typeof chapter.pageEnd === "number" && Number.isFinite(chapter.pageEnd)) {
    return chapter.pageEnd;
  }

  if (typeof chapter.pageStart !== "number" || !Number.isFinite(chapter.pageStart)) {
    return undefined;
  }

  for (let index = chapterIndex + 1; index < chapters.length; index += 1) {
    const nextStart = chapters[index]?.pageStart;
    if (typeof nextStart === "number" && Number.isFinite(nextStart) && nextStart > chapter.pageStart) {
      return nextStart - 1;
    }
  }

  return undefined;
}

function getSectionDerivedPageEnd(chapter: TocChapter, sectionIndex: number): number | undefined {
  const section = chapter.sections[sectionIndex];
  if (!section) {
    return undefined;
  }

  if (typeof section.pageEnd === "number" && Number.isFinite(section.pageEnd)) {
    return section.pageEnd;
  }

  if (typeof section.pageStart !== "number" || !Number.isFinite(section.pageStart)) {
    return undefined;
  }

  for (let index = sectionIndex + 1; index < chapter.sections.length; index += 1) {
    const nextStart = chapter.sections[index]?.pageStart;
    if (typeof nextStart !== "number" || !Number.isFinite(nextStart)) {
      continue;
    }

    if (nextStart > section.pageStart) {
      return nextStart - 1;
    }

    if (nextStart === section.pageStart) {
      return section.pageStart;
    }
  }

  return undefined;
}

function buildChapterDescription(unitName: string | undefined, pageStart: number | undefined, pageEnd: number | undefined): string | undefined {
  const parts: string[] = [];
  if (unitName && unitName.trim()) {
    parts.push(unitName.trim());
  }

  if (typeof pageStart === "number" && Number.isFinite(pageStart)) {
    if (typeof pageEnd === "number" && Number.isFinite(pageEnd) && pageEnd >= pageStart) {
      parts.push(`Pages ${pageStart}-${pageEnd}`);
    } else {
      parts.push(`Starts on page ${pageStart}`);
    }
  }

  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function buildSectionNotes(pageStart: number | undefined, pageEnd: number | undefined): string | undefined {
  if (typeof pageStart !== "number" || !Number.isFinite(pageStart)) {
    return undefined;
  }

  if (typeof pageEnd === "number" && Number.isFinite(pageEnd) && pageEnd >= pageStart) {
    return `Pages ${pageStart}-${pageEnd}`;
  }

  return `Starts on page ${pageStart}`;
}

function metadataResultToAutoMetadata(metadata: MetadataResult): AutoTextbookMetadata {
  const rawExtracted = extractMetadataFromOcrText(metadata.rawText);
  const inferredSubject = choosePreferredSubject(metadata.subject, rawExtracted.subject, metadata.rawText);
  return {
    title: metadata.title ?? rawExtracted.title ?? undefined,
    subtitle: metadata.subtitle ?? rawExtracted.subtitle ?? undefined,
    edition: metadata.edition ?? rawExtracted.edition ?? undefined,
    publisher: metadata.publisher ?? rawExtracted.publisher ?? undefined,
    publisherLocation: choosePreferredPublisherLocation(metadata.publisherLocation, rawExtracted.publisherLocation),
    seriesName: metadata.series ?? rawExtracted.seriesName ?? undefined,
    gradeBand: metadata.gradeLevel ?? rawExtracted.gradeBand ?? undefined,
    subject: inferredSubject,
    copyrightYear: metadata.copyrightYear ?? rawExtracted.copyrightYear ?? undefined,
    isbn: metadata.isbn ?? rawExtracted.isbn ?? undefined,
    additionalIsbns: metadata.additionalIsbns,
    relatedIsbns: metadata.relatedIsbns,
    platformUrl: metadata.platformUrl ?? rawExtracted.platformUrl ?? undefined,
    mhid: metadata.mhid ?? rawExtracted.mhid ?? undefined,
  };
}

function metadataFormToResult(form: MetadataFormState, rawText: string, source: MetadataResult["source"], relatedIsbns: RelatedIsbn[] = []): MetadataResult {
  return {
    title: form.title.trim() || null,
    subtitle: form.subtitle.trim() || null,
    edition: form.edition.trim() || null,
    publisher: form.publisher.trim() || null,
    publisherLocation: form.publisherLocation.trim() || null,
    series: form.seriesName.trim() || null,
    gradeLevel: form.gradeBand.trim() || null,
    subject: form.subject.trim() || null,
    copyrightYear: form.copyrightYear ? Number(form.copyrightYear) : null,
    isbn: form.isbnRaw.trim() || null,
    additionalIsbns: form.additionalIsbnsCsv.split(",").map((entry) => entry.trim()).filter(Boolean),
    relatedIsbns: relatedIsbns.filter((entry) => entry.isbn.trim().length > 0),
    platformUrl: form.platformUrl.trim() || null,
    mhid: form.mhid.trim() || null,
    confidence: 1,
    rawText,
    source,
  };
}

async function cropToSelectionAndAutoBoundary(
  imageDataUrl: string,
  selection: SelectionRect,
  applyAutoBoundary = true
): Promise<string> {
  const image = await loadImage(imageDataUrl);
  const firstPassCanvas = document.createElement("canvas");
  firstPassCanvas.width = Math.max(1, Math.round(selection.width));
  firstPassCanvas.height = Math.max(1, Math.round(selection.height));
  const firstPassCtx = firstPassCanvas.getContext("2d");
  if (!firstPassCtx) {
    throw new Error("Unable to initialize crop canvas.");
  }

  firstPassCtx.drawImage(
    image,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    0,
    0,
    firstPassCanvas.width,
    firstPassCanvas.height
  );

  if (!applyAutoBoundary) {
    return firstPassCanvas.toDataURL("image/jpeg", 0.92);
  }

  const firstPassData = firstPassCtx.getImageData(0, 0, firstPassCanvas.width, firstPassCanvas.height);
  const boundary = detectPageBoundaryFromRgba(firstPassData.data, firstPassCanvas.width, firstPassCanvas.height);

  const secondPassCanvas = document.createElement("canvas");
  secondPassCanvas.width = Math.max(1, Math.round(boundary.width));
  secondPassCanvas.height = Math.max(1, Math.round(boundary.height));
  const secondPassCtx = secondPassCanvas.getContext("2d");
  if (!secondPassCtx) {
    throw new Error("Unable to initialize auto-crop canvas.");
  }

  secondPassCtx.drawImage(
    firstPassCanvas,
    boundary.x,
    boundary.y,
    boundary.width,
    boundary.height,
    0,
    0,
    secondPassCanvas.width,
    secondPassCanvas.height
  );

  return secondPassCanvas.toDataURL("image/jpeg", 0.92);
}

async function cropDataUrlToRect(imageDataUrl: string, rect: SelectionRect): Promise<string> {
  const image = await loadImage(imageDataUrl);
  const safeRect: SelectionRect = {
    x: Math.max(0, Math.min(image.naturalWidth - 1, Math.round(rect.x))),
    y: Math.max(0, Math.min(image.naturalHeight - 1, Math.round(rect.y))),
    width: Math.max(1, Math.min(image.naturalWidth, Math.round(rect.width))),
    height: Math.max(1, Math.min(image.naturalHeight, Math.round(rect.height))),
  };

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.min(image.naturalWidth - safeRect.x, safeRect.width));
  canvas.height = Math.max(1, Math.min(image.naturalHeight - safeRect.y, safeRect.height));

  const context = canvas.getContext("2d");
  if (!context) {
    return imageDataUrl;
  }

  context.drawImage(
    image,
    safeRect.x,
    safeRect.y,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL("image/jpeg", 0.92);
}

async function toGrayscaleDataUrl(imageDataUrl: string): Promise<string> {
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    return imageDataUrl;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index] ?? 0;
    const green = imageData.data[index + 1] ?? 0;
    const blue = imageData.data[index + 2] ?? 0;
    const luminance = Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
    const binaryValue = luminance >= 170 ? 255 : 0;

    imageData.data[index] = binaryValue;
    imageData.data[index + 1] = binaryValue;
    imageData.data[index + 2] = binaryValue;
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function insetCropRect(rect: SelectionRect, insetRatio: number): SelectionRect {
  const insetX = Math.round(rect.width * insetRatio);
  const insetY = Math.round(rect.height * insetRatio);
  const nextWidth = Math.max(1, rect.width - insetX * 2);
  const nextHeight = Math.max(1, rect.height - insetY * 2);

  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: nextWidth,
    height: nextHeight,
  };
}

function splitCropRect(rect: SelectionRect, orientation: "left" | "right" | "top" | "bottom", overlapRatio = 0.12): SelectionRect {
  const overlapX = Math.round(rect.width * overlapRatio);
  const overlapY = Math.round(rect.height * overlapRatio);

  if (orientation === "left") {
    const width = Math.max(1, Math.floor(rect.width / 2) + overlapX);
    return { x: rect.x, y: rect.y, width, height: rect.height };
  }

  if (orientation === "right") {
    const width = Math.max(1, Math.floor(rect.width / 2) + overlapX);
    return { x: rect.x + rect.width - width, y: rect.y, width, height: rect.height };
  }

  if (orientation === "top") {
    const height = Math.max(1, Math.floor(rect.height / 2) + overlapY);
    return { x: rect.x, y: rect.y, width: rect.width, height };
  }

  const height = Math.max(1, Math.floor(rect.height / 2) + overlapY);
  return { x: rect.x, y: rect.y + rect.height - height, width: rect.width, height };
}

async function buildTocSamplingVariants(
  imageDataUrl: string,
  options: {
    shots: 1 | 2 | 3;
    cropStrategy: "color" | "bw" | "both";
  }
): Promise<Array<{ label: string; imageDataUrl: string }>> {
  const image = await loadImage(imageDataUrl);
  const baseBoundary = {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
  let twoColumnBoundary = {
    ...baseBoundary,
  };

  try {
    const probeCanvas = document.createElement("canvas");
    probeCanvas.width = image.naturalWidth;
    probeCanvas.height = image.naturalHeight;
    const probeContext = probeCanvas.getContext("2d", { willReadFrequently: true });
    if (probeContext) {
      probeContext.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
      const probeData = probeContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
      const detected = detectPageBoundaryFromRgba(probeData.data, image.naturalWidth, image.naturalHeight);
      baseBoundary.x = detected.x;
      baseBoundary.y = detected.y;
      baseBoundary.width = detected.width;
      baseBoundary.height = detected.height;

      const detectedTwoColumn = detectTwoColumnTocRegionFromRgba(
        probeData.data,
        image.naturalWidth,
        image.naturalHeight,
        detected,
      );
      twoColumnBoundary = {
        x: detectedTwoColumn.x,
        y: detectedTwoColumn.y,
        width: detectedTwoColumn.width,
        height: detectedTwoColumn.height,
      };
    }
  } catch {
    // Best effort only.
  }

  const preferredCrop = insetCropRect(splitCropRect(splitCropRect(baseBoundary, "bottom"), "left", 0.18), 0.02);
  const wideBottomCrop = insetCropRect(splitCropRect(baseBoundary, "bottom", 0.14), 0.015);
  const centerBottomCrop = insetCropRect(
    splitCropRect(
      {
        x: baseBoundary.x + Math.round(baseBoundary.width * 0.08),
        y: baseBoundary.y,
        width: Math.max(1, Math.round(baseBoundary.width * 0.84)),
        height: baseBoundary.height,
      },
      "bottom",
      0.1,
    ),
    0.01,
  );
  const guidedTwoColumnCrop = insetCropRect(twoColumnBoundary, 0.008);
  const expandedX = Math.max(
    baseBoundary.x,
    guidedTwoColumnCrop.x - Math.round(baseBoundary.width * 0.012),
  );
  const expandedY = Math.max(
    baseBoundary.y,
    guidedTwoColumnCrop.y - Math.round(baseBoundary.height * 0.02),
  );
  const baseRight = baseBoundary.x + baseBoundary.width;
  const baseBottom = baseBoundary.y + baseBoundary.height;
  const guidedTwoColumnExpanded: SelectionRect = {
    x: expandedX,
    y: expandedY,
    width: Math.max(
      1,
      Math.min(
        baseRight - expandedX,
        guidedTwoColumnCrop.width + Math.round(baseBoundary.width * 0.024),
      ),
    ),
    height: Math.max(
      1,
      Math.min(
        baseBottom - expandedY,
        guidedTwoColumnCrop.height + Math.round(baseBoundary.height * 0.05),
      ),
    ),
  };
  const variants: Array<{ label: string; rect: SelectionRect }> = [
    { label: "full page boundary", rect: baseBoundary },
    { label: "two-column guided crop", rect: guidedTwoColumnCrop },
    { label: "preferred color crop", rect: preferredCrop },
  ];

  const deduped: Array<{ label: string; imageDataUrl: string }> = [];
  const seenRects = new Set<string>();
  for (const variant of variants) {
    const rectKey = [variant.rect.x, variant.rect.y, variant.rect.width, variant.rect.height].join("x");
    if (seenRects.has(rectKey)) {
      continue;
    }

    seenRects.add(rectKey);
    const cropped = await cropDataUrlToRect(imageDataUrl, variant.rect);
    if (options.cropStrategy !== "bw") {
      deduped.push({
        label: variant.label,
        imageDataUrl: cropped,
      });
    }

    if (options.cropStrategy !== "color") {
      deduped.push({
        label: `${variant.label} (bw)`,
        imageDataUrl: await toGrayscaleDataUrl(cropped),
      });
    }
  }

  return deduped.slice(0, Math.max(1, options.shots));
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to decode captured image."));
    img.src = dataUrl;
  });
}

/**
 * Creates a scaled-down preview version of an image for display in the upload
 * preview dialog.  The full-resolution dataUrl is used for OCR; this thumbnail
 * is used only for display, keeping the card within sensible bounds.
 */
async function scaleDownForPreview(dataUrl: string, maxDimension = 900): Promise<string> {
  if (typeof document === "undefined") {
    return dataUrl;
  }

  try {
    const image = await loadImage(dataUrl);
    const naturalMax = Math.max(image.naturalWidth, image.naturalHeight);
    if (naturalMax <= maxDimension) {
      return dataUrl;
    }

    const scale = maxDimension / naturalMax;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return dataUrl;
    }

    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return dataUrl;
  }
}

async function estimateSkinToneRatio(dataUrl: string): Promise<number> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  const targetWidth = Math.min(420, Math.max(120, image.naturalWidth));
  const aspectRatio = image.naturalHeight / Math.max(1, image.naturalWidth);
  const targetHeight = Math.max(120, Math.round(targetWidth * aspectRatio));
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    return 0;
  }

  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  const data = context.getImageData(0, 0, targetWidth, targetHeight).data;
  let skinPixels = 0;
  let totalPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];

    if (alpha < 20) {
      continue;
    }

    totalPixels += 1;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const skinToneLike = red > 95
      && green > 40
      && blue > 20
      && (max - min) > 15
      && Math.abs(red - green) > 12
      && red > green
      && red > blue;

    if (skinToneLike) {
      skinPixels += 1;
    }
  }

  return totalPixels > 0 ? skinPixels / totalPixels : 0;
}

function createDefaultSelection(image: HTMLImageElement): SelectionRect {
  return {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function createAutoFlowTraceId(prefix = "auto-flow"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emitAutoFlowDiagnostic(
  event: string,
  options: {
    level?: "info" | "warning" | "error";
    traceId?: string;
    context?: Record<string, unknown>;
  } = {}
): void {
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
    message: `Auto flow ${event}`,
    context,
  }, getCurrentUser()?.uid ?? null).catch(() => {
    // Best effort diagnostics.
  });

  emitClientDebugTrace({
    channel: "auto-flow",
    event,
    level,
    payload: context,
  });

  if (typeof fetch === "function") {
    void fetch("/api/ocr-debug-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: `auto_flow_${event}`,
        level,
        traceId: traceId ?? null,
        context,
      }),
    }).catch(() => {
      emitClientDebugTrace({
        channel: "auto-flow",
        event: "ocr_debug_endpoint_unavailable",
        level: "warning",
        payload: {
          originalEvent: event,
          traceId: traceId ?? null,
        },
      });
    });
  }
}

function buildExtractionFieldList(meta: AutoTextbookMetadata): string[] {
  const found: string[] = [];
  if (meta.title) found.push("Title");
  if (meta.subtitle) found.push("Subtitle");
  if (meta.isbn) found.push("ISBN");
  if (meta.mhid) found.push("MHID");
  if (meta.publisher) found.push("Publisher");
  if (meta.publisherLocation) found.push("Publisher Location");
  if (meta.platformUrl) found.push("Publisher URL");
  if (meta.copyrightYear) found.push("Copyright Year");
  if (meta.gradeBand) found.push("Grade Band");
  if (meta.subject) found.push("Subject");
  if (meta.edition) found.push("Edition");
  if (meta.seriesName) found.push("Series");
  if (meta.authors?.length) found.push("Authors");
  if (meta.additionalIsbns?.length) found.push("Additional ISBNs");
  return found;
}

export function AutoTextbookSetupFlow({
  runtime = "webapp",
  onSaved,
  onSwitchToManual,
  externalNavigationRequest,
  onProgressChange,
  testingSeedState,
}: AutoTextbookSetupFlowProps): React.JSX.Element {
  const initialGuidedCuePlan = useMemo(() => {
    if (testingSeedState?.guidedCuePlan) {
      return testingSeedState.guidedCuePlan;
    }

    let viewerHost: string | undefined;
    try {
      const url = new URL(testingSeedState?.metadataDraft?.platformUrl ?? "");
      viewerHost = url.hostname;
    } catch {
      viewerHost = undefined;
    }

    return createEmptyGuidedCaptureCuePlan(viewerHost);
  }, [testingSeedState?.guidedCuePlan, testingSeedState?.metadataDraft?.platformUrl]);

  const language = useUIStore((state) => state.language);
  const syncWriteCount = useUIStore((state) => state.writeCount);
  const syncReadCount = useUIStore((state) => state.readCount);
  const syncWriteLimit = useUIStore((state) => state.writeBudgetLimit);
  const syncReadLimit = useUIStore((state) => state.readBudgetLimit);
  const syncWriteExceeded = useUIStore((state) => state.writeBudgetExceeded);
  const syncReadExceeded = useUIStore((state) => state.readBudgetExceeded);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const chromeOs = useMemo(() => runtime === "extension" && isChromeOSRuntime(), [runtime]);
  const compactChromeLayout = useMemo(() => chromeOs && isSmallChromebookViewport(), [chromeOs]);
  const {
    createTextbook,
    createChapter,
    createSection,
    editTextbook,
    editChapter,
    editSection,
    fetchTextbooks,
    findTextbookByISBN,
    findDuplicateTextbook,
    fetchChaptersByTextbookId,
    fetchSectionsByChapterId,
    fetchVocabTermsBySectionId,
    fetchEquationsBySectionId,
    fetchConceptsBySectionId,
    fetchKeyIdeasBySectionId,
    removeVocabTerm,
    removeEquation,
    removeConcept,
    removeKeyIdea,
    removeSection,
    removeChapter,
  } = useRepositories();
  const draftKeyRef = useRef<string>(createDraftCaptureKey());
  const [environmentPreparationMessage, setEnvironmentPreparationMessage] = useState<string>(
    runtime === "extension"
      ? "Checking browser tabs for textbook setup readiness..."
      : "Open your textbook in another window or monitor. Maximize the browser window for best results."
  );
  const [step, setStep] = useState<AutoFlowStep>(testingSeedState?.step ?? "cover");
  const [usage, setUsage] = useState(() => testingSeedState?.usage ?? readPersistedCaptureUsage(draftKeyRef.current) ?? createInitialAutoCaptureUsage());
  const [metadataDraft, setMetadataDraft] = useState<AutoTextbookMetadata>(testingSeedState?.metadataDraft ?? {});
  const [metadataConfidence, setMetadataConfidence] = useState<AutoMetadataConfidenceMap>(testingSeedState?.metadataConfidence ?? {});
  const [metadataForm, setMetadataForm] = useState<MetadataFormState>(() => ({
    ...toMetadataFormState(testingSeedState?.metadataDraft ?? {}, testingSeedState?.tocResult?.confidence ?? 0),
    ...(testingSeedState?.metadataForm ?? {}),
  }));
  const [coverImageDataUrl, setCoverImageDataUrl] = useState<string | null>(testingSeedState?.coverImageDataUrl ?? null);
  const [ownershipProofDataUrl, setOwnershipProofDataUrl] = useState<string | null>(testingSeedState?.ownershipProofDataUrl ?? null);
  const [lastMetadataImageDataUrl, setLastMetadataImageDataUrl] = useState<string | null>(
    testingSeedState?.ownershipProofDataUrl ?? testingSeedState?.coverImageDataUrl ?? null
  );
  const [relatedIsbns, setRelatedIsbns] = useState<RelatedIsbn[]>(testingSeedState?.metadataDraft?.relatedIsbns ?? []);
  const [ocrDraft, setOcrDraft] = useState(testingSeedState?.ocrDraft ?? "");
  const [tocResult, setTocResult] = useState<ParsedTocResult>(testingSeedState?.tocResult ?? INITIAL_TOC_RESULT);
  const [tocPages, setTocPages] = useState<TocPage[]>(testingSeedState?.tocPages ?? (testingSeedState?.tocResult ? [{
    pageIndex: 0,
    chapters: testingSeedState.tocResult.chapters,
    confidence: testingSeedState.tocResult.confidence,
  }] : []));
  const [tocCaptureImageDataUrl, setTocCaptureImageDataUrl] = useState<string | null>(testingSeedState?.tocCaptureImageDataUrl ?? null);
  const [guidedCuePlan, setGuidedCuePlan] = useState<GuidedCaptureCuePlan>(initialGuidedCuePlan);
  const [isBusy, setIsBusy] = useState(false);
  const [tocPreviewExpansionMode, setTocPreviewExpansionMode] = useState<TocPreviewExpansionMode>("default");
  const [tocPreviewExpansionCycle, setTocPreviewExpansionCycle] = useState(0);
  const [activePrimaryHelper, setActivePrimaryHelper] = useState<AutoPrimaryHelperAction | null>(null);
  const [primaryHelperAnchor, setPrimaryHelperAnchor] = useState<{ x: number; y: number } | null>(null);
  const helperDelayTimerRef = useRef<number | null>(null);
  const pendingHelperActionRef = useRef<AutoPrimaryHelperAction | null>(null);
  const pendingHelperAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [ocrProgressMessage, setOcrProgressMessage] = useState("Analyzing image - OCR is reading your page. This usually takes a few seconds...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ocrCooldownExpiryMs, setOcrCooldownExpiryMs] = useState<number>(0);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [ocrProviderStatus, setOcrProviderStatus] = useState<string | null>(null);
  const [lastExtractionFields, setLastExtractionFields] = useState<string[]>([]);
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateTextbookMatch | null>(null);
  const [conflictResolutionMode, setConflictResolutionMode] = useState<AutoConflictResolutionMode>("overwrite_auto");
  const [moderationAssessment, setModerationAssessment] = useState<ImageModerationAssessment | null>(null);
  const [captureDialog, setCaptureDialog] = useState<CaptureDialogState>({ open: false, imageDataUrl: "" });
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isTitleDragOver, setIsTitleDragOver] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<UploadPreviewState>({
    open: false,
    step: "cover",
    imageDataUrl: "",
    ocrText: "",
    ocrProviderId: "",
    editableOcrText: "",
    metadataResult: null,
    pipelineResult: null,
  });
  const [saveUploadProgress, setSaveUploadProgress] = useState<SaveUploadProgressState>({
    visible: false,
    percent: 0,
    detail: "",
  });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const selectionResolverRef = useRef<((value: SelectionRect | null) => void) | null>(null);
  const selectionRectRef = useRef<SelectionRect | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const flowSessionTraceIdRef = useRef<string>(createAutoFlowTraceId("auto-flow-session"));
  const lastMetadataPipelineRef = useRef<MetadataPipelineResult | null>(null);
  const lastMetadataCaptureStepRef = useRef<"cover" | "title">("cover");
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const titleFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCapturedOcrByStepRef = useRef<Record<"cover" | "title", string>>({
    cover: "",
    title: "",
  });
  const lastTocCaptureOcrRef = useRef<string>(testingSeedState?.step === "toc" || testingSeedState?.step === "toc-editor" ? (testingSeedState.ocrDraft ?? "") : "");
  const lastTocCaptureFingerprintRef = useRef<string | null>(null);
  const lastTocCaptureTimestampRef = useRef<number>(0);
  const ocrBuffersByStepRef = useRef<OcrStepBuffers>({
    cover: {
      raw: testingSeedState?.step === "cover" ? (testingSeedState.ocrDraft ?? "") : "",
      draft: testingSeedState?.step === "cover" ? (testingSeedState.ocrDraft ?? "") : "",
    },
    title: {
      raw: testingSeedState?.step === "title" ? (testingSeedState.ocrDraft ?? "") : "",
      draft: testingSeedState?.step === "title" ? (testingSeedState.ocrDraft ?? "") : "",
    },
    toc: {
      raw: testingSeedState?.step === "toc" || testingSeedState?.step === "toc-editor" ? (testingSeedState.ocrDraft ?? "") : "",
      draft: testingSeedState?.step === "toc" || testingSeedState?.step === "toc-editor" ? (testingSeedState.ocrDraft ?? "") : "",
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingUploadLimitResultRef = useRef<ReturnType<typeof enforceAutoCaptureLimit> | null>(null);
  // Scroll target â€” metadata fields section revealed after successful OCR.
  const metadataFormRef = useRef<HTMLDivElement>(null);
  const activeSessionDraftIdRef = useRef<string>(createAutoFlowTraceId("auto-draft"));
  const lastCorrectionSignatureRef = useRef<string | null>(null);

  // â”€â”€ Raw OCR / parsed metadata two-section state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // rawOcrText: original, unedited OCR output shown read-only for transparency.
  // ocrDraft: editable copy the user can correct before re-parsing.
  const [rawOcrText, setRawOcrText] = useState(testingSeedState?.ocrDraft ?? "");
  const [isRawOcrExpanded, setIsRawOcrExpanded] = useState(false);
  const [isOcrEditorExpanded, setIsOcrEditorExpanded] = useState(false);
  const [expandedMetadataField, setExpandedMetadataField] = useState<MetadataTileKey | null>(null);
  const lastHandledExternalNavigationTokenRef = useRef<number | null>(null);
  const ocrTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // â”€â”€ Resumable sessions (max 3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [resumableDrafts, setResumableDrafts] = useState<AutoSessionDraft[]>(() => readAutoSessionDrafts());
  const currentSessionHasWork = Boolean(coverImageDataUrl || ownershipProofDataUrl || rawOcrText || metadataForm.title.trim());
  const isSessionCapacityReached = resumableDrafts.length >= MAX_AUTO_SESSION_DRAFTS && !currentSessionHasWork;

  function updateStepOcrBuffers(targetStep: OcrBufferStep, rawText: string, draftText: string = rawText): void {
    ocrBuffersByStepRef.current[targetStep] = {
      raw: rawText,
      draft: draftText,
    };
  }

  function updateCurrentStepOcrDraft(nextDraft: string): void {
    setOcrDraft(nextDraft);
    const activeStep = toOcrBufferStep(step);
    ocrBuffersByStepRef.current[activeStep] = {
      ...ocrBuffersByStepRef.current[activeStep],
      draft: nextDraft,
    };
  }

  function bumpTocPreviewExpansion(mode: TocPreviewExpansionMode): void {
    setTocPreviewExpansionMode(mode);
    setTocPreviewExpansionCycle((current) => current + 1);
  }

  function syncDisplayedOcrFromStep(nextStep: AutoFlowStep): void {
    const target = ocrBuffersByStepRef.current[toOcrBufferStep(nextStep)];
    setRawOcrText(target.raw);
    setOcrDraft(target.draft);
  }

  function resetAllOcrRuntimeCaches(): void {
    lastCapturedOcrByStepRef.current = {
      cover: "",
      title: "",
    };
    lastTocCaptureOcrRef.current = "";
    lastTocCaptureFingerprintRef.current = null;
    lastTocCaptureTimestampRef.current = 0;
    ocrBuffersByStepRef.current = {
      cover: { raw: "", draft: "" },
      title: { raw: "", draft: "" },
      toc: { raw: "", draft: "" },
    };
    setRawOcrText("");
    setOcrDraft("");
    setOcrProviderStatus("");
    setOcrProgressMessage("");
    setIsRawOcrExpanded(false);
    setIsOcrEditorExpanded(false);
  }

  function resetTitleOcrScratchpad(): void {
    updateStepOcrBuffers("title", "", "");
    if (step === "title") {
      setRawOcrText("");
      setOcrDraft("");
    }
    setOcrProviderStatus("");
    setOcrProgressMessage("");
  }

  useEffect(() => {
    emitAutoFlowDiagnostic("session_started", {
      traceId: flowSessionTraceIdRef.current,
      context: {
        runtime,
        initialStep: testingSeedState?.step ?? "cover",
      },
    });
  }, [runtime, testingSeedState?.step]);

  useEffect(() => {
    syncDisplayedOcrFromStep(step);
  }, [step]);

  useEffect(() => {
    let mounted = true;

    if (runtime !== "extension") {
      setEnvironmentPreparationMessage("Open your textbook in another window or monitor. Maximize the browser window for best results.");
      return () => {
        mounted = false;
      };
    }

    async function detectEnvironment(): Promise<void> {
      const readiness = await detectExtensionTabReadiness();
      if (!mounted) {
        return;
      }

      if (readiness.hasKnownTextbookTab) {
        setEnvironmentPreparationMessage("Navigate to the cover page and click Capture Cover.");
        return;
      }

      if (readiness.hasTabs) {
        setEnvironmentPreparationMessage("Please open your textbook in a browser tab and navigate to the cover page.");
        return;
      }

      setEnvironmentPreparationMessage("Please open your textbook in a browser tab and navigate to the cover page.");
    }

    void detectEnvironment();

    return () => {
      mounted = false;
    };
  }, [runtime]);

  useEffect(() => {
    if (!isMetadataCorrectionSharingEnabled()) {
      return;
    }

    void syncMetadataCorrectionLearning({
      optedIn: true,
      maxPushRecords: 25,
    });
  }, []);

  useEffect(() => {
    setDuplicateMatch(null);
  }, [metadataForm.isbnRaw]);

  // Persist a lightweight session snapshot so the user can resume after a
  // page reload.  Only save when there is something meaningful to recover.
  useEffect(() => {
    if (!coverImageDataUrl && !ownershipProofDataUrl && !rawOcrText && !metadataForm.title && tocResult.chapters.length === 0) {
      deleteAutoExtractionCheckpoint(activeSessionDraftIdRef.current);
      const remaining = deleteAutoSessionDraft(activeSessionDraftIdRef.current);
      setResumableDrafts(remaining);
      return;
    }

    const extractionCheckpoint: AutoExtractionCheckpoint = {
      version: 1,
      draftId: activeSessionDraftIdRef.current,
      savedAt: Date.now(),
      stage: "guided_navigation",
      subjectPriority: resolveSubjectPriority(metadataForm.subject),
      contentOrder: getExtractionContentOrder({ subject: metadataForm.subject }),
      cursor: {
        chapterIndex: tocResult.chapters.length > 0 ? 0 : undefined,
      },
      completedCounts: {
        vocabulary: getGuidedCueCompletion(guidedCuePlan).completed,
      },
      pauseReason: shouldPauseAutoExtraction({
        cloudReads: { used: syncReadCount, limit: syncReadLimit },
        cloudWrites: { used: syncWriteCount, limit: syncWriteLimit },
        localWrites: {
          used: syncWriteExceeded ? syncWriteLimit : 0,
          limit: syncWriteLimit,
        },
      }).shouldPause || syncReadExceeded
        ? "usage_limit_near_threshold"
        : undefined,
    };

    saveAutoExtractionCheckpoint(extractionCheckpoint);

    const draft: AutoSessionDraft = {
      id: activeSessionDraftIdRef.current,
      version: 1,
      savedAt: Date.now(),
      coverImageDataUrl,
      ownershipProofDataUrl,
      rawOcrText,
      metadataTitle: metadataForm.title,
      metadataSubject: metadataForm.subject,
      metadataPublisher: metadataForm.publisher,
      metadataFormSnapshot: metadataForm,
      relatedIsbnsSnapshot: relatedIsbns,
      extractionCheckpoint,
      guidedCuePlan,
      tocCaptureImageDataUrl,
      tocResultSnapshot: tocResult,
      tocPagesSnapshot: tocPages,
      step,
      stepsCompleted: {
        cover: Boolean(coverImageDataUrl),
        copyright: Boolean(lastCapturedOcrByStepRef.current.title),
      },
    };

    const nextDrafts = saveAutoSessionDraft(draft);
    setResumableDrafts(nextDrafts.filter((entry) => entry.id !== activeSessionDraftIdRef.current));
  }, [
    coverImageDataUrl,
    ownershipProofDataUrl,
    rawOcrText,
    metadataForm,
    relatedIsbns,
    step,
    syncReadCount,
    syncReadExceeded,
    syncReadLimit,
    syncWriteCount,
    syncWriteExceeded,
    syncWriteLimit,
    guidedCuePlan,
    tocCaptureImageDataUrl,
    tocPages,
    tocResult,
  ]);

  const canFinishToc = tocResult.chapters.length > 0;

  useEffect(() => {
    const currentStep: 1 | 2 | 3 | 4 = step === "cover"
      ? 1
      : step === "title"
        ? 2
        : step === "toc"
          ? 3
          : 4;

    const currentLabel = currentStep === 1
      ? "Cover"
      : currentStep === 2
        ? "Copyright Page"
        : currentStep === 3
          ? "Table of Contents"
          : "Data";

    const completed: [boolean, boolean, boolean, boolean] = [
      Boolean(coverImageDataUrl),
      Boolean(ownershipProofDataUrl),
      tocResult.chapters.length > 0,
      false,
    ];

    onProgressChange?.({ currentStep, currentLabel, completed });
  }, [coverImageDataUrl, onProgressChange, ownershipProofDataUrl, step, tocResult.chapters.length]);

  const primaryHelperText = useMemo(() => {
    if (activePrimaryHelper === "capture-cover") {
      return environmentPreparationMessage;
    }

    if (activePrimaryHelper === "upload-cover") {
      return "Upload a cover screenshot if live capture is blocked. A clear, full-page image gives the best extraction quality.";
    }

    if (activePrimaryHelper === "capture-title") {
      return "Capture the full copyright page so ownership and publication details can be verified accurately.";
    }

    if (activePrimaryHelper === "upload-title") {
      return "Upload a clear copyright page image if live capture is blocked. Keep text large and legible for better OCR.";
    }

    if (activePrimaryHelper === "capture-toc") {
      return "Capture TOC repeatedly as needed. Overlapping captures are merged and TOC pages are stitched to reduce duplicates while keeping new entries.";
    }

    if (activePrimaryHelper === "finish-toc") {
      return "Finish TOC after capturing all contents pages you want included. You can still review and edit in the TOC editor next.";
    }

    if (activePrimaryHelper === "switch-manual") {
      return "Switch to Manual mode if you prefer entering textbook metadata directly.";
    }

    return null;
  }, [activePrimaryHelper, environmentPreparationMessage]);
  const captureSupportInfo = useMemo(() => getDisplayCaptureSupportInfo(), []);
  const hasOcrDraft = ocrDraft.trim().length > 0;

  useEffect(() => {
    return () => {
      resetDisplayCaptureSession();
      if (helperDelayTimerRef.current !== null) {
        window.clearTimeout(helperDelayTimerRef.current);
        helperDelayTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (step !== "toc") {
      resetDisplayCaptureSession();
    }
  }, [step]);

  function clearPrimaryHelperDelay(): void {
    if (helperDelayTimerRef.current !== null) {
      window.clearTimeout(helperDelayTimerRef.current);
      helperDelayTimerRef.current = null;
    }
  }

  function schedulePrimaryHelper(action: AutoPrimaryHelperAction, x: number, y: number, delayMs: number): void {
    clearPrimaryHelperDelay();
    pendingHelperActionRef.current = action;
    pendingHelperAnchorRef.current = { x, y };

    helperDelayTimerRef.current = window.setTimeout(() => {
      const pendingAction = pendingHelperActionRef.current;
      const pendingAnchor = pendingHelperAnchorRef.current;
      if (!pendingAction || !pendingAnchor) {
        return;
      }

      setActivePrimaryHelper(pendingAction);
      setPrimaryHelperAnchor(pendingAnchor);
      helperDelayTimerRef.current = null;
    }, delayMs);
  }

  function showPrimaryHelper(action: AutoPrimaryHelperAction, x: number, y: number): void {
    schedulePrimaryHelper(action, x, y, AUTO_HELPER_HOVER_DELAY_MS);
  }

  function hidePrimaryHelper(): void {
    clearPrimaryHelperDelay();
    pendingHelperActionRef.current = null;
    pendingHelperAnchorRef.current = null;
    setActivePrimaryHelper(null);
    setPrimaryHelperAnchor(null);
  }

  function handlePrimaryHelperMouseEnter(action: AutoPrimaryHelperAction, event: React.MouseEvent<HTMLButtonElement>): void {
    showPrimaryHelper(
      action,
      event.clientX + AUTO_HELPER_POINTER_OFFSET_X,
      event.clientY + AUTO_HELPER_POINTER_OFFSET_Y,
    );
  }

  function handlePrimaryHelperMouseMove(event: React.MouseEvent<HTMLButtonElement>): void {
    const nextAnchor = {
      x: event.clientX + AUTO_HELPER_POINTER_OFFSET_X,
      y: event.clientY + AUTO_HELPER_POINTER_OFFSET_Y,
    };
    if (activePrimaryHelper) {
      setPrimaryHelperAnchor(nextAnchor);
      return;
    }

    pendingHelperAnchorRef.current = nextAnchor;
  }

  function handlePrimaryHelperFocus(action: AutoPrimaryHelperAction, event: React.FocusEvent<HTMLButtonElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    schedulePrimaryHelper(
      action,
      rect.left + rect.width / 2,
      rect.bottom + AUTO_HELPER_FOCUS_OFFSET_Y,
      AUTO_HELPER_FOCUS_DELAY_MS,
    );
  }

  function updateMetadataForm<K extends keyof MetadataFormState>(field: K, value: MetadataFormState[K]): void {
    setMetadataForm((current) => {
      const next = { ...current, [field]: value };
      const nextMetadata = fromMetadataFormState(next);
      const normalizedRelated = relatedIsbns.filter((entry) => entry.isbn.trim().length > 0);

      setMetadataDraft((currentDraft) => ({
        ...currentDraft,
        ...nextMetadata,
        relatedIsbns: normalizedRelated.length > 0 ? normalizedRelated : undefined,
      }));

      return next;
    });

    const metadataField = FORM_TO_METADATA_FIELD[field];
    if (!metadataField) {
      return;
    }

    setMetadataConfidence((current) => ({
      ...current,
      [metadataField]: {
        value,
        confidence: 1,
        sourceType: "manual",
      },
    }));
  }

  useEffect(() => {
    if (!hasOcrDraft) {
      setIsOcrEditorExpanded(false);
      return;
    }

    // Collapse when fresh OCR arrives so preview stays compact until user opens it.
    setIsOcrEditorExpanded(false);
  }, [rawOcrText, hasOcrDraft]);

  useEffect(() => {
    if (!isOcrEditorExpanded || !ocrTextareaRef.current) {
      return;
    }

    const textarea = ocrTextareaRef.current;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
  }, [isOcrEditorExpanded, ocrDraft]);

  function applyMetadataDraft(nextMetadata: AutoTextbookMetadata, tocConfidence = tocResult.confidence): void {
    setMetadataDraft(nextMetadata);
    setMetadataForm(toMetadataFormState(nextMetadata, tocConfidence));
    setRelatedIsbns(nextMetadata.relatedIsbns ?? []);
  }

  function addRelatedIsbn(): void {
    setRelatedIsbns((current) => {
      const next: RelatedIsbn[] = [...current, { isbn: "", type: "student" }];
      const normalizedRelated = next.filter((entry) => entry.isbn.trim().length > 0);
      setMetadataDraft((currentDraft) => ({
        ...currentDraft,
        ...fromMetadataFormState(metadataForm),
        relatedIsbns: normalizedRelated.length > 0 ? normalizedRelated : undefined,
      }));
      return next;
    });
  }

  function removeRelatedIsbn(index: number): void {
    setRelatedIsbns((current) => {
      const next = current.filter((_, currentIndex) => currentIndex !== index);
      const normalizedRelated = next.filter((entry) => entry.isbn.trim().length > 0);
      setMetadataDraft((currentDraft) => ({
        ...currentDraft,
        ...fromMetadataFormState(metadataForm),
        relatedIsbns: normalizedRelated.length > 0 ? normalizedRelated : undefined,
      }));
      return next;
    });
  }

  function updateRelatedIsbn<K extends keyof RelatedIsbn>(index: number, field: K, value: RelatedIsbn[K]): void {
    setRelatedIsbns((current) => {
      const next = current.map((entry, currentIndex) => currentIndex === index ? { ...entry, [field]: value } : entry);
      const normalizedRelated = next.filter((entry) => entry.isbn.trim().length > 0);
      setMetadataDraft((currentDraft) => ({
        ...currentDraft,
        ...fromMetadataFormState(metadataForm),
        relatedIsbns: normalizedRelated.length > 0 ? normalizedRelated : undefined,
      }));
      return next;
    });
  }

  function upsertAutoMetadataConfidence(incoming: AutoMetadataConfidenceMap): void {
    setMetadataConfidence((current) => {
      const next: AutoMetadataConfidenceMap = { ...current };
      for (const [fieldKey, fieldValue] of Object.entries(incoming)) {
        const typedKey = fieldKey as AutoMetadataFieldKey;
        const prior = next[typedKey];
        if (prior?.sourceType === "manual") {
          continue;
        }

        if (!fieldValue) {
          continue;
        }

        next[typedKey] = fieldValue;
      }
      return next;
    });
  }

  function getFieldConfidence(field: AutoMetadataFieldKey): number | null {
    return typeof metadataConfidence[field]?.confidence === "number"
      ? metadataConfidence[field]!.confidence
      : null;
  }

  function getFieldConfidenceClass(confidence: number | null): string {
    if (confidence === null) {
      return "metadata-confidence-dot metadata-confidence-dot--unknown";
    }

    if (confidence >= 0.8) {
      return "metadata-confidence-dot metadata-confidence-dot--high";
    }

    if (confidence >= 0.55) {
      return "metadata-confidence-dot metadata-confidence-dot--medium";
    }

    return "metadata-confidence-dot metadata-confidence-dot--low";
  }

  function renderConfidenceDot(field: AutoMetadataFieldKey): React.JSX.Element {
    const confidence = getFieldConfidence(field);
    const rounded = Math.round((confidence ?? 0) * 100);
    const sourceType = metadataConfidence[field]?.sourceType ?? "auto";

    return (
      <span
        className={getFieldConfidenceClass(confidence)}
        title={confidence === null
          ? "Confidence: unavailable"
          : `Confidence: ${rounded}% (${sourceType})`}
        aria-label={confidence === null
          ? "Confidence unavailable"
          : `Confidence ${rounded} percent from ${sourceType}`}
      />
    );
  }

  function getMetadataTileConfidence(tile: MetadataTileKey): number | null {
    const confidenceFieldMap: Partial<Record<MetadataTileKey, AutoMetadataFieldKey>> = {
      title: "title",
      subtitle: "subtitle",
      gradeBand: "gradeBand",
      subject: "subject",
      edition: "edition",
      copyrightYear: "copyrightYear",
      isbnRaw: "isbn",
      additionalIsbnsCsv: "additionalIsbns",
      authorsCsv: "authors",
      publisher: "publisher",
      publisherLocation: "publisherLocation",
      platformUrl: "platformUrl",
      mhid: "mhid",
      seriesName: "seriesName",
    };

    const mappedField = confidenceFieldMap[tile];
    return mappedField ? getFieldConfidence(mappedField) : null;
  }

  function getTileConfidenceField(tile: MetadataTileKey): AutoMetadataFieldKey | undefined {
    const confidenceFieldMap: Partial<Record<MetadataTileKey, AutoMetadataFieldKey>> = {
      title: "title",
      subtitle: "subtitle",
      gradeBand: "gradeBand",
      subject: "subject",
      edition: "edition",
      copyrightYear: "copyrightYear",
      isbnRaw: "isbn",
      additionalIsbnsCsv: "additionalIsbns",
      authorsCsv: "authors",
      publisher: "publisher",
      publisherLocation: "publisherLocation",
      platformUrl: "platformUrl",
      mhid: "mhid",
      seriesName: "seriesName",
    };
    return confidenceFieldMap[tile];
  }

  function getMetadataTileSummary(tile: MetadataTileKey): string {
    switch (tile) {
      case "title":
        return metadataForm.title;
      case "subtitle":
        return metadataForm.subtitle;
      case "grade":
        return metadataForm.grade;
      case "gradeBand":
        return metadataForm.gradeBand;
      case "subject":
        return metadataForm.subject;
      case "edition":
        return metadataForm.edition;
      case "publicationYear":
        return metadataForm.publicationYear;
      case "copyrightYear":
        return metadataForm.copyrightYear;
      case "isbnRaw":
        return metadataForm.isbnRaw;
      case "additionalIsbnsCsv":
        return metadataForm.additionalIsbnsCsv;
      case "relatedIsbns": {
        const filledCount = relatedIsbns.filter((entry) => entry.isbn.trim().length > 0).length;
        return filledCount > 0 ? `${filledCount} linked` : "";
      }
      case "authorsCsv":
        return metadataForm.authorsCsv;
      case "publisher":
        return metadataForm.publisher;
      case "publisherLocation":
        return metadataForm.publisherLocation;
      case "platformUrl":
        return metadataForm.platformUrl;
      case "mhid":
        return metadataForm.mhid;
      case "seriesName":
        return metadataForm.seriesName;
      default:
        return "";
    }
  }

  function isMetadataTileCaptured(tile: MetadataTileKey): boolean {
    return getMetadataTileSummary(tile).trim().length > 0;
  }

  function renderMetadataTileEditor(tile: MetadataTileKey): React.JSX.Element {
    if (tile === "title") {
      return <input aria-label="Title" value={metadataForm.title} onChange={(event) => updateMetadataForm("title", event.target.value)} />;
    }
    if (tile === "subtitle") {
      return <input value={metadataForm.subtitle} onChange={(event) => updateMetadataForm("subtitle", event.target.value)} />;
    }
    if (tile === "grade") {
      return <input value={metadataForm.grade} onChange={(event) => updateMetadataForm("grade", event.target.value)} />;
    }
    if (tile === "gradeBand") {
      return <input value={metadataForm.gradeBand} onChange={(event) => updateMetadataForm("gradeBand", event.target.value)} />;
    }
    if (tile === "subject") {
      return (
        <select value={metadataForm.subject} onChange={(event) => updateMetadataForm("subject", event.target.value)}>
          {SUBJECTS.map((subject) => (
            <option key={subject} value={subject}>{subject}</option>
          ))}
        </select>
      );
    }
    if (tile === "edition") {
      return <input value={metadataForm.edition} onChange={(event) => updateMetadataForm("edition", event.target.value)} />;
    }
    if (tile === "publicationYear") {
      return <input type="number" value={metadataForm.publicationYear} onChange={(event) => updateMetadataForm("publicationYear", event.target.value)} />;
    }
    if (tile === "copyrightYear") {
      return <input type="number" value={metadataForm.copyrightYear} onChange={(event) => updateMetadataForm("copyrightYear", event.target.value)} />;
    }
    if (tile === "isbnRaw") {
      return <input value={metadataForm.isbnRaw} onChange={(event) => updateMetadataForm("isbnRaw", event.target.value)} />;
    }
    if (tile === "additionalIsbnsCsv") {
      return <input aria-label="Additional ISBNs (comma separated)" value={metadataForm.additionalIsbnsCsv} onChange={(event) => updateMetadataForm("additionalIsbnsCsv", event.target.value)} />;
    }
    if (tile === "authorsCsv") {
      return <input value={metadataForm.authorsCsv} onChange={(event) => updateMetadataForm("authorsCsv", event.target.value)} />;
    }
    if (tile === "publisher") {
      return <input value={metadataForm.publisher} onChange={(event) => updateMetadataForm("publisher", event.target.value)} />;
    }
    if (tile === "publisherLocation") {
      return <input aria-label="Publisher Location" value={metadataForm.publisherLocation} onChange={(event) => updateMetadataForm("publisherLocation", event.target.value)} />;
    }
    if (tile === "platformUrl") {
      return <input type="url" value={metadataForm.platformUrl} onChange={(event) => updateMetadataForm("platformUrl", event.target.value)} />;
    }
    if (tile === "mhid") {
      return <input value={metadataForm.mhid} onChange={(event) => updateMetadataForm("mhid", event.target.value)} />;
    }
    if (tile === "seriesName") {
      return <input value={metadataForm.seriesName} onChange={(event) => updateMetadataForm("seriesName", event.target.value)} />;
    }

    return (
      <fieldset className="form-fieldset">
        <legend>Related ISBNs (typed)</legend>
        {relatedIsbns.map((row, index) => (
          <div key={`auto-related-isbn-${index}`} className="related-isbn-row">
            <input
              value={row.isbn}
              onChange={(event) => updateRelatedIsbn(index, "isbn", event.target.value)}
              placeholder="ISBN-10 or ISBN-13"
              className="related-isbn-input"
            />
            <select
              value={row.type}
              onChange={(event) => updateRelatedIsbn(index, "type", event.target.value as RelatedIsbnType)}
              aria-label={`Auto related ISBN type ${index + 1}`}
              className="related-isbn-type"
            >
              {RELATED_ISBN_TYPES.map((type) => (
                <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
              ))}
            </select>
            <input
              value={row.note ?? ""}
              onChange={(event) => updateRelatedIsbn(index, "note", event.target.value)}
              placeholder="Label/Note (optional, e.g., Teacher Edition)"
              className="related-isbn-note"
            />
            <button type="button" className="btn-icon btn-danger" onClick={() => removeRelatedIsbn(index)} aria-label="Remove related ISBN" title="Remove">{"\u00D7"}</button>
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={addRelatedIsbn}>+ Add Related ISBN</button>
      </fieldset>
    );
  }

  /** Auto-scroll disabled during current UI refinement cycle. */
  function scrollToMetadata(): void {
    // Intentionally no-op.
  }

  async function requestSelection(imageDataUrl: string): Promise<SelectionRect | null> {
    setCaptureDialog({ open: true, imageDataUrl });
    setSelectionRect(null);
    selectionRectRef.current = null;
    setDragStart(null);
    dragStartRef.current = null;

    return new Promise<SelectionRect | null>((resolve) => {
      selectionResolverRef.current = resolve;
    });
  }

  function updateSelectionRect(next: SelectionRect | null): void {
    selectionRectRef.current = next;
    setSelectionRect(next);
  }

  function updateDragStart(next: { x: number; y: number } | null): void {
    dragStartRef.current = next;
    setDragStart(next);
  }

  function closeSelectionDialog(selection: SelectionRect | null): void {
    selectionResolverRef.current?.(selection);
    selectionResolverRef.current = null;
    setCaptureDialog({ open: false, imageDataUrl: "" });
    updateSelectionRect(null);
    updateDragStart(null);
  }

  function handleSelectionPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!imageRef.current) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    updateDragStart({ x, y });
    updateSelectionRect({ x, y, width: 0, height: 0 });
  }

  function handleSelectionPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const activeDragStart = dragStartRef.current ?? dragStart;
    if (!activeDragStart || !imageRef.current) {
      return;
    }

    const rect = imageRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const currentY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

    const x = Math.min(activeDragStart.x, currentX);
    const y = Math.min(activeDragStart.y, currentY);
    const width = Math.abs(currentX - activeDragStart.x);
    const height = Math.abs(currentY - activeDragStart.y);
    updateSelectionRect({ x, y, width, height });
  }

  function handleSelectionPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const activeDragStart = dragStartRef.current ?? dragStart;
    updateDragStart(null);

    if (!imageRef.current) {
      closeSelectionDialog(null);
      return;
    }

    const imageBounds = imageRef.current.getBoundingClientRect();

    if (activeDragStart) {
      const currentX = Math.max(0, Math.min(imageBounds.width, event.clientX - imageBounds.left));
      const currentY = Math.max(0, Math.min(imageBounds.height, event.clientY - imageBounds.top));

      const normalizedSelection: SelectionRect = {
        x: Math.min(activeDragStart.x, currentX),
        y: Math.min(activeDragStart.y, currentY),
        width: Math.abs(currentX - activeDragStart.x),
        height: Math.abs(currentY - activeDragStart.y),
      };

      const hasArea = normalizedSelection.width > 3 && normalizedSelection.height > 3;
      if (hasArea) {
        closeSelectionDialog(normalizedSelection);
        return;
      }
    }

    const latestSelection = selectionRectRef.current;
    if (latestSelection && latestSelection.width > 3 && latestSelection.height > 3) {
      closeSelectionDialog(latestSelection);
      return;
    }

    closeSelectionDialog({
      x: 0,
      y: 0,
      width: imageBounds.width,
      height: imageBounds.height,
    });
  }

  function convertSelectionToNaturalPixels(selection: SelectionRect, image: HTMLImageElement): SelectionRect {
    const displayedWidth = image.getBoundingClientRect().width;
    const displayedHeight = image.getBoundingClientRect().height;

    const ratioX = image.naturalWidth / Math.max(1, displayedWidth);
    const ratioY = image.naturalHeight / Math.max(1, displayedHeight);

    const x = Math.max(0, Math.round(selection.x * ratioX));
    const y = Math.max(0, Math.round(selection.y * ratioY));
    const width = Math.max(1, Math.round(selection.width * ratioX));
    const height = Math.max(1, Math.round(selection.height * ratioY));

    return {
      x,
      y,
      width: Math.min(image.naturalWidth - x, width),
      height: Math.min(image.naturalHeight - y, height),
    };
  }

  function applyMetadataFromText(rawText: string, sourceStep: "cover" | "title"): void {
    const correctedText = applyCorrectionRulesToText(rawText, getEffectiveCorrectionRules(), {
      publisher: metadataForm.publisher,
    });
    const cleanedText = preprocessMetadataOcrText(correctedText);
    const safety = evaluateAutoCaptureSafety(cleanedText, sourceStep);
    if (!safety.allowed) {
      setErrorMessage(safety.message ?? "Capture blocked by safety checks.");
      appendDebugLogEntry({
        eventType: "warning",
        message: "Metadata extraction blocked by safety checks.",
        autoModeStep: sourceStep,
        context: { reason: safety.reason ?? "unknown" },
      });
      return;
    }

    const parsed = extractMetadataFromOcrText(cleanedText);
    const merged = mergeAutoMetadata(metadataDraft, parsed);
    upsertAutoMetadataConfidence(scoreMetadataConfidence(cleanedText, parsed));
    applyMetadataDraft(merged);
    setLastExtractionFields(buildExtractionFieldList(parsed));
    setErrorMessage(null);
    setInfoMessage("Metadata extracted. Review and correct the fields below before accepting.");
    appendDebugLogEntry({
      eventType: "metadata_extracted",
      message: "Metadata extracted from OCR draft.",
      autoModeStep: sourceStep,
        context: {
          hasTitle: Boolean(merged.title),
          hasIsbn: Boolean(merged.isbn),
          hasAuthors: Boolean(merged.authors?.length),
          cleanedLength: cleanedText.length,
        },
    });
  }

  function applyMetadataFromPipelineResult(result: MetadataResult, sourceStep: "cover" | "title"): void {
    const merged = mergeAutoMetadata(metadataDraft, metadataResultToAutoMetadata(result));
    const scored = scoreMetadataConfidence(result.rawText, metadataResultToAutoMetadata(result));

    const fieldConfidence: AutoMetadataConfidenceMap = {
      ...scored,
      title: result.title
        ? { value: result.title, confidence: result.confidence, sourceType: "auto" }
        : scored.title,
      subtitle: result.subtitle
        ? { value: result.subtitle, confidence: result.confidence, sourceType: "auto" }
        : scored.subtitle,
      edition: result.edition
        ? { value: result.edition, confidence: result.confidence, sourceType: "auto" }
        : scored.edition,
      publisher: result.publisher
        ? { value: result.publisher, confidence: result.confidence, sourceType: "auto" }
        : scored.publisher,
      publisherLocation: result.publisherLocation
        ? { value: result.publisherLocation, confidence: result.confidence, sourceType: "auto" }
        : scored.publisherLocation,
      seriesName: result.series
        ? { value: result.series, confidence: result.confidence, sourceType: "auto" }
        : scored.seriesName,
      gradeBand: result.gradeLevel
        ? { value: result.gradeLevel, confidence: result.confidence, sourceType: "auto" }
        : scored.gradeBand,
      subject: result.subject
        ? { value: result.subject, confidence: result.confidence, sourceType: "auto" }
        : scored.subject,
      platformUrl: result.platformUrl
        ? { value: result.platformUrl, confidence: result.confidence, sourceType: "auto" }
        : scored.platformUrl,
      mhid: result.mhid
        ? { value: result.mhid, confidence: result.confidence, sourceType: "auto" }
        : scored.mhid,
    };

    upsertAutoMetadataConfidence(fieldConfidence);
    applyMetadataDraft(merged);
    updateCurrentStepOcrDraft(result.rawText);
    setLastExtractionFields(buildExtractionFieldList(metadataResultToAutoMetadata(result)));
    setErrorMessage(null);
    setInfoMessage("Metadata extracted. Review and correct the fields below before accepting.");
    appendDebugLogEntry({
      eventType: "metadata_extracted",
      message: "Metadata extracted from vision-first pipeline.",
      autoModeStep: sourceStep,
      context: {
        source: result.source,
        confidence: result.confidence,
        extractedFields: buildExtractionFieldList(metadataResultToAutoMetadata(result)),
        hasTitle: Boolean(result.title),
        hasPublisher: Boolean(result.publisher),
      },
    });
  }

  function queueCorrectionLearningSample(trigger: "accept_cover" | "accept_title" | "save"): void {
    const latestPipeline = lastMetadataPipelineRef.current;
    if (!latestPipeline) {
      return;
    }

    const finalMetadataResult = metadataFormToResult(
      metadataForm,
      ocrDraft,
      latestPipeline.result.source ?? "ocr",
      relatedIsbns
    );

    const signature = [
      trigger,
      lastMetadataCaptureStepRef.current,
      finalMetadataResult.title ?? "",
      finalMetadataResult.subtitle ?? "",
      finalMetadataResult.subject ?? "",
      finalMetadataResult.publisher ?? "",
      finalMetadataResult.rawText.length,
    ].join("|");

    if (lastCorrectionSignatureRef.current === signature) {
      return;
    }

    lastCorrectionSignatureRef.current = signature;
    const savedRecord = saveCorrectionRecord({
      pageType: lastMetadataCaptureStepRef.current,
      publisher: finalMetadataResult.publisher,
      series: finalMetadataResult.series,
      subject: finalMetadataResult.subject,
      originalVisionOutput: latestPipeline.originalVisionOutput ?? null,
      originalOcrOutput: latestPipeline.originalOcrOutput
        ? { rawText: latestPipeline.originalOcrOutput.rawText }
        : null,
      finalMetadata: finalMetadataResult,
      imageReference: lastMetadataImageDataUrl ?? coverImageDataUrl,
    });

    appendDebugLogEntry({
      eventType: "user_action",
      message: "Metadata correction sample logged.",
      autoModeStep: lastMetadataCaptureStepRef.current,
      context: {
        trigger,
        correctionId: savedRecord.id,
        flagged: savedRecord.flagged,
        finalConfidence: savedRecord.finalConfidence,
        parsedFields: buildExtractionFieldList(metadataResultToAutoMetadata(savedRecord.finalMetadata)),
      },
    });

    if (isMetadataCorrectionSharingEnabled()) {
      void syncMetadataCorrectionLearning({
        optedIn: true,
        maxPushRecords: trigger === "save" ? 30 : 10,
      }).then((syncResult) => {
        if (syncResult.message) {
          setInfoMessage(syncResult.message);
        }
      });
    }
  }

  function handleAcceptCoverStep(): void {
    queueCorrectionLearningSample("accept_cover");
    // Always enter copyright capture with an empty OCR scratchpad.
    resetTitleOcrScratchpad();
    setStep("title");
  }

  function resetTocOcrScratchpad(): void {
    lastTocCaptureOcrRef.current = "";
    updateStepOcrBuffers("toc", "", "");
    setRawOcrText("");
    setOcrDraft("");
    setOcrProviderStatus("");
    setOcrProgressMessage("");
  }

  function handleAcceptTitleStep(): void {
    queueCorrectionLearningSample("accept_title");
    // Starting TOC capture should always begin with a clean OCR scratchpad.
    resetTocOcrScratchpad();
    setStep("toc");
  }

  useEffect(() => {
    if (!externalNavigationRequest) {
      return;
    }

    if (lastHandledExternalNavigationTokenRef.current === externalNavigationRequest.token) {
      return;
    }

    lastHandledExternalNavigationTokenRef.current = externalNavigationRequest.token;

    if (externalNavigationRequest.direction === "back") {
      if (step === "title") {
        setStep("cover");
        return;
      }

      if (step === "toc") {
        setStep("title");
        return;
      }

      if (step === "toc-editor") {
        setStep("toc");
      }

      return;
    }

    if (step === "cover") {
      handleAcceptCoverStep();
      return;
    }

    if (step === "title") {
      handleAcceptTitleStep();
      return;
    }

    if (step === "toc") {
      setStep("toc-editor");
    }
  }, [externalNavigationRequest, step]);

  function applyTocFromText(rawText: string): void {
    const safety = evaluateAutoCaptureSafety(rawText, "toc");
    if (!safety.allowed) {
      setErrorMessage(safety.message ?? "Capture blocked by safety checks.");
      appendDebugLogEntry({
        eventType: "warning",
        message: "TOC extraction blocked by safety checks.",
        autoModeStep: "toc",
        context: { reason: safety.reason ?? "unknown" },
      });
      return;
    }

    const parsed = parseTocFromOcrText(rawText);

    if (!isLikelyTocText(rawText) && parsed.chapters.length === 0) {
      setErrorMessage(AUTO_MODE_SCOPE_MESSAGE);
      return;
    }

    setTocPages((current) => {
      const nextPages = [...current, {
        pageIndex: current.length,
        chapters: parsed.chapters,
        confidence: parsed.confidence,
      }];

      const stitched = stitchTocPages(nextPages);
      const stitchedResult: ParsedTocResult = {
        chapters: stitched.chapters,
        confidence: stitched.stitchingConfidence,
      };

      setTocResult(stitchedResult);
      setMetadataForm((currentForm) => ({
        ...currentForm,
        tocExtractionConfidence: stitchedResult.confidence > 0 ? stitchedResult.confidence.toFixed(2) : currentForm.tocExtractionConfidence,
      }));
      setErrorMessage(null);
      setInfoMessage(`TOC capture added. ${stitchedResult.chapters.length} chapter entries recognized so far.`);
      appendDebugLogEntry({
        eventType: "toc_stitch",
        message: "TOC pages stitched.",
        autoModeStep: "toc",
        context: {
          chapters: stitchedResult.chapters.length,
          confidence: stitchedResult.confidence,
          pages: nextPages.length,
        },
      });

      return nextPages;
    });
  }

  async function captureForStep(targetStep: "cover" | "title" | "toc"): Promise<CaptureResult | null> {
    const traceId = createAutoFlowTraceId(`auto-flow-${targetStep}`);
    emitAutoFlowDiagnostic("capture_requested", {
      traceId,
      context: {
        targetStep,
        usage,
      },
    });

    const limitResult = enforceAutoCaptureLimit(usage, targetStep, DEFAULT_AUTO_CAPTURE_LIMITS);
    if (!limitResult.allowed) {
      setErrorMessage(limitResult.message ?? "Capture limit reached.");
      emitAutoFlowDiagnostic("capture_blocked_limit", {
        level: "warning",
        traceId,
        context: {
          targetStep,
          usage,
          limits: DEFAULT_AUTO_CAPTURE_LIMITS,
        },
      });
      appendDebugLogEntry({
        eventType: "warning",
        message: "Capture blocked by limit guard.",
        autoModeStep: targetStep,
        context: { usage, limits: DEFAULT_AUTO_CAPTURE_LIMITS },
      });
      return null;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setOcrCooldownExpiryMs(0);
    setIsBusy(true);

    try {
      appendDebugLogEntry({
        eventType: "auto_capture_start",
        message: "Capture started.",
        autoModeStep: targetStep,
      });
      emitAutoFlowDiagnostic("capture_started", {
        traceId,
        context: { targetStep },
      });

      const rawImage = await captureDisplayFrame({
        preferChromeTabCapture: chromeOs,
        keepSessionAlive: targetStep === "toc",
      });
      let effectiveRawImage = rawImage;
      if (targetStep === "toc") {
        const fingerprint = computeCaptureFingerprint(rawImage);
        const nowMs = Date.now();
        const previousFingerprint = lastTocCaptureFingerprintRef.current;
        const previousCapturedAt = lastTocCaptureTimestampRef.current;
        const duplicateFrame = previousFingerprint !== null && previousFingerprint === fingerprint;

        emitAutoFlowDiagnostic("toc_capture_frame_fingerprint", {
          traceId,
          context: {
            targetStep,
            fingerprint,
            duplicateFrame,
            previousCapturedAt,
            nowMs,
          },
        });

        if (duplicateFrame) {
          appendDebugLogEntry({
            eventType: "warning",
            message: "TOC capture detected duplicate frame; forcing capture session refresh.",
            autoModeStep: "toc",
            context: {
              traceId,
              fingerprint,
              previousCapturedAt,
              nowMs,
            },
          });

          resetDisplayCaptureSession();
          const refreshedImage = await captureDisplayFrame({
            preferChromeTabCapture: chromeOs,
            keepSessionAlive: true,
          });
          const refreshedFingerprint = computeCaptureFingerprint(refreshedImage);
          effectiveRawImage = refreshedImage;

          emitAutoFlowDiagnostic("toc_capture_frame_refreshed", {
            traceId,
            context: {
              targetStep,
              previousFingerprint: fingerprint,
              refreshedFingerprint,
              changed: refreshedFingerprint !== fingerprint,
            },
          });

          appendDebugLogEntry({
            eventType: refreshedFingerprint !== fingerprint ? "info" : "warning",
            message: refreshedFingerprint !== fingerprint
              ? "TOC capture refresh produced a new frame."
              : "TOC capture refresh still produced duplicate frame.",
            autoModeStep: "toc",
            context: {
              traceId,
              previousFingerprint: fingerprint,
              refreshedFingerprint,
            },
          });

          lastTocCaptureFingerprintRef.current = refreshedFingerprint;
          lastTocCaptureTimestampRef.current = Date.now();
        } else {
          lastTocCaptureFingerprintRef.current = fingerprint;
          lastTocCaptureTimestampRef.current = nowMs;
        }
      }
      emitAutoFlowDiagnostic("frame_captured", {
        traceId,
        context: {
          targetStep,
          imageBytes: effectiveRawImage.length,
        },
      });
      const image = await loadImage(effectiveRawImage);
      const defaultSelection = createDefaultSelection(image);
      let cropped = "";
      let selection = defaultSelection;
      const requiresManualSelection = targetStep === "cover";

      try {
        if (requiresManualSelection) {
          const selectedRectDisplay = await requestSelection(effectiveRawImage);
          if (!selectedRectDisplay) {
            setErrorMessage("Capture was canceled before selecting a region. Try again or upload a screenshot manually.");
            appendDebugLogEntry({
              eventType: "error",
              message: "Capture canceled before region selection.",
              autoModeStep: targetStep,
            });
            return null;
          }

          const selectedRectNatural = convertSelectionToNaturalPixels(selectedRectDisplay, image);
          const hasMeaningfulSelection = selectedRectNatural.width > 6 && selectedRectNatural.height > 6;
          selection = hasMeaningfulSelection ? selectedRectNatural : defaultSelection;
          emitAutoFlowDiagnostic("selection_applied", {
            traceId,
            context: {
              targetStep,
              hasMeaningfulSelection,
              selectedWidth: selection.width,
              selectedHeight: selection.height,
            },
          });
          cropped = await cropToSelectionAndAutoBoundary(effectiveRawImage, selection, true);
        } else {
          emitAutoFlowDiagnostic("selection_skipped_full_page", {
            traceId,
            context: {
              targetStep,
              selectedWidth: selection.width,
              selectedHeight: selection.height,
            },
          });
          if (targetStep === "toc") {
            // Keep the raw frame for TOC so no intermediate crop/re-encode step can
            // remove edge controls needed for guided cue pinning.
            cropped = effectiveRawImage;
          } else {
            cropped = await cropToSelectionAndAutoBoundary(effectiveRawImage, selection, true);
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown region capture error.";
        setErrorMessage("We couldn't capture that region. Try again or upload a screenshot manually.");
        appendDebugLogEntry({
          eventType: "error",
          message: "Region capture failed.",
          autoModeStep: targetStep,
          context: { detail },
        });
        return null;
      }

      setUsage(limitResult.nextUsage);
      persistCaptureUsage(draftKeyRef.current, limitResult.nextUsage);

      let ocrProviderStatusMessage = "";
      let ocrText = "";
      let ocrProviderId = "n/a";
      let metadataResult: MetadataResult | null = null;
      let pipelineResult: MetadataPipelineResult | null = null;

      if (targetStep === "cover" || targetStep === "title") {
        setOcrProgressMessage("Analyzing image - OCR is reading your page. This usually takes a few seconds...");
        setIsRunningOcr(true);
        emitAutoFlowDiagnostic("metadata_pipeline_started", {
          traceId,
          context: {
            targetStep,
            imageBytes: cropped.length,
          },
        });
        pipelineResult = await extractMetadataWithOcrFallbackFromDataUrl(cropped, {
          pageType: targetStep,
          publisherHint: metadataForm.publisher || null,
        });
        setIsRunningOcr(false);

        metadataResult = pipelineResult.result;
        const resolvedPipelineOcr = await resolveUsablePipelineOcr({
          candidateText: pipelineResult.originalOcrOutput?.rawText ?? pipelineResult.result.rawText,
          sourceProviderId: pipelineResult.originalOcrOutput?.providerId ?? "vision-primary",
          imageDataUrl: cropped,
          targetStep,
          traceId,
          hasOriginalOcrOutput: Boolean(pipelineResult.originalOcrOutput),
        });
        ocrText = resolvedPipelineOcr.text;
        ocrProviderId = resolvedPipelineOcr.providerId;
        emitAutoFlowDiagnostic("metadata_pipeline_completed", {
          traceId,
          context: {
            targetStep,
            metadataSource: pipelineResult.result.source,
            originalOcrProviderId: pipelineResult.originalOcrOutput?.providerId ?? null,
            confidence: pipelineResult.result.confidence,
          },
        });
        ocrProviderStatusMessage = `Metadata source: ${pipelineResult.result.source}${ocrProviderId ? ` (OCR: ${ocrProviderId})` : ""}`;
        lastCapturedOcrByStepRef.current[targetStep] = ocrText;
      } else {
        setOcrProgressMessage("Analyzing image - OCR is reading your TOC capture. This usually takes a few seconds...");
        setIsRunningOcr(true);
        emitAutoFlowDiagnostic("toc_ocr_started", {
          traceId,
          context: {
            targetStep,
            imageBytes: cropped.length,
          },
        });
        const tocRuntimeOptions = await getTocOcrRuntimeOptions();
        const ocr = await extractTextFromImageWithFallback(cropped, tocRuntimeOptions);
        setIsRunningOcr(false);
        ocrText = ocr.text;
        ocrProviderId = ocr.providerId;
        emitAutoFlowDiagnostic("toc_ocr_completed", {
          traceId,
          context: {
            targetStep,
            ocrProviderId: ocr.providerId,
            textLength: ocr.text.length,
            attempts: ocr.attempts,
          },
        });
        ocrProviderStatusMessage = `OCR provider: ${ocr.providerId}`;
      }

      setOcrProviderStatus(ocrProviderStatusMessage);
      appendDebugLogEntry({
        eventType: "auto_capture_complete",
        message: "Capture completed.",
        autoModeStep: targetStep,
        captureMetadata: {
          width: selection.width,
          height: selection.height,
          fileSizeBytes: Math.round((cropped.length * 3) / 4),
        },
        context: {
          usageAfterCapture: limitResult.nextUsage,
          ocrProvider: ocrProviderId,
          metadataSource: metadataResult?.source,
        },
      });
      emitAutoFlowDiagnostic("capture_completed", {
        traceId,
        context: {
          targetStep,
          ocrProviderId,
          metadataSource: metadataResult?.source ?? null,
          usageAfterCapture: limitResult.nextUsage,
        },
      });
      return {
        imageDataUrl: cropped,
        ocrText,
        ocrProviderId,
        metadataResult,
        pipelineResult,
      };
    } catch (error) {
      setIsRunningOcr(false);
      const rawMessage = error instanceof Error ? error.message : String(error);

      if (/All OCR providers failed/i.test(rawMessage)) {
        const summaryMatch = rawMessage.match(/\]\.?\s*(.*)$/);
        const providerSummary = summaryMatch?.[1]?.trim() ?? "OCR providers returned unusable text.";
        const userFacingOcrMessage = "Screen capture succeeded, but OCR could not extract usable text. Try zooming in on the textbook page, selecting the exact tab/window, or using Upload Image.";

        emitAutoFlowDiagnostic("ocr_pipeline_failed_after_capture", {
          level: "error",
          traceId,
          context: {
            targetStep,
            message: rawMessage,
            providerSummary,
          },
        });

        setErrorMessage(userFacingOcrMessage);
        setOcrProviderStatus(`OCR fallback summary: ${providerSummary}`);
        setOcrCooldownExpiryMs(getAutoOcrCooldownExpiryMs());
        appendDebugLogEntry({
          eventType: "error",
          message: "OCR pipeline failed after capture.",
          autoModeStep: targetStep,
          context: {
            detail: rawMessage,
            providerSummary,
          },
        });
        return null;
      }

      const normalized = normalizeDisplayCaptureError(error);
      const message = normalized.message;
      const userFacingMessage = normalized.code === "permission_denied"
        ? `Screen capture permission was denied in ${normalized.browser}. Enable macOS Screen Recording for the browser, then retry. You can also use Upload Image.`
        : normalized.code === "chooser_cancelled"
          ? "Screen capture was canceled before selecting a window/tab. Please select a source and retry, or use Upload Image."
          : normalized.code === "api_unavailable"
            ? `${normalized.browser} does not fully support this capture path. Use Chrome or Edge, or use Upload Image.`
            : normalized.code === "device_unavailable"
              ? "The selected capture source was not readable. Close other sharing sessions and retry, or use Upload Image."
              : normalized.code === "frame_unavailable"
                ? "A share source was selected, but no frame was received. Retry capture, or use Upload Image."
                : "Unable to capture screen. Try again, or use Upload Image as fallback.";
      emitAutoFlowDiagnostic("capture_failed", {
        level: "error",
        traceId,
        context: {
          targetStep,
          message,
          code: normalized.code,
          browser: normalized.browser,
        },
      });
      setErrorMessage(userFacingMessage);
      setOcrCooldownExpiryMs(getAutoOcrCooldownExpiryMs());
      appendDebugLogEntry({
        eventType: "error",
        message: "Display capture failed.",
        autoModeStep: targetStep,
        context: {
          detail: message,
          code: normalized.code,
          browser: normalized.browser,
        },
      });
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  function runMetadataExtraction(): void {
    applyMetadataFromText(ocrDraft, step === "title" ? "title" : "cover");
  }

  async function resolveUsablePipelineOcr(
    input: {
      candidateText: string;
      sourceProviderId: string;
      imageDataUrl: string;
      targetStep: "cover" | "title";
      traceId: string;
      hasOriginalOcrOutput: boolean;
    }
  ): Promise<{ text: string; providerId: string }> {
    if (!isLikelyUnusableOcrText(input.candidateText)) {
      return {
        text: input.candidateText,
        providerId: input.sourceProviderId,
      };
    }

    emitAutoFlowDiagnostic("pipeline_text_unusable_forcing_ocr", {
      level: "warning",
      traceId: input.traceId,
      context: {
        targetStep: input.targetStep,
        hasOriginalOcrOutput: input.hasOriginalOcrOutput,
      },
    });

    try {
      const fallback = await extractTextFromImageWithFallback(input.imageDataUrl);
      if (!isLikelyUnusableOcrText(fallback.text)) {
        emitAutoFlowDiagnostic("pipeline_text_fallback_ocr_success", {
          traceId: input.traceId,
          context: {
            targetStep: input.targetStep,
            fallbackProviderId: fallback.providerId,
            textLength: fallback.text.length,
          },
        });
        return {
          text: fallback.text,
          providerId: fallback.providerId,
        };
      }
    } catch (error) {
      emitAutoFlowDiagnostic("pipeline_text_fallback_ocr_failed", {
        level: "warning",
        traceId: input.traceId,
        context: {
          targetStep: input.targetStep,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }

    setErrorMessage("OCR could not read usable text from this image. Try recapturing, uploading a clearer cover, or editing OCR text manually.");
    setOcrCooldownExpiryMs(getAutoOcrCooldownExpiryMs());
    return {
      text: "",
      providerId: input.sourceProviderId,
    };
  }

  function runTocExtraction(): void {
    applyTocFromText(ocrDraft);
  }

  async function processImageFileForStep(file: File, targetStep: "cover" | "title"): Promise<void> {
    if (isSessionCapacityReached) {
      setErrorMessage("You already have 3 unfinished Auto captures. Delete one draft or finish one before starting another.");
      return;
    }

    const traceId = createAutoFlowTraceId(`auto-flow-upload-${targetStep}`);
    emitAutoFlowDiagnostic("upload_started", {
      traceId,
      context: {
        targetStep,
        fileName: file.name,
        fileType: file.type,
        fileSizeBytes: file.size,
      },
    });

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please select an image file (JPEG, PNG, WEBP, etc.).");
      emitAutoFlowDiagnostic("upload_rejected_non_image", {
        level: "warning",
        traceId,
        context: {
          targetStep,
          fileType: file.type,
        },
      });
      return;
    }

    const limitResult = enforceAutoCaptureLimit(usage, targetStep, DEFAULT_AUTO_CAPTURE_LIMITS);
    if (!limitResult.allowed) {
      setErrorMessage(limitResult.message ?? "Capture limit reached.");
      emitAutoFlowDiagnostic("upload_blocked_limit", {
        level: "warning",
        traceId,
        context: {
          targetStep,
          usage,
          limits: DEFAULT_AUTO_CAPTURE_LIMITS,
        },
      });
      appendDebugLogEntry({
        eventType: "warning",
        message: "File upload blocked by limit guard.",
        autoModeStep: targetStep,
        context: { usage, limits: DEFAULT_AUTO_CAPTURE_LIMITS },
      });
      return;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setIsBusy(true);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Unable to read image file."));
        reader.readAsDataURL(file);
      });

      emitAutoFlowDiagnostic("upload_read_completed", {
        traceId,
        context: {
          targetStep,
          imageBytes: dataUrl.length,
        },
      });

      setOcrProgressMessage("Analyzing image - OCR is reading your page. This usually takes a few seconds...");
      setIsRunningOcr(true);
      const pipelineResult = await extractMetadataWithOcrFallbackFromDataUrl(dataUrl, {
        pageType: targetStep,
        publisherHint: metadataForm.publisher || null,
      });
      setIsRunningOcr(false);

      const resolvedPipelineOcr = await resolveUsablePipelineOcr({
        candidateText: pipelineResult.originalOcrOutput?.rawText ?? pipelineResult.result.rawText,
        sourceProviderId: pipelineResult.originalOcrOutput?.providerId ?? "vision-primary",
        imageDataUrl: dataUrl,
        targetStep,
        traceId,
        hasOriginalOcrOutput: Boolean(pipelineResult.originalOcrOutput),
      });
      const ocrText = resolvedPipelineOcr.text;
      const ocrProviderId = resolvedPipelineOcr.providerId;
      emitAutoFlowDiagnostic("upload_pipeline_completed", {
        traceId,
        context: {
          targetStep,
          metadataSource: pipelineResult.result.source,
          ocrProviderId,
          confidence: pipelineResult.result.confidence,
        },
      });
      setOcrProviderStatus(`Metadata source: ${pipelineResult.result.source}${ocrProviderId ? ` (OCR: ${ocrProviderId})` : ""}`);

      // Show preview dialog so the user can review image and OCR text before confirming.
      // Use a scaled-down version only for display; full-res `dataUrl` was already used for OCR.
      const previewDataUrl = await scaleDownForPreview(dataUrl);
      setUploadPreview({
        open: true,
        step: targetStep,
        imageDataUrl: previewDataUrl,
        ocrText,
        ocrProviderId,
        editableOcrText: ocrText,
        metadataResult: pipelineResult.result,
        pipelineResult,
      });

      // Commit happens in confirmUploadPreview; store limitResult for use there.
      pendingUploadLimitResultRef.current = limitResult;
    } catch {
      setIsRunningOcr(false);
      emitAutoFlowDiagnostic("upload_pipeline_failed", {
        level: "error",
        traceId,
        context: {
          targetStep,
        },
      });
      setErrorMessage("Unable to process image file. Make sure the file is a valid image and try again.");
      appendDebugLogEntry({
        eventType: "error",
        message: "Image file upload processing failed.",
        autoModeStep: targetStep,
      });
    } finally {
      setIsBusy(false);
    }
  }

  function confirmUploadPreview(): void {
    const limitResult = pendingUploadLimitResultRef.current;
    if (!limitResult) {
      return;
    }

    const { imageDataUrl, editableOcrText, ocrProviderId, metadataResult, pipelineResult } = uploadPreview;

    setUsage(limitResult.nextUsage);
    persistCaptureUsage(draftKeyRef.current, limitResult.nextUsage);
    pendingUploadLimitResultRef.current = null;

    const targetStep = uploadPreview.step;
    emitAutoFlowDiagnostic("upload_preview_confirmed", {
      traceId: createAutoFlowTraceId(`auto-flow-confirm-${targetStep}`),
      context: {
        targetStep,
        ocrProviderId,
        textLength: editableOcrText.length,
      },
    });
    lastCapturedOcrByStepRef.current[targetStep] = uploadPreview.ocrText;
    // Store the original raw OCR text separately from the editable draft.
    updateStepOcrBuffers(targetStep, uploadPreview.ocrText, editableOcrText);
    if (toOcrBufferStep(step) === targetStep) {
      setRawOcrText(uploadPreview.ocrText);
      setOcrDraft(editableOcrText);
    }
    setModerationAssessment(null);
    if (pipelineResult) {
      lastMetadataPipelineRef.current = pipelineResult;
    }
    if (targetStep === "cover") {
      setCoverImageDataUrl(imageDataUrl);
    } else {
      setOwnershipProofDataUrl(imageDataUrl);
    }
    setLastMetadataImageDataUrl(imageDataUrl);
    lastMetadataCaptureStepRef.current = targetStep;
    if (metadataResult) {
      applyMetadataFromPipelineResult({
        ...metadataResult,
        rawText: editableOcrText,
      }, targetStep);
    } else {
      applyMetadataFromText(editableOcrText, targetStep);
    }
    setInfoMessage(`${describeMetadataCaptureStep(targetStep)} image loaded and parsed. Review fields before accepting. (OCR: ${ocrProviderId})`);
    setUploadPreview((current) => ({ ...current, open: false }));
    // Scroll the user down to the extracted metadata fields.
    scrollToMetadata();

    appendDebugLogEntry({
      eventType: "auto_capture_complete",
      message: "Capture confirmed from uploaded file.",
      autoModeStep: targetStep,
      context: {
        usageAfterCapture: limitResult.nextUsage,
        ocrProvider: ocrProviderId,
      },
    });
  }

  function cancelUploadPreview(): void {
    pendingUploadLimitResultRef.current = null;
    setUploadPreview((current) => ({ ...current, open: false }));
    setInfoMessage(null);
  }

  function handleCoverDropZoneDragOver(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (isSessionCapacityReached) {
      return;
    }
    setIsDragOver(true);
  }

  function handleCoverDropZoneDragLeave(): void {
    setIsDragOver(false);
  }

  function handleCoverDropZoneDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (isSessionCapacityReached) {
      setErrorMessage("Queue full: finish or delete one of the 3 in-progress auto captures before starting another.");
      return;
    }
    setIsDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void processImageFileForStep(file, "cover");
    }
  }

  function handleTitleDropZoneDragOver(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (isSessionCapacityReached) {
      return;
    }
    setIsTitleDragOver(true);
  }

  function handleTitleDropZoneDragLeave(): void {
    setIsTitleDragOver(false);
  }

  function handleTitleDropZoneDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (isSessionCapacityReached) {
      setErrorMessage("Queue full: finish or delete one of the 3 in-progress auto captures before starting another.");
      return;
    }
    setIsTitleDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void processImageFileForStep(file, "title");
    }
  }

  async function handleCaptureCover(): Promise<void> {
    await executeGuiCliBoundCommand("courseforge textbooks auto capture cover", async () => {
      if (isSessionCapacityReached) {
        setErrorMessage("You already have 3 unfinished Auto captures. Delete one draft or finish one before starting another.");
        return;
      }
      emitAutoFlowDiagnostic("ui_capture_cover_clicked", {
        traceId: createAutoFlowTraceId("auto-flow-ui-cover"),
        context: { step },
      });
      const captured = await captureForStep("cover");
      if (!captured) {
        emitAutoFlowDiagnostic("ui_capture_cover_no_result", {
          level: "warning",
          traceId: createAutoFlowTraceId("auto-flow-ui-cover"),
        });
        return;
      }

      setCoverImageDataUrl(captured.imageDataUrl);
      setLastMetadataImageDataUrl(captured.imageDataUrl);
      lastCapturedOcrByStepRef.current.cover = captured.ocrText;
      updateStepOcrBuffers("cover", captured.ocrText, captured.ocrText);
      setRawOcrText(captured.ocrText);
      setOcrDraft(captured.ocrText);
      setModerationAssessment(null);
      setStep("cover");
      if (captured.pipelineResult) {
        lastMetadataPipelineRef.current = captured.pipelineResult;
      }
      lastMetadataCaptureStepRef.current = "cover";
      if (captured.metadataResult) {
        applyMetadataFromPipelineResult(captured.metadataResult, "cover");
      } else {
        applyMetadataFromText(captured.ocrText, "cover");
      }
      setInfoMessage(`Cover captured and parsed. Review the metadata fields before accepting. (Source: ${captured.metadataResult?.source ?? `OCR: ${captured.ocrProviderId}`})`);
      scrollToMetadata();
    }, {
      step,
    });
  }

  async function handleCaptureTitle(): Promise<void> {
    await executeGuiCliBoundCommand("courseforge textbooks auto capture title", async () => {
      if (isSessionCapacityReached) {
        setErrorMessage("You already have 3 unfinished Auto captures. Delete one draft or finish one before starting another.");
        return;
      }
      emitAutoFlowDiagnostic("ui_capture_title_clicked", {
        traceId: createAutoFlowTraceId("auto-flow-ui-title"),
        context: { step },
      });
      const captured = await captureForStep("title");
      if (!captured) {
        emitAutoFlowDiagnostic("ui_capture_title_no_result", {
          level: "warning",
          traceId: createAutoFlowTraceId("auto-flow-ui-title"),
        });
        return;
      }

      const mergedOcrText = captured.ocrText;
      lastCapturedOcrByStepRef.current.title = mergedOcrText;
      setOwnershipProofDataUrl(captured.imageDataUrl);
      setLastMetadataImageDataUrl(captured.imageDataUrl);
      updateStepOcrBuffers("title", mergedOcrText, mergedOcrText);
      setRawOcrText(mergedOcrText);
      setOcrDraft(mergedOcrText);
      setStep("title");
      if (captured.pipelineResult) {
        lastMetadataPipelineRef.current = captured.pipelineResult;
      }
      lastMetadataCaptureStepRef.current = "title";
      if (captured.metadataResult) {
        applyMetadataFromPipelineResult({
          ...captured.metadataResult,
          rawText: mergedOcrText,
        }, "title");
      } else {
        applyMetadataFromText(mergedOcrText, "title");
      }
      setInfoMessage(`Copyright page captured and parsed. Review merged metadata. (Source: ${captured.metadataResult?.source ?? `OCR: ${captured.ocrProviderId}`})`);
      scrollToMetadata();
    }, {
      step,
    });
  }

  async function handleCaptureTitleAddShot(): Promise<void> {
    await executeGuiCliBoundCommand("courseforge textbooks auto capture title add-shot", async () => {
      if (isSessionCapacityReached) {
        setErrorMessage("You already have 3 unfinished Auto captures. Delete one draft or finish one before starting another.");
        return;
      }

      emitAutoFlowDiagnostic("ui_capture_title_multishot_clicked", {
        traceId: createAutoFlowTraceId("auto-flow-ui-title-multishot"),
        context: { step },
      });

      const captured = await captureForStep("title");
      if (!captured) {
        emitAutoFlowDiagnostic("ui_capture_title_multishot_no_result", {
          level: "warning",
          traceId: createAutoFlowTraceId("auto-flow-ui-title-multishot"),
        });
        return;
      }

      const titleBaselineBuffer = ocrBuffersByStepRef.current.title;
      const baselineText = titleBaselineBuffer.raw.trim().length > 0
        ? titleBaselineBuffer.raw
        : titleBaselineBuffer.draft;
      const mergedOcrText = mergeOcrTextWithOverlap(baselineText, captured.ocrText);

      lastCapturedOcrByStepRef.current.title = mergedOcrText;
      setOwnershipProofDataUrl((current) => current ?? captured.imageDataUrl);
      setLastMetadataImageDataUrl(captured.imageDataUrl);
      updateStepOcrBuffers("title", mergedOcrText, mergedOcrText);
      setRawOcrText(mergedOcrText);
      setOcrDraft(mergedOcrText);
      setStep("title");
      if (captured.pipelineResult) {
        lastMetadataPipelineRef.current = captured.pipelineResult;
      }
      lastMetadataCaptureStepRef.current = "title";
      if (captured.metadataResult) {
        applyMetadataFromPipelineResult({
          ...captured.metadataResult,
          rawText: mergedOcrText,
        }, "title");
      } else {
        applyMetadataFromText(mergedOcrText, "title");
      }

      setInfoMessage(`Copyright page shot added. OCR was overlap-merged into one draft. (OCR: ${captured.ocrProviderId})`);
      scrollToMetadata();
    }, {
      step,
    });
  }

  async function handleCaptureToc(): Promise<void> {
    await executeGuiCliBoundCommand("courseforge textbooks auto capture toc", async () => {
    bumpTocPreviewExpansion("collapse-all");
    emitAutoFlowDiagnostic("ui_capture_toc_clicked", {
      traceId: createAutoFlowTraceId("auto-flow-ui-toc"),
      context: { step },
    });
    const captured = await captureForStep("toc");
    if (!captured) {
      emitAutoFlowDiagnostic("ui_capture_toc_no_result", {
        level: "warning",
        traceId: createAutoFlowTraceId("auto-flow-ui-toc"),
      });
      return;
    }

    let selectedTocText = captured.ocrText;
    let selectedProviderId = captured.ocrProviderId;
    let rescueApplied = false;

    const evaluateCandidate = (candidateText: string): {
      sanitized: string;
      parsed: ParsedTocResult;
      noiseScore: number;
      candidateLineCount: number;
      sectionCount: number;
      sparseSectionCoverage: boolean;
      missingChapterStarts: boolean;
      missingHeadingSignals: boolean;
      missingHeadingCount: number;
      garbageDetected: boolean;
      entryCount: number;
      anchorSignalScore: number;
      densePenalty: number;
      isGoodEnough: boolean;
    } => {
      const sanitized = sanitizeTocDraftText(candidateText);
      const parsed = parseTocFromOcrText(sanitized);
      const noiseScore = scoreTocNoise(candidateText);
      const candidateLineCount = sanitized
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => /^(unit|module|chapter|ch\.?|lesson)\b/i.test(line) || /^[0-9]+(?:\.[0-9]+)+\s+/.test(line) || /\s+\d+$/.test(line))
        .length;
      const sectionCount = parsed.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
      const sparseSectionCoverage = parsed.chapters.length > 0
        && candidateLineCount >= 5
        && sectionCount <= Math.max(1, parsed.chapters.length);
      const missingChapterStarts = parsed.chapters.some((chapter) => typeof chapter.pageStart !== "number");
      const headingSignals = extractChapterHeadingOrdinals(candidateText);
      const parsedHeadings = new Set(
        parsed.chapters
          .map((chapter) => parseChapterOrdinalToken(String(chapter.chapterNumber ?? "")))
          .filter((value): value is number => typeof value === "number")
      );
      const missingHeadingCount = headingSignals.filter((heading) => !parsedHeadings.has(heading)).length;
      const missingHeadingSignals = missingHeadingCount > 0;
      const garbageDetected = hasImmediateTocGarbageSignals(candidateText);
      const entryCount = parsed.chapters.reduce((sum, chapter) => sum + 1 + chapter.sections.length, 0);
      const anchorSignalScore = scoreTocAnchorSignals(candidateText);
      const densePenalty = entryCount >= 24 ? 1 : 0;
      const isGoodEnough = noiseScore < 0.25
        && !garbageDetected
        && parsed.confidence >= 0.9
        && !missingChapterStarts
        && !missingHeadingSignals
        && !sparseSectionCoverage
        && anchorSignalScore >= 3
        && densePenalty === 0;
      return {
        sanitized,
        parsed,
        noiseScore,
        candidateLineCount,
        sectionCount,
        sparseSectionCoverage,
        missingChapterStarts,
        missingHeadingSignals,
        missingHeadingCount,
        garbageDetected,
        entryCount,
        anchorSignalScore,
        densePenalty,
        isGoodEnough,
      };
    };

    const primary = evaluateCandidate(selectedTocText);

    const shouldAttemptRescue = primary.noiseScore >= 0.45
      || primary.parsed.confidence < 0.9
      || primary.missingChapterStarts
      || primary.missingHeadingSignals
      || primary.garbageDetected
      || primary.sparseSectionCoverage;

    const tocRuntimeOptions = await getTocOcrRuntimeOptions();

    if (shouldAttemptRescue) {
      try {
        setOcrProgressMessage("Analyzing image - garbage/noise detected in TOC text, rescanning immediately...");
        setIsRunningOcr(true);
        const maxRescuePasses = primary.garbageDetected ? 3 : 2;
        let bestText = selectedTocText;
        let bestProviderId = selectedProviderId;
        let bestQuality = primary;

        for (let rescuePass = 1; rescuePass <= maxRescuePasses; rescuePass += 1) {
          if (rescuePass > 1) {
            await waitForOcrGap(TOC_SAMPLE_GAP_MS);
          }
          const rescue = await extractTextFromImageWithFallback(captured.imageDataUrl, {
            ...tocRuntimeOptions,
            providerOrder: TOC_RESCUE_PROVIDER_ORDER,
          });
          const mergedCandidate = mergeTocTextByLineQuality(bestText, rescue.text);
          const rescueQuality = evaluateCandidate(rescue.text);
          const mergedQuality = evaluateCandidate(mergedCandidate);

          const rescueLooksStronger = rescueQuality.noiseScore < bestQuality.noiseScore
            || rescueQuality.parsed.confidence > bestQuality.parsed.confidence
            || rescueQuality.entryCount > bestQuality.entryCount
            || (bestQuality.missingChapterStarts && !rescueQuality.missingChapterStarts)
            || (bestQuality.missingHeadingSignals && !rescueQuality.missingHeadingSignals)
            || rescueQuality.missingHeadingCount < bestQuality.missingHeadingCount
            || (bestQuality.garbageDetected && !rescueQuality.garbageDetected);

          const mergedLooksStronger = mergedQuality.noiseScore < bestQuality.noiseScore
            || mergedQuality.parsed.confidence > bestQuality.parsed.confidence
            || mergedQuality.entryCount > bestQuality.entryCount
            || (bestQuality.missingChapterStarts && !mergedQuality.missingChapterStarts)
            || (bestQuality.missingHeadingSignals && !mergedQuality.missingHeadingSignals)
            || mergedQuality.missingHeadingCount < bestQuality.missingHeadingCount
            || (bestQuality.garbageDetected && !mergedQuality.garbageDetected);

          if (rescueLooksStronger || mergedLooksStronger) {
            rescueApplied = true;

            if (mergedLooksStronger && (!rescueLooksStronger || mergedQuality.parsed.confidence >= rescueQuality.parsed.confidence)) {
              bestText = mergedCandidate;
              bestProviderId = rescue.providerId;
              bestQuality = mergedQuality;
            } else {
              bestText = rescue.text;
              bestProviderId = rescue.providerId;
              bestQuality = rescueQuality;
            }
          }

          if (bestQuality.isGoodEnough) {
            break;
          }
        }

        if (rescueApplied) {
          selectedTocText = bestText;
          selectedProviderId = bestProviderId;

          appendDebugLogEntry({
            eventType: "warning",
            message: "TOC OCR rescue path selected cleaner text.",
            autoModeStep: "toc",
            context: {
              originalProviderId: captured.ocrProviderId,
              rescueProviderId: bestProviderId,
              primaryNoiseScore: primary.noiseScore,
              rescueNoiseScore: bestQuality.noiseScore,
              primaryConfidence: primary.parsed.confidence,
              rescueConfidence: bestQuality.parsed.confidence,
              primaryMissingChapterStarts: primary.missingChapterStarts,
              rescueMissingChapterStarts: bestQuality.missingChapterStarts,
              primaryGarbageDetected: primary.garbageDetected,
              rescueGarbageDetected: bestQuality.garbageDetected,
            },
          });
        }
      } catch {
        // Best effort rescue path.
      } finally {
        setIsRunningOcr(false);
      }
    }

    let bestText = selectedTocText;
    let bestProviderId = selectedProviderId;
    let bestQuality = evaluateCandidate(bestText);
    let processedSamples = 1;

    const selectStrongerTocCandidate = (
      currentBest: {
        text: string;
        providerId: string;
        quality: ReturnType<typeof evaluateCandidate>;
      },
      nextCandidate: {
        text: string;
        providerId: string;
        quality: ReturnType<typeof evaluateCandidate>;
      }
    ) => {
      const next = nextCandidate.quality;
      const best = currentBest.quality;

      const nextIsStronger = next.isGoodEnough && !best.isGoodEnough
        || next.anchorSignalScore > best.anchorSignalScore
        || next.densePenalty < best.densePenalty
        || next.parsed.confidence > best.parsed.confidence
        || next.entryCount > best.entryCount
        || next.sectionCount > best.sectionCount
        || (best.sparseSectionCoverage && !next.sparseSectionCoverage)
        || (best.missingChapterStarts && !next.missingChapterStarts)
        || (best.missingHeadingSignals && !next.missingHeadingSignals)
        || next.missingHeadingCount < best.missingHeadingCount
        || (best.garbageDetected && !next.garbageDetected)
        || next.noiseScore < best.noiseScore;

      if (!nextIsStronger) {
        return currentBest;
      }

      return {
        text: nextCandidate.text,
        providerId: nextCandidate.providerId,
        quality: nextCandidate.quality,
      };
    };

    try {
      const ocrSettingsManager = await getBrowserOcrSettingsManager();
      const ocrSettings = await ocrSettingsManager.getSettings();
      const samplingVariants = await buildTocSamplingVariants(captured.imageDataUrl, {
        shots: ocrSettings.shots,
        cropStrategy: ocrSettings.cropStrategy,
      });

      setIsRunningOcr(true);
      if (samplingVariants.length > 0) {
        for (let index = 0; index < samplingVariants.length; index += 1) {
          const variant = samplingVariants[index];
          if (index > 0) {
            await waitForOcrGap(TOC_SAMPLE_GAP_MS);
          }
          setOcrProgressMessage(`TOC sampling ${index + 1}/${samplingVariants.length}: ${variant.label}.`);

          const sample = await extractTextFromImageWithFallback(variant.imageDataUrl, {
            ...tocRuntimeOptions,
            providerOrder: TOC_RESCUE_PROVIDER_ORDER,
          });
          const sampleQuality = evaluateCandidate(sample.text);

          const stronger = selectStrongerTocCandidate(
            {
              text: bestText,
              providerId: bestProviderId,
              quality: bestQuality,
            },
            {
              text: sample.text,
              providerId: sample.providerId,
              quality: sampleQuality,
            },
          );

          bestText = stronger.text;
          bestProviderId = stronger.providerId;
          bestQuality = stronger.quality;
          processedSamples += 1;
        }

        if (bestQuality.missingHeadingSignals) {
          await waitForOcrGap(TOC_SAMPLE_GAP_MS);
          setOcrProgressMessage("TOC recovery: chapter heading(s) were detected in OCR but missing from parse. Running recovery pass...");
          const recoverySample = await extractTextFromImageWithFallback(captured.imageDataUrl, {
            ...tocRuntimeOptions,
            providerOrder: TOC_RESCUE_PROVIDER_ORDER,
          });
          const recoveryQuality = evaluateCandidate(recoverySample.text);
          const mergedRecoveryText = mergeTocTextByLineQuality(bestText, recoverySample.text);
          const mergedRecoveryQuality = evaluateCandidate(mergedRecoveryText);

          const recoveryLooksStronger = recoveryQuality.parsed.confidence > bestQuality.parsed.confidence
            || recoveryQuality.entryCount > bestQuality.entryCount
            || (bestQuality.missingHeadingSignals && !recoveryQuality.missingHeadingSignals)
            || recoveryQuality.missingHeadingCount < bestQuality.missingHeadingCount;

          const mergedRecoveryLooksStronger = mergedRecoveryQuality.parsed.confidence > bestQuality.parsed.confidence
            || mergedRecoveryQuality.entryCount > bestQuality.entryCount
            || (bestQuality.missingHeadingSignals && !mergedRecoveryQuality.missingHeadingSignals)
            || mergedRecoveryQuality.missingHeadingCount < bestQuality.missingHeadingCount;

          if (mergedRecoveryLooksStronger || recoveryLooksStronger) {
            if (mergedRecoveryLooksStronger && (!recoveryLooksStronger || mergedRecoveryQuality.parsed.confidence >= recoveryQuality.parsed.confidence)) {
              bestText = mergedRecoveryText;
              bestProviderId = recoverySample.providerId;
              bestQuality = mergedRecoveryQuality;
            } else {
              bestText = recoverySample.text;
              bestProviderId = recoverySample.providerId;
              bestQuality = recoveryQuality;
            }
          }
        }
      }
    } catch {
      // Best effort only. The baseline full shot still stands.
    } finally {
      setIsRunningOcr(false);
    }

    const sampledTocText = sanitizeTocDraftText(bestText);
    const existingTocDraft = ocrBuffersByStepRef.current.toc.draft;
    const safeExistingTocDraft = isLikelyTocText(existingTocDraft) ? existingTocDraft : "";
    const baselineTocText = lastTocCaptureOcrRef.current.trim().length > 0
      ? lastTocCaptureOcrRef.current
      : safeExistingTocDraft;
    const mergedTocText = baselineTocText.trim().length > 0
      ? mergeOcrTextWithOverlap(baselineTocText, sampledTocText)
      : sampledTocText;
    const stitchedTocImage = tocCaptureImageDataUrl
      ? await stitchCueImagesWithOverlap(tocCaptureImageDataUrl, captured.imageDataUrl)
      : captured.imageDataUrl;

    const incomingParsed = parseTocFromOcrText(mergedTocText);
    const previousParsed = parseTocFromOcrText(existingTocDraft);
    const novelEntries = countNovelTocEntries(previousParsed, incomingParsed);

    lastTocCaptureOcrRef.current = sampledTocText;
    updateStepOcrBuffers("toc", sampledTocText, mergedTocText);
    setRawOcrText(bestText);
    setOcrDraft(mergedTocText);
    setTocCaptureImageDataUrl(stitchedTocImage);
    setOcrProviderStatus(`OCR provider: ${bestProviderId}${rescueApplied ? " (rescanned due to noisy text)" : ""}`);
    setStep("toc");
    applyTocFromText(mergedTocText);
    bumpTocPreviewExpansion("expand-latest");

    if (novelEntries > 0) {
      setInfoMessage(`TOC capture added and overlap-stitched. ${novelEntries} new TOC entries were detected after ${processedSamples} sample(s). (OCR: ${bestProviderId}${rescueApplied ? ", auto-rescanned" : ""})`);
      return;
    }

    setInfoMessage(`TOC capture overlap-stitched, but no new TOC entries were detected after ${processedSamples} sample(s). Try moving further before the next capture. (OCR: ${bestProviderId}${rescueApplied ? ", auto-rescanned" : ""})`);
    }, {
      step,
      chapterCount: tocResult.chapters.length,
    });
  }

  function countNovelTocEntries(base: ParsedTocResult, incoming: ParsedTocResult): number {
    const chapterKeys = new Set(base.chapters.map((chapter) => `${chapter.chapterNumber}|${chapter.title.toLowerCase()}`));
    const sectionKeys = new Set(
      base.chapters.flatMap((chapter) => chapter.sections.map((section) => `${section.sectionNumber}|${section.title.toLowerCase()}`))
    );

    let novelCount = 0;
    incoming.chapters.forEach((chapter) => {
      const chapterKey = `${chapter.chapterNumber}|${chapter.title.toLowerCase()}`;
      if (!chapterKeys.has(chapterKey)) {
        novelCount += 1;
      }

      chapter.sections.forEach((section) => {
        const sectionKey = `${section.sectionNumber}|${section.title.toLowerCase()}`;
        if (!sectionKeys.has(sectionKey)) {
          novelCount += 1;
        }
      });
    });

    return novelCount;
  }

  function updateChapter(index: number, update: Partial<TocChapter>): void {
    setTocResult((current) => {
      const chapters = current.chapters.map((chapter, chapterIndex) => {
        if (chapterIndex !== index) {
          return chapter;
        }

        return {
          ...chapter,
          ...update,
        };
      });

      return { ...current, chapters };
    });
  }

  function updateSection(
    chapterIndex: number,
    sectionIndex: number,
    update: { sectionNumber?: string; title?: string; pageStart?: number; pageEnd?: number }
  ): void {
    setTocResult((current) => {
      const chapters = current.chapters.map((chapter, currentChapterIndex) => {
        if (currentChapterIndex !== chapterIndex) {
          return chapter;
        }

        const sections = chapter.sections.map((section, currentSectionIndex) => {
          if (currentSectionIndex !== sectionIndex) {
            return section;
          }

          return {
            ...section,
            ...update,
          };
        });

        return {
          ...chapter,
          sections,
        };
      });

      return { ...current, chapters };
    });
  }

  function mergeWithPreviousChapter(chapterIndex: number): void {
    void executeGuiCliBoundCommand("courseforge textbooks auto toc merge chapter", () => {
      setTocResult((current) => {
        if (chapterIndex <= 0 || chapterIndex >= current.chapters.length) {
          return current;
        }

        const previous = current.chapters[chapterIndex - 1];
        const target = current.chapters[chapterIndex];
        const merged: TocChapter = {
          ...previous,
          title: `${previous.title} / ${target.title}`,
          sections: [...previous.sections, ...target.sections],
        };

        const next = [...current.chapters];
        next.splice(chapterIndex - 1, 2, merged);
        return { ...current, chapters: next };
      });
    }, {
      chapterIndex,
    });
  }

  function splitChapter(chapterIndex: number): void {
    void executeGuiCliBoundCommand("courseforge textbooks auto toc split chapter", () => {
      setTocResult((current) => {
        const chapter = current.chapters[chapterIndex];
        if (!chapter || chapter.sections.length < 2) {
          return current;
        }

        const splitIndex = Math.floor(chapter.sections.length / 2);
        const left: TocChapter = {
          ...chapter,
          title: `${chapter.title} (Part 1)`,
          sections: chapter.sections.slice(0, splitIndex),
        };
        const right: TocChapter = {
          ...chapter,
          title: `${chapter.title} (Part 2)`,
          sections: chapter.sections.slice(splitIndex),
        };

        const next = [...current.chapters];
        next.splice(chapterIndex, 1, left, right);
        return { ...current, chapters: next };
      });
    }, {
      chapterIndex,
    });
  }

  function deleteChapter(chapterIndex: number): void {
    void executeGuiCliBoundCommand("courseforge textbooks auto toc delete chapter", () => {
      setTocResult((current) => {
        if (chapterIndex < 0 || chapterIndex >= current.chapters.length) {
          return current;
        }

        const next = [...current.chapters];
        next.splice(chapterIndex, 1);
        return { ...current, chapters: next };
      });
    }, {
      chapterIndex,
    });
  }

  function deleteSection(chapterIndex: number, sectionIndex: number): void {
    void executeGuiCliBoundCommand("courseforge textbooks auto toc delete section", () => {
      setTocResult((current) => {
        const chapter = current.chapters[chapterIndex];
        if (!chapter || sectionIndex < 0 || sectionIndex >= chapter.sections.length) {
          return current;
        }

        const chapters = current.chapters.map((entry, currentChapterIndex) => {
          if (currentChapterIndex !== chapterIndex) {
            return entry;
          }

          const sections = [...entry.sections];
          sections.splice(sectionIndex, 1);
          return {
            ...entry,
            sections,
          };
        });

        return {
          ...current,
          chapters,
        };
      });
    }, {
      chapterIndex,
      sectionIndex,
    });
  }

  function handlePreviewNodeUpdate(
    node: TocPreviewNodeModel,
    update: { numberValue: string; title: string; pageStart?: number }
  ): void {
    if (node.level === "chapter") {
      updateChapter(node.chapterIndex, {
        chapterNumber: update.numberValue,
        title: update.title,
        pageStart: update.pageStart,
      });
      return;
    }

    if (typeof node.sectionIndex !== "number") {
      return;
    }

    updateSection(node.chapterIndex, node.sectionIndex, {
      sectionNumber: update.numberValue,
      title: update.title,
      pageStart: update.pageStart,
    });
  }

  function handleRegenerateNodeFromImage(node: TocPreviewNodeModel): void {
    setInfoMessage(`Regenerating ${node.level} from a new TOC image capture. Capture the page containing this node next.`);
    void handleCaptureToc();
  }

  function updateSaveUploadProgress(percent: number, detail: string): void {
    const nextPercent = Math.max(0, Math.min(100, Math.trunc(percent)));
    setSaveUploadProgress({
      visible: true,
      percent: nextPercent,
      detail,
    });
  }

  async function restoreTocFromSavedTextbookHierarchy(
    metadataSnapshot: MetadataFormState | undefined,
    fallbackTitle: string | undefined
  ): Promise<{ result: ParsedTocResult; pages: TocPage[] } | null> {
    const normalize = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
    const selectNewest = (items: Textbook[]): Textbook | undefined => {
      if (items.length === 0) {
        return undefined;
      }

      return [...items].sort((left, right) => {
        const leftTime = Date.parse(left.lastModified ?? "");
        const rightTime = Date.parse(right.lastModified ?? "");
        const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
        const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
        return rightSafe - leftSafe;
      })[0];
    };

    const isbnRaw = metadataSnapshot?.isbnRaw?.trim() ?? "";
    const normalizedIsbn = normalizeISBN(isbnRaw);
    const title = metadataSnapshot?.title?.trim() || fallbackTitle?.trim() || "";
    const normalizedTitle = normalize(title);
    const normalizedGrade = normalize(metadataSnapshot?.grade);
    if (!isbnRaw && !title) {
      return null;
    }

    const publicationYearParsed = Number.parseInt(metadataSnapshot?.publicationYear ?? "", 10);
    let match: Textbook | undefined;
    if (normalizedIsbn.length > 0) {
      match = await findTextbookByISBN(isbnRaw);
    }

    if (!match) {
      match = await findDuplicateTextbook({
        isbnRaw,
        title,
        grade: metadataSnapshot?.grade ?? "",
        publisher: metadataSnapshot?.publisher ?? "",
        seriesName: metadataSnapshot?.seriesName ?? "",
        publicationYear: Number.isFinite(publicationYearParsed) ? publicationYearParsed : undefined,
      });
    }

    if (!match && normalizedTitle.length > 0) {
      const textbooks = (await fetchTextbooks()).filter((entry) => !entry.isDeleted);
      const titleMatches = textbooks.filter((entry) => normalize(entry.title) === normalizedTitle);
      const sameGradeMatches = normalizedGrade.length > 0
        ? titleMatches.filter((entry) => normalize(entry.grade) === normalizedGrade)
        : titleMatches;
      const sameYearMatches = Number.isFinite(publicationYearParsed)
        ? sameGradeMatches.filter((entry) => entry.publicationYear === publicationYearParsed)
        : sameGradeMatches;

      match = selectNewest(sameYearMatches)
        ?? selectNewest(sameGradeMatches)
        ?? selectNewest(titleMatches);
    }

    if (!match?.id) {
      return null;
    }

    const chapters = await fetchChaptersByTextbookId(match.id);
    if (chapters.length === 0) {
      return null;
    }

    const sortedChapters = [...chapters].sort((left, right) => left.index - right.index);
    const sectionsByChapterId = new Map<string, Section[]>();
    for (const chapter of sortedChapters) {
      const sections = await fetchSectionsByChapterId(chapter.id);
      sectionsByChapterId.set(
        chapter.id,
        [...sections].sort((left, right) => left.index - right.index)
      );
    }

    const tocChapters: TocChapter[] = sortedChapters.map((chapter: Chapter, chapterIndex) => {
      const chapterNumberValue = Number.isInteger(chapter.index) && chapter.index > 0
        ? chapter.index
        : chapterIndex + 1;
      const chapterNumber = String(chapterNumberValue);
      const chapterSections = sectionsByChapterId.get(chapter.id) ?? [];

      return {
        chapterNumber,
        title: chapter.name?.trim() || `Chapter ${chapterNumber}`,
        sections: chapterSections.map((section, sectionIndex) => {
          const sectionNumberValue = Number.isInteger(section.index) && section.index > 0
            ? section.index
            : sectionIndex + 1;

          return {
            sectionNumber: `${chapterNumber}.${sectionNumberValue}`,
            title: section.title,
          };
        }),
      };
    });

    const result: ParsedTocResult = {
      chapters: tocChapters,
      confidence: 0,
    };

    return {
      result,
      pages: [{
        pageIndex: 0,
        chapters: tocChapters,
        confidence: 0,
      }],
    };
  }

  async function handleSaveAutoSetup(): Promise<void> {
    await executeGuiCliBoundCommand("courseforge textbooks auto save setup", async () => {
    const traceId = createAutoFlowTraceId("auto-flow-save");
    emitAutoFlowDiagnostic("save_started", {
      traceId,
      context: {
        chapterCount: tocResult.chapters.length,
        hasCover: Boolean(coverImageDataUrl),
        duplicateMatchId: duplicateMatch?.id ?? null,
      },
    });
    setErrorMessage(null);
    updateSaveUploadProgress(5, "Preparing textbook save...");

    const parsedYear = Number(metadataForm.publicationYear);
    if (!Number.isInteger(parsedYear) || parsedYear <= 0) {
      setErrorMessage("Publication year must be a valid whole number.");
      setSaveUploadProgress({ visible: false, percent: 0, detail: "" });
      emitAutoFlowDiagnostic("save_validation_failed", {
        level: "warning",
        traceId,
        context: { reason: "invalid_publication_year", value: metadataForm.publicationYear },
      });
      return;
    }

    if (!metadataForm.title.trim()) {
      setErrorMessage("Title is required before saving.");
      setSaveUploadProgress({ visible: false, percent: 0, detail: "" });
      emitAutoFlowDiagnostic("save_validation_failed", {
        level: "warning",
        traceId,
        context: { reason: "missing_title" },
      });
      return;
    }

    if (!coverImageDataUrl) {
      setErrorMessage("Capture and accept a cover image before saving Auto setup.");
      setSaveUploadProgress({ visible: false, percent: 0, detail: "" });
      emitAutoFlowDiagnostic("save_validation_failed", {
        level: "warning",
        traceId,
        context: { reason: "missing_cover_image" },
      });
      return;
    }

    const metadata = fromMetadataFormState(metadataForm);
    const latestPipeline = lastMetadataPipelineRef.current;
    const finalMetadataResult = metadataFormToResult(
      metadataForm,
      ocrDraft,
      latestPipeline?.result.source ?? "ocr",
      relatedIsbns
    );

    const changedFromOriginal = didMetadataChange(latestPipeline?.result ?? null, finalMetadataResult);
    queueCorrectionLearningSample("save");

    if (!changedFromOriginal) {
      appendDebugLogEntry({
        eventType: "user_action",
        message: "Metadata accepted without edits; logged as high-confidence sample.",
        autoModeStep: lastMetadataCaptureStepRef.current,
      });
    }

    try {
      setIsBusy(true);
      updateSaveUploadProgress(12, "Validating capture and moderation checks...");

      const moderationContext = [
        metadataForm.title,
        metadataForm.subtitle,
        metadataForm.subject,
        metadataForm.seriesName,
        metadataForm.publisher,
        metadataForm.authorsCsv,
        ocrDraft,
      ].filter(Boolean).join("\n");

      const imageModeration = testingSeedState?.bypassImageModeration
        ? {
            decision: "allow" as const,
            confidence: 0,
            reason: "Bypassed in integration test mode.",
            educationalContextDetected: true,
            skinToneRatio: 0,
          }
        : assessImageModerationSignal({
            skinToneRatio: await estimateSkinToneRatio(coverImageDataUrl),
            contextText: moderationContext,
          });
      setModerationAssessment(imageModeration);

      if (imageModeration.decision === "block") {
        setErrorMessage(
          "Capture blocked by image safety checks. This appears to contain explicit imagery without educational context."
        );
        emitAutoFlowDiagnostic("save_blocked_by_moderation", {
          level: "warning",
          traceId,
          context: {
            decision: imageModeration.decision,
            reason: imageModeration.reason,
          },
        });
        setSaveUploadProgress({ visible: false, percent: 0, detail: "" });
        return;
      }

      const requiresAdminReview = imageModeration.decision === "review";

      const trimmedIsbn = metadataForm.isbnRaw.trim();
      const existingDuplicate = await findDuplicateTextbook({
        isbnRaw: trimmedIsbn,
        title: metadataForm.title.trim(),
        publisher: metadata.publisher,
        seriesName: metadata.seriesName,
        publicationYear: parsedYear || undefined,
      });

      if (existingDuplicate && duplicateMatch?.id !== existingDuplicate.id) {
        setDuplicateMatch({
          id: existingDuplicate.id,
          title: existingDuplicate.title,
          isbnRaw: existingDuplicate.isbnRaw,
        });
        setInfoMessage("A textbook with this ISBN already exists. Choose how to apply Auto data, then save again.");
        emitAutoFlowDiagnostic("save_duplicate_detected", {
          level: "warning",
          traceId,
          context: {
            duplicateId: existingDuplicate.id,
            isbn: trimmedIsbn,
          },
        });
        setSaveUploadProgress({ visible: false, percent: 0, detail: "" });
        return;
      }

      updateSaveUploadProgress(30, "Saving textbook data locally...");

      const nextTextbookChanges = {
        originalLanguage: language,
        sourceType: "auto" as const,
        title: metadataForm.title.trim(),
        subtitle: metadata.subtitle,
        grade: metadataForm.grade,
        gradeBand: metadata.gradeBand,
        subject: metadataForm.subject,
        edition: metadataForm.edition,
        publicationYear: parsedYear,
        copyrightYear: metadata.copyrightYear,
        isbnRaw: metadataForm.isbnRaw,
        additionalIsbns: metadata.additionalIsbns,
        relatedIsbns: relatedIsbns.filter((entry) => entry.isbn.trim().length > 0),
        seriesName: metadata.seriesName,
        publisher: metadata.publisher,
        publisherLocation: metadata.publisherLocation,
        mhid: metadata.mhid,
        authors: metadata.authors,
        platformUrl: metadata.platformUrl,
        tocExtractionConfidence: Number(metadataForm.tocExtractionConfidence) || tocResult.confidence,
        imageModerationState: requiresAdminReview ? "pending_admin_review" as const : "clear" as const,
        imageModerationReason: requiresAdminReview ? imageModeration.reason : undefined,
        imageModerationConfidence: imageModeration.confidence,
        cloudSyncBlockedReason: requiresAdminReview ? "pending_admin_review" as const : undefined,
        requiresAdminReview,
        status: requiresAdminReview ? "submitted" as const : "draft" as const,
      };

      if (duplicateMatch) {
        const chapters = await fetchChaptersByTextbookId(duplicateMatch.id);
        const sectionsByChapterId: Record<string, Array<{ id: string; chapterId: string; index: number; title: string }>> = {};

        for (const chapter of chapters) {
          const sections = await fetchSectionsByChapterId(chapter.id);
          sectionsByChapterId[chapter.id] = sections.map((section) => ({
            id: section.id,
            chapterId: chapter.id,
            index: section.index,
            title: section.title,
          }));
        }

        const plan = buildAutoConflictResolutionPlan({
          mode: conflictResolutionMode,
          autoTocChapters: tocResult.chapters,
          existingChapters: chapters.map((chapter) => ({
            id: chapter.id,
            index: chapter.index,
            name: chapter.name,
          })),
          existingSectionsByChapterId: sectionsByChapterId,
        });

        const imageChanges: Record<string, unknown> = {};
        if (coverImageDataUrl) {
          imageChanges.coverImageUrl = await uploadTextbookCoverFromDataUrl(duplicateMatch.id, coverImageDataUrl);
        }
        if (ownershipProofDataUrl) {
          imageChanges.ownershipProofImageUrl = await uploadTextbookOwnershipProofFromDataUrl(duplicateMatch.id, ownershipProofDataUrl);
        }

        await editTextbook(duplicateMatch.id, {
          ...nextTextbookChanges,
          ...imageChanges,
        });

        for (const sectionId of plan.sectionIdsToDelete) {
          const vocabTerms = await fetchVocabTermsBySectionId(sectionId);
          for (const term of vocabTerms) {
            await removeVocabTerm(term.id);
          }

          const equations = await fetchEquationsBySectionId(sectionId);
          for (const equation of equations) {
            await removeEquation(equation.id);
          }

          const concepts = await fetchConceptsBySectionId(sectionId);
          for (const concept of concepts) {
            await removeConcept(concept.id);
          }

          const keyIdeas = await fetchKeyIdeasBySectionId(sectionId);
          for (const keyIdea of keyIdeas) {
            await removeKeyIdea(keyIdea.id);
          }

          await removeSection(sectionId);
        }

        for (const chapterId of plan.chapterIdsToDelete) {
          await removeChapter(chapterId);
        }

        const chapterIdByIndex = new Map<number, string>();

        for (const chapterInstruction of plan.chapterUpserts) {
          const chapterIndexValue = Number.parseInt(chapterInstruction.autoChapter.chapterNumber, 10);
          const chapterPageEnd = chapterInstruction.autoChapter.pageEnd ?? getChapterDerivedPageEnd(tocResult.chapters, chapterInstruction.chapterIndex);
          const chapterPayload = {
            sourceType: "auto" as const,
            index: Number.isInteger(chapterIndexValue) ? chapterIndexValue : chapterInstruction.chapterIndex + 1,
            name: chapterInstruction.autoChapter.title,
            description: buildChapterDescription(
              chapterInstruction.autoChapter.unitName,
              chapterInstruction.autoChapter.pageStart,
              chapterPageEnd
            ),
          };

          if (chapterInstruction.existingChapterId) {
            await editChapter(chapterInstruction.existingChapterId, chapterPayload);
            chapterIdByIndex.set(chapterInstruction.chapterIndex, chapterInstruction.existingChapterId);
            continue;
          }

          const createdId = await createChapter({
            textbookId: duplicateMatch.id,
            ...chapterPayload,
          });
          chapterIdByIndex.set(chapterInstruction.chapterIndex, createdId);
        }

        for (const sectionInstruction of plan.sectionUpserts) {
          const chapterId = chapterIdByIndex.get(sectionInstruction.chapterRef.chapterIndex);
          if (!chapterId) {
            continue;
          }

          const sourceSection = tocResult.chapters[sectionInstruction.chapterRef.chapterIndex]?.sections[sectionInstruction.sectionIndex];

          const sectionPayload = {
            sourceType: "auto" as const,
            index: sectionInstruction.sectionIndex + 1,
            title: sectionInstruction.sectionTitle,
            notes: buildSectionNotes(
              sourceSection?.pageStart,
              sourceSection?.pageEnd ?? getSectionDerivedPageEnd(
                tocResult.chapters[sectionInstruction.chapterRef.chapterIndex],
                sectionInstruction.sectionIndex,
              )
            ),
          };

          if (sectionInstruction.existingSectionId) {
            await editSection(sectionInstruction.existingSectionId, sectionPayload);
            continue;
          }

          await createSection({
            chapterId,
            ...sectionPayload,
          });
        }
      } else {
        await persistAutoTextbook(
          {
            metadata: {
              ...nextTextbookChanges,
            },
            coverDataUrl: coverImageDataUrl,
            ownershipProofDataUrl: ownershipProofDataUrl ?? undefined,
            tocChapters: tocResult.chapters,
          },
          {
            createTextbook,
            createChapter,
            createSection,
          }
        );
      }

      updateSaveUploadProgress(60, "Textbook saved locally. Starting cloud upload...");

      let savedDraftArtifactsCleared = false;
      const clearSavedDraftArtifacts = (): void => {
        if (savedDraftArtifactsCleared) {
          return;
        }

        deleteAutoExtractionCheckpoint(activeSessionDraftIdRef.current);
        clearPersistedCaptureUsage(draftKeyRef.current);
        setResumableDrafts(deleteAutoSessionDraft(activeSessionDraftIdRef.current));
        activeSessionDraftIdRef.current = createAutoFlowTraceId("auto-draft");
        savedDraftArtifactsCleared = true;
      };

      // Clear Auto Add draft immediately after local save succeeds, before upload starts.
      // This ensures the Auto Add queue won't have a stale entry if cloud upload fails.
      clearSavedDraftArtifacts();

      appendDebugLogEntry({
        eventType: "user_action",
        message: "Auto textbook setup saved.",
        autoModeStep: "toc",
        context: {
          chapterCount: tocResult.chapters.length,
          requiresAdminReview,
        },
      });

      if (requiresAdminReview) {
        setInfoMessage(
          "Saved locally with admin review required. Cloud sync is blocked until this textbook is approved by an admin."
        );
      }

      if (duplicateMatch) {
        setInfoMessage(
          conflictResolutionMode === "overwrite_auto"
            ? "Existing textbook replaced with Auto metadata and hierarchy."
            : "Existing textbook merged with Auto metadata and TOC. Duplicates were avoided."
        );
        setDuplicateMatch(null);
      }

      if (!requiresAdminReview) {
        updateSaveUploadProgress(72, "Cloud upload started.");
        void (async () => {
          try {
            const runImmediateSyncAttempt = async () => {
              return Promise.race([
                syncNow({ superAdminSyncBypass: isSuperAdmin }),
                new Promise<null>((resolve) => {
                  setTimeout(() => resolve(null), IMMEDIATE_UPLOAD_SYNC_TIMEOUT_MS);
                }),
              ]);
            };

            const immediateSyncResult = await runImmediateSyncAttempt();

            if (!immediateSyncResult) {
              updateSaveUploadProgress(86, "Upload started. Waiting for cloud response...");
              setInfoMessage((current) => (
                current
                  ? `${current} Cloud upload is still running and will retry automatically if needed.`
                  : "Saved locally. Cloud upload is still running and will retry automatically if needed."
              ));
            } else if (immediateSyncResult.throttled) {
              updateSaveUploadProgress(80, "Upload queued. Waiting for sync window...");
              await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), IMMEDIATE_UPLOAD_SYNC_RETRY_DELAY_MS);
              });

              const retrySyncResult = await runImmediateSyncAttempt();

              if (!retrySyncResult) {
                updateSaveUploadProgress(90, "Upload started. Sync pending retry.");
                setInfoMessage((current) => (
                  current
                    ? `${current} Cloud upload still pending and will retry automatically.`
                    : "Saved locally. Cloud upload still pending and will retry automatically."
                ));
              } else if (!retrySyncResult.success) {
                updateSaveUploadProgress(90, "Upload started. Sync pending retry.");
                setInfoMessage((current) => (
                  current
                    ? `${current} Cloud upload pending: ${retrySyncResult.message}`
                    : `Saved locally. Cloud upload pending: ${retrySyncResult.message}`
                ));
              } else {
                updateSaveUploadProgress(100, "Upload complete.");
              }
            } else if (!immediateSyncResult.success) {
              updateSaveUploadProgress(90, "Upload started. Sync pending retry.");
              setInfoMessage((current) => (
                current
                  ? `${current} Cloud upload pending: ${immediateSyncResult.message}`
                  : `Saved locally. Cloud upload pending: ${immediateSyncResult.message}`
              ));
            } else {
              updateSaveUploadProgress(100, "Upload complete.");
            }
          } catch {
            updateSaveUploadProgress(90, "Upload started. Retrying in background.");
            setInfoMessage((current) => (
              current
                ? `${current} Cloud upload will retry automatically.`
                : "Saved locally. Cloud upload will retry automatically."
            ));
          }
        })();
      } else {
        updateSaveUploadProgress(100, "Saved locally. Upload blocked pending admin review.");
      }

      if (isMetadataCorrectionSharingEnabled()) {
        void syncMetadataCorrectionLearning({
          optedIn: true,
          maxPushRecords: 30,
        }).then((syncResult) => {
          if (syncResult.message) {
            setInfoMessage((current) => (current ? `${current} ${syncResult.message}` : syncResult.message));
          }
        }).catch(() => {
          // Metadata-learning sync is best-effort and should not block textbook save.
        });
      }

      onSaved();
      emitAutoFlowDiagnostic("save_completed", {
        traceId,
        context: {
          chapterCount: tocResult.chapters.length,
          duplicateResolved: Boolean(duplicateMatch),
          requiresAdminReview,
        },
      });
    } catch {
      setErrorMessage("Unable to save Auto setup. Please verify metadata and try again.");
      updateSaveUploadProgress(0, "Save failed before upload could start.");
      emitAutoFlowDiagnostic("save_failed", {
        level: "error",
        traceId,
      });
      appendDebugLogEntry({
        eventType: "error",
        message: "Auto textbook setup save failed.",
        autoModeStep: "toc",
      });
    } finally {
      setIsBusy(false);
    }
    }, {
      chapterCount: tocResult.chapters.length,
      hasCover: Boolean(coverImageDataUrl),
      title: metadataForm.title,
    });
  }

  return (
    <section className={`panel auto-textbook-flow${compactChromeLayout ? " auto-textbook-flow--chromeos-compact" : ""}`}>
      {/* â”€â”€ Session queue (max 3 unfinished auto captures) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div
        className={`auto-session-resume${resumableDrafts.length === 0 ? " auto-session-resume--collapsed" : ""}`}
        role="complementary"
        aria-label="Resume previous Auto sessions"
      >
        <p className="auto-session-resume__title">Auto Mode Queue ({resumableDrafts.length}/{MAX_AUTO_SESSION_DRAFTS})</p>
        {resumableDrafts.length > 0 ? (
          <>
            <div className="auto-session-slots" aria-label="Auto capture queue slots">
              {Array.from({ length: MAX_AUTO_SESSION_DRAFTS }).map((_, index) => {
                const draft = resumableDrafts[index] ?? null;
                if (!draft) {
                  return (
                    <div key={`auto-slot-empty-${index}`} className="auto-session-slot auto-session-slot--empty" aria-label={`Queue slot ${index + 1} empty`}>
                      <span className="auto-session-slot__placeholder" aria-hidden="true">{"\u{1F4D8}"}</span>
                      <p className="auto-session-slot__hint">Empty</p>
                    </div>
                  );
                }

                const draftTitle = draft.metadataTitle?.trim() || "Untitled";
                const draftYear = draft.metadataFormSnapshot?.publicationYear?.trim() || "Year n/a";

                return (
                  <div key={draft.id} className="auto-session-slot" aria-label={`Queue slot ${index + 1} in progress`}>
                    <div className="auto-session-slot__cover" aria-hidden="true">
                      {draft.coverImageDataUrl ? (
                        <img src={draft.coverImageDataUrl} alt="Queued cover thumbnail" className="auto-session-resume__thumb" />
                      ) : (
                        <span className="auto-session-slot__placeholder" aria-hidden="true">{"\u{1F4D8}"}</span>
                      )}
                    </div>

                    <div className="auto-session-slot__text">
                      <p className="auto-session-slot__title" title={draftTitle}>{draftTitle}</p>
                      <p className="auto-session-slot__year">{draftYear}</p>
                      <p className="auto-session-slot__year">
                        Data: {draft.extractionCheckpoint?.pauseReason ? "Paused near usage limit" : "Ready to extract"}
                      </p>
                    </div>

                    <div className="auto-session-slot__actions">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          // Start resumed sessions from clean in-memory OCR state.
                          resetAllOcrRuntimeCaches();
                          activeSessionDraftIdRef.current = draft.id;
                          setCoverImageDataUrl(draft.coverImageDataUrl);
                          setOwnershipProofDataUrl(draft.ownershipProofDataUrl ?? null);
                          setLastMetadataImageDataUrl(draft.ownershipProofDataUrl ?? draft.coverImageDataUrl);
                          updateStepOcrBuffers(toOcrBufferStep(draft.step), "", "");
                          setRawOcrText("");
                          setOcrDraft("");
                          const nextMetadataForm: MetadataFormState = draft.metadataFormSnapshot
                            ? { ...draft.metadataFormSnapshot }
                            : {
                                ...metadataForm,
                                title: draft.metadataTitle || metadataForm.title,
                                subject: draft.metadataSubject || metadataForm.subject,
                                publisher: draft.metadataPublisher || metadataForm.publisher,
                              };
                          const nextRelatedIsbns = draft.relatedIsbnsSnapshot ?? [];

                          setMetadataForm(nextMetadataForm);
                          setRelatedIsbns(nextRelatedIsbns);
                          setMetadataDraft({
                            ...fromMetadataFormState(nextMetadataForm),
                            relatedIsbns: nextRelatedIsbns.filter((entry) => entry.isbn.trim().length > 0),
                          });
                          setTocCaptureImageDataUrl(draft.tocCaptureImageDataUrl ?? null);

                          let restoredTocResult = draft.tocResultSnapshot;
                          let restoredTocPages = draft.tocPagesSnapshot;
                          if (!restoredTocResult || restoredTocResult.chapters.length === 0) {
                            const restoredFromHierarchy = await restoreTocFromSavedTextbookHierarchy(
                              draft.metadataFormSnapshot,
                              draft.metadataTitle
                            );
                            if (restoredFromHierarchy) {
                              restoredTocResult = restoredFromHierarchy.result;
                              restoredTocPages = restoredFromHierarchy.pages;
                              setInfoMessage("Restored existing TOC chapters from saved textbook data. Capture more TOC pages to append additional entries.");
                            }
                          }

                          setTocResult(restoredTocResult ?? INITIAL_TOC_RESULT);
                          setTocPages(restoredTocPages ?? (restoredTocResult ? [{
                            pageIndex: 0,
                            chapters: restoredTocResult.chapters,
                            confidence: restoredTocResult.confidence,
                          }] : []));
                          setGuidedCuePlan(draft.guidedCuePlan ?? createEmptyGuidedCaptureCuePlan());
                          setStep(draft.step);
                          if (draft.extractionCheckpoint) {
                            saveAutoExtractionCheckpoint(draft.extractionCheckpoint);
                          }
                          setResumableDrafts(deleteAutoSessionDraft(draft.id));
                        }}
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={isBusy}
                        onClick={() => {
                          deleteAutoExtractionCheckpoint(draft.id);
                          setResumableDrafts(deleteAutoSessionDraft(draft.id));
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {isSessionCapacityReached ? (
              <p className="error-text">
                Queue full: finish or delete one of the 3 in-progress auto captures before starting another.
              </p>
            ) : null}

            <div className="auto-session-resume__actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={isBusy}
                onClick={() => {
                  clearAutoExtractionCheckpoints();
                  clearAllAutoSessionDrafts();
                  setResumableDrafts([]);
                  resetAllOcrRuntimeCaches();
                }}
              >
                Delete All Drafts
              </button>
            </div>
          </>
        ) : null}
      </div>

      {chromeOs ? (
        <p className="form-hint">{translate(language, "autoMode", "chromeOsBanner")}</p>
      ) : null}

      {step === "title" ? (
        <>
          <p className="form-hint">
            Copyright page capture is always treated as full-page to support future ownership verification against stored textbook metadata.
          </p>
          <div className="capture-tip-callout">
            <span className="capture-tip-callout__icon" aria-hidden="true">{"\u{1F4A1}"}</span>
            <p className="capture-tip-callout__text">
              <strong>Best results tip:</strong> Before capturing, zoom in so the copyright page fills most of your screen - small text is harder for OCR to read accurately. If you zoomed out to see the full page and some fields were missed, try re-capturing at a higher zoom level, or drag &amp; drop a close-up screenshot of just the copyright text.
            </p>
          </div>
        </>
      ) : null}

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      {ocrCooldownExpiryMs > 0 ? (
        <RateLimitCooldownBadge expiryMs={ocrCooldownExpiryMs} />
      ) : null}
      {infoMessage ? <p className="success-text">{infoMessage}</p> : null}
      {moderationAssessment?.decision === "review" ? (
        <p className="form-hint">Image safety review triggered: {moderationAssessment.reason}</p>
      ) : null}
      {ocrProviderStatus && !isRunningOcr ? <p className="form-hint">{ocrProviderStatus}</p> : null}
      {isRunningOcr ? (
        <div className="ocr-loading-banner" role="status" aria-live="polite">
          <span className="ocr-loading-spinner" aria-hidden="true" />
          <span className="ocr-loading-text">{ocrProgressMessage}</span>
        </div>
      ) : null}

      {(step === "cover" || step === "title") && !isRunningOcr && lastExtractionFields.length > 0 ? (
        <div className="extraction-summary" aria-label="Extraction result summary">
          <p className="extraction-summary__header">
            <strong>Fields extracted this capture ({lastExtractionFields.length}):</strong>
          </p>
          <ul className="extraction-summary__list">
            {lastExtractionFields.map((field) => (
              <li key={field} className="extraction-summary__item">
                <span className="extraction-summary__check" aria-hidden="true">{"\u2713"}</span> {field}
              </li>
            ))}
          </ul>
          <p className="form-hint extraction-summary__hint">Scroll down to review and correct each field before clicking <strong>Accept</strong>.</p>
        </div>
      ) : null}

      {step === "cover" ? (
        <div
          className={`cover-drop-zone${isDragOver ? " cover-drop-zone--active" : ""}${isSessionCapacityReached ? " cover-drop-zone--disabled" : ""}`}
          onDragOver={handleCoverDropZoneDragOver}
          onDragLeave={handleCoverDropZoneDragLeave}
          onDrop={handleCoverDropZoneDrop}
          role="region"
          aria-label="Cover image drop zone"
        >
          <p className="cover-drop-zone__hint">Drag &amp; drop a cover image file here, or use the buttons below.</p>
        </div>
      ) : null}

      {step === "title" ? (
        <div
          className={`cover-drop-zone${isTitleDragOver ? " cover-drop-zone--active" : ""}${isSessionCapacityReached ? " cover-drop-zone--disabled" : ""}`}
          onDragOver={handleTitleDropZoneDragOver}
          onDragLeave={handleTitleDropZoneDragLeave}
          onDrop={handleTitleDropZoneDrop}
          role="region"
          aria-label="Copyright page image drop zone"
        >
          <p className="cover-drop-zone__hint">Drag &amp; drop a copyright page image file here, or use the buttons below.</p>
        </div>
      ) : null}

      {duplicateMatch ? (
        <div className="panel" role="group" aria-label="Duplicate textbook resolution">
          <p className="form-hint">
            Existing textbook found: {duplicateMatch.title} (ISBN: {duplicateMatch.isbnRaw || "n/a"}).
          </p>
          <label>
            Resolution mode
            <select
              value={conflictResolutionMode}
              onChange={(event) => setConflictResolutionMode(event.target.value as AutoConflictResolutionMode)}
            >
              <option value="overwrite_auto">Prefer Auto: overwrite existing manual hierarchy</option>
              <option value="merge_dedupe">Merge and dedupe: keep unique manual differences</option>
            </select>
          </label>
          <p className="form-hint">
            Save again to apply this choice.
          </p>
        </div>
      ) : null}

      <input
        ref={coverFileInputRef}
        type="file"
        accept="image/*"
        className="cover-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && !isSessionCapacityReached) void processImageFileForStep(file, "cover");
          event.target.value = "";
        }}
        aria-label="Upload cover image file"
      />

      <input
        ref={titleFileInputRef}
        type="file"
        accept="image/*"
        className="cover-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && !isSessionCapacityReached) void processImageFileForStep(file, "title");
          event.target.value = "";
        }}
        aria-label="Upload copyright page image file"
      />

      <div className="form-actions">
        {step === "cover" ? (
          <>
            <button
              type="button"
              onClick={() => {
                hidePrimaryHelper();
                void handleCaptureCover();
              }}
              disabled={isBusy || isSessionCapacityReached}
              onMouseEnter={(event) => handlePrimaryHelperMouseEnter("capture-cover", event)}
              onMouseMove={handlePrimaryHelperMouseMove}
              onMouseLeave={hidePrimaryHelper}
              onFocus={(event) => handlePrimaryHelperFocus("capture-cover", event)}
              onBlur={hidePrimaryHelper}
              onMouseDown={hidePrimaryHelper}
            >
              Capture Cover
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                hidePrimaryHelper();
                coverFileInputRef.current?.click();
              }}
              disabled={isBusy || isSessionCapacityReached}
              onMouseEnter={(event) => handlePrimaryHelperMouseEnter("upload-cover", event)}
              onMouseMove={handlePrimaryHelperMouseMove}
              onMouseLeave={hidePrimaryHelper}
              onFocus={(event) => handlePrimaryHelperFocus("upload-cover", event)}
              onBlur={hidePrimaryHelper}
              onMouseDown={hidePrimaryHelper}
            >
              Upload Image
            </button>
          </>
        ) : null}

        {step === "title" ? (
          <>
            <button
              type="button"
              onClick={() => {
                hidePrimaryHelper();
                void handleCaptureTitle();
              }}
              disabled={isBusy || isSessionCapacityReached}
              onMouseEnter={(event) => handlePrimaryHelperMouseEnter("capture-title", event)}
              onMouseMove={handlePrimaryHelperMouseMove}
              onMouseLeave={hidePrimaryHelper}
              onFocus={(event) => handlePrimaryHelperFocus("capture-title", event)}
              onBlur={hidePrimaryHelper}
              onMouseDown={hidePrimaryHelper}
            >
              Capture Copyright Page
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                hidePrimaryHelper();
                void handleCaptureTitleAddShot();
              }}
              disabled={isBusy || isSessionCapacityReached || (!rawOcrText.trim() && !ocrDraft.trim())}
            >
              Add Copyright Shot
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                hidePrimaryHelper();
                titleFileInputRef.current?.click();
              }}
              disabled={isBusy || isSessionCapacityReached}
              onMouseEnter={(event) => handlePrimaryHelperMouseEnter("upload-title", event)}
              onMouseMove={handlePrimaryHelperMouseMove}
              onMouseLeave={hidePrimaryHelper}
              onFocus={(event) => handlePrimaryHelperFocus("upload-title", event)}
              onBlur={hidePrimaryHelper}
              onMouseDown={hidePrimaryHelper}
            >
              Upload Copyright Page
            </button>
          </>
        ) : null}

        {step === "toc" ? (
          <>
            <button
              type="button"
              onClick={() => {
                hidePrimaryHelper();
                void handleCaptureToc();
              }}
              disabled={isBusy}
              onMouseEnter={(event) => handlePrimaryHelperMouseEnter("capture-toc", event)}
              onMouseMove={handlePrimaryHelperMouseMove}
              onMouseLeave={hidePrimaryHelper}
              onFocus={(event) => handlePrimaryHelperFocus("capture-toc", event)}
              onBlur={hidePrimaryHelper}
              onMouseDown={hidePrimaryHelper}
            >
              Capture TOC Page
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                hidePrimaryHelper();
                resetDisplayCaptureSession();
                setStep("toc-editor");
              }}
              disabled={!canFinishToc || isBusy}
              onMouseEnter={(event) => handlePrimaryHelperMouseEnter("finish-toc", event)}
              onMouseMove={handlePrimaryHelperMouseMove}
              onMouseLeave={hidePrimaryHelper}
              onFocus={(event) => handlePrimaryHelperFocus("finish-toc", event)}
              onBlur={hidePrimaryHelper}
              onMouseDown={hidePrimaryHelper}
            >
              Finish TOC
            </button>
          </>
        ) : null}

        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            hidePrimaryHelper();
            resetDisplayCaptureSession();
            onSwitchToManual();
          }}
          onMouseEnter={(event) => handlePrimaryHelperMouseEnter("switch-manual", event)}
          onMouseMove={handlePrimaryHelperMouseMove}
          onMouseLeave={hidePrimaryHelper}
          onFocus={(event) => handlePrimaryHelperFocus("switch-manual", event)}
          onBlur={hidePrimaryHelper}
          onMouseDown={hidePrimaryHelper}
        >
          Switch to Manual
        </button>
      </div>

      {(step === "cover" || step === "title" || step === "toc") ? (
        <p className="form-hint">
          Capture support: {captureSupportInfo.label} ({captureSupportInfo.supportLevel}). {captureSupportInfo.guidance}
        </p>
      ) : null}

      {(step === "cover" || step === "title" || step === "toc") && primaryHelperText && primaryHelperAnchor ? (
        <div
          className="auto-primary-helper-tooltip"
          style={{ left: `${primaryHelperAnchor.x}px`, top: `${primaryHelperAnchor.y}px` }}
          role="tooltip"
        >
          {primaryHelperText}
        </div>
      ) : null}

      {hasOcrDraft ? (
        <div className={`ocr-editor-shell${isOcrEditorExpanded ? " ocr-editor-shell--expanded" : " ocr-editor-shell--collapsed"}`}>
          <label className="ocr-editor-shell__label" htmlFor="auto-ocr-editor">OCR text (editable)</label>
          <div className="ocr-editor-shell__textarea-wrap">
            <textarea
              id="auto-ocr-editor"
              ref={ocrTextareaRef}
              className="ocr-editor-shell__textarea"
              rows={isOcrEditorExpanded ? 6 : 3}
              aria-label="OCR text"
              value={ocrDraft}
              onChange={(event) => updateCurrentStepOcrDraft(event.target.value)}
              onClick={() => {
                if (!isOcrEditorExpanded) {
                  setIsOcrEditorExpanded(true);
                }
              }}
              onFocus={() => {
                if (!isOcrEditorExpanded) {
                  setIsOcrEditorExpanded(true);
                }
              }}
              readOnly={!isOcrEditorExpanded}
              placeholder="If the OCR misread something, paste or edit it here before parsing."
            />
            {!isOcrEditorExpanded ? <div className="ocr-editor-shell__fade" aria-hidden="true" /> : null}
          </div>
          {!isOcrEditorExpanded ? <p className="ocr-editor-shell__hint">Click to expand and edit full OCR text.</p> : null}
        </div>
      ) : null}

      {/* â”€â”€ Raw OCR collapsible section (item #5 / #9) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {rawOcrText ? (
        <div className="ocr-raw-section">
          <button
            type="button"
            className="btn-text ocr-raw-section__label"
            onClick={() => setIsRawOcrExpanded((v) => !v)}
          >
            {isRawOcrExpanded ? "\u25BE" : "\u25B8"} Raw OCR Output
          </button>
          {isRawOcrExpanded ? (
            <pre className="ocr-raw-section__pre">{rawOcrText}</pre>
          ) : null}
        </div>
      ) : null}

      {/* Standalone re-parse button â€” only shown when no cover thumbnail is present yet */}
      {(step === "cover" || step === "title") && !coverImageDataUrl ? (
        <button type="button" className="btn-secondary" onClick={runMetadataExtraction} disabled={isBusy}>
          Re-parse OCR Text
        </button>
      ) : null}

      {step === "toc" ? (
        <button type="button" className="btn-secondary" onClick={runTocExtraction}>
          Re-parse TOC Text
        </button>
      ) : null}

      {step === "toc" && tocResult.chapters.length > 0 ? (
        <div className="toc-capture-summary" aria-label="TOC capture summary">
          <p className="toc-capture-summary__header">
            <strong>Detected:</strong> {tocResult.chapters.length} chapter{tocResult.chapters.length !== 1 ? "s" : ""},{" "}
            {tocResult.chapters.reduce((sum, ch) => sum + ch.sections.length, 0)} section{tocResult.chapters.reduce((sum, ch) => sum + ch.sections.length, 0) !== 1 ? "s" : ""}
            {tocResult.confidence > 0 ? ` (confidence: ${Math.round(tocResult.confidence * 100)}%)` : ""}
          </p>
          <ol className="toc-capture-summary__list">
            {tocResult.chapters.map((chapter, index) => (
              <li key={`toc-preview-${chapter.chapterNumber}-${index}`} className="toc-capture-summary__chapter">
                <span className="toc-capture-summary__chapter-num">{chapter.chapterNumber}.</span>
                {" "}{chapter.title}
                {(typeof chapter.pageStart === "number" || typeof chapter.pageEnd === "number" || typeof getChapterDerivedPageEnd(tocResult.chapters, index) === "number") ? (
                  <span className="toc-capture-summary__chapter-pages">
                    {" "}({
                      typeof chapter.pageStart === "number"
                        ? `pp. ${chapter.pageStart}-${chapter.pageEnd ?? getChapterDerivedPageEnd(tocResult.chapters, index) ?? "?"}`
                        : `ends p. ${chapter.pageEnd ?? getChapterDerivedPageEnd(tocResult.chapters, index) ?? "?"}`
                    })
                  </span>
                ) : null}
                {chapter.sections.length > 0 ? (
                  <span className="toc-capture-summary__section-count"> ({chapter.sections.length} section{chapter.sections.length !== 1 ? "s" : ""})</span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="form-hint">Review the list above. Use the TOC editor to correct any errors after clicking <strong>Finish TOC</strong>.</p>
        </div>
      ) : null}

      {step === "toc" ? (
        <TocPreviewTree
          toc={{
            chapters: tocResult.chapters,
            confidence: tocResult.confidence,
          }}
          expansionMode={tocPreviewExpansionMode}
          expansionCycle={tocPreviewExpansionCycle}
          isBusy={isBusy}
          onUpdateNode={handlePreviewNodeUpdate}
          onRegenerateNode={handleRegenerateNodeFromImage}
        />
      ) : null}

      {coverImageDataUrl ? (
        <div className="cover-action-row">
          <img src={coverImageDataUrl} alt="Auto-cropped cover" className="cover-action-row__thumb" />
          <div className="cover-action-row__btns">
            <button type="button" className="btn-secondary" onClick={() => void handleCaptureCover()} disabled={isBusy}>
              Retake
            </button>
            <button type="button" className="btn-secondary" onClick={() => coverFileInputRef.current?.click()} disabled={isBusy}>
              Upload New
            </button>
            {step === "cover" || step === "title" ? (
              <button type="button" className="btn-secondary btn-reparse" onClick={runMetadataExtraction} disabled={isBusy}>
                Re-parse OCR Text
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {(step === "cover" || step === "title") ? (
        <p className="form-hint">
          You can edit any of these fields. Your corrections help improve future extractions.
        </p>
      ) : null}

      {(step === "cover" || step === "title") ? (
        <div ref={metadataFormRef} className="metadata-fields-section">
          <div className="metadata-tile-grid" role="list" aria-label="Captured metadata fields">
            {(step === "cover"
              ? [
                  ...COVER_PRIMARY_TILE_FIELDS,
                  ...METADATA_TILE_FIELD_ORDER.filter((field) => !COVER_PRIMARY_TILE_FIELDS.includes(field)),
                ]
              : METADATA_TILE_FIELD_ORDER
            ).map((fieldKey) => {
              const label = METADATA_TILE_LABELS[fieldKey];
              const captured = isMetadataTileCaptured(fieldKey);
              const summary = getMetadataTileSummary(fieldKey);
              const confidence = getMetadataTileConfidence(fieldKey);
              const highConfidence = confidence !== null && confidence >= HIGH_CONFIDENCE_THRESHOLD && captured;
              const isExpanded = expandedMetadataField === fieldKey;
              const isCoverSecondaryField = step === "cover" && !COVER_PRIMARY_TILE_FIELDS.includes(fieldKey);
              const shouldCompact = !captured && (isCoverSecondaryField || step === "title");
              const shouldUseMicroCompact = shouldCompact && COVER_EXTRA_COMPACT_TILE_FIELDS.includes(fieldKey);
              const shouldUseNanoCompact = shouldCompact && COVER_NANO_COMPACT_TILE_FIELDS.includes(fieldKey);

              return (
                <button
                  key={fieldKey}
                  type="button"
                  className={[
                    "metadata-tile",
                    captured ? "metadata-tile--captured" : "metadata-tile--empty",
                    isExpanded ? "metadata-tile--expanded" : "",
                    !shouldCompact ? "metadata-tile--full" : "",
                    shouldCompact ? "metadata-tile--compact" : "",
                    isCoverSecondaryField && !captured ? "metadata-tile--cover-secondary" : "",
                    shouldUseMicroCompact ? "metadata-tile--compact-micro" : "",
                    shouldUseNanoCompact ? "metadata-tile--compact-nano" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setExpandedMetadataField((current) => current === fieldKey ? null : fieldKey);
                  }}
                  role="listitem"
                  aria-expanded={isExpanded}
                >
                  <span className="metadata-tile__header-row">
                    <span className="metadata-tile__title">{label}</span>
                    {!shouldCompact && highConfidence ? <span className="metadata-tile__check" aria-label="High confidence capture">{"\u2713"}</span> : null}
                  </span>
                  {!shouldCompact ? <span className="metadata-tile__summary">{captured ? summary : "Awaiting capture"}</span> : null}
                </button>
              );
            })}
          </div>

          {expandedMetadataField ? (
            <div className="metadata-tile-editor" role="region" aria-label="Metadata field editor">
              <p className="metadata-tile-editor__title">Editing {expandedMetadataField === "isbnRaw" ? "ISBN" : expandedMetadataField === "additionalIsbnsCsv" ? "Additional ISBNs" : expandedMetadataField === "authorsCsv" ? "Authors" : expandedMetadataField === "platformUrl" ? "Publisher URL" : expandedMetadataField === "relatedIsbns" ? "Related ISBNs" : expandedMetadataField === "mhid" ? "MHID" : expandedMetadataField === "seriesName" ? "Series Name" : expandedMetadataField === "gradeBand" ? "Grade Band" : expandedMetadataField === "publicationYear" ? "Publication Year" : expandedMetadataField === "copyrightYear" ? "Copyright Year" : expandedMetadataField === "publisherLocation" ? "Publisher Location" : expandedMetadataField.charAt(0).toUpperCase() + expandedMetadataField.slice(1)}{" "}{(() => { const f = getTileConfidenceField(expandedMetadataField); return f ? renderConfidenceDot(f) : null; })()}</p>
              {renderMetadataTileEditor(expandedMetadataField)}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === "cover" ? (
        <div className="form-actions">
          <button type="button" onClick={handleAcceptCoverStep} disabled={isBusy || !coverImageDataUrl}>Accept</button>
        </div>
      ) : null}

      {step === "title" ? (
        <div className="form-actions">
          <button type="button" onClick={handleAcceptTitleStep} disabled={isBusy}>Accept</button>
          <button type="button" className="btn-secondary" onClick={() => void handleCaptureTitle()} disabled={isBusy}>Retake</button>
        </div>
      ) : null}

      {step === "toc-editor" ? (
        <div className="auto-toc-editor">
          <h4>TOC Editor</h4>
          {tocResult.chapters.length === 0 ? <p className="form-hint">No chapters detected yet.</p> : null}

          {tocResult.chapters.map((chapter, chapterIndex) => (
            <div key={`${chapter.chapterNumber}-${chapterIndex}`} className="auto-toc-editor__chapter">
              <div className="auto-toc-editor__row">
                <label>
                  Chapter Number
                  <input
                    value={chapter.chapterNumber}
                    onChange={(event) => updateChapter(chapterIndex, { chapterNumber: event.target.value })}
                  />
                </label>
                <label>
                  Chapter Title
                  <input
                    value={chapter.title}
                    onChange={(event) => updateChapter(chapterIndex, { title: event.target.value })}
                  />
                </label>
                <label>
                  Chapter Start Page
                  <input
                    type="number"
                    min={1}
                    value={toPageInputValue(chapter.pageStart)}
                    onChange={(event) => updateChapter(chapterIndex, { pageStart: parsePageInputValue(event.target.value) })}
                  />
                </label>
                <label>
                  Chapter End Page
                  <input
                    type="number"
                    min={1}
                    value={toPageInputValue(chapter.pageEnd)}
                    onChange={(event) => updateChapter(chapterIndex, { pageEnd: parsePageInputValue(event.target.value) })}
                    placeholder={toPageInputValue(getChapterDerivedPageEnd(tocResult.chapters, chapterIndex)) || "Auto"}
                  />
                </label>
              </div>

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => mergeWithPreviousChapter(chapterIndex)} disabled={chapterIndex === 0}>
                  Merge with Previous
                </button>
                <button type="button" className="btn-secondary" onClick={() => splitChapter(chapterIndex)} disabled={chapter.sections.length < 2}>
                  Split Chapter
                </button>
                <button type="button" className="btn-secondary" onClick={() => deleteChapter(chapterIndex)}>
                  Delete Chapter
                </button>
              </div>

              {chapter.sections.map((section, sectionIndex) => (
                <div key={`${section.sectionNumber}-${sectionIndex}`} className="auto-toc-editor__section-row">
                  <input
                    value={section.sectionNumber}
                    onChange={(event) => updateSection(chapterIndex, sectionIndex, { sectionNumber: event.target.value })}
                    placeholder="Section #"
                  />
                  <input
                    value={section.title}
                    onChange={(event) => updateSection(chapterIndex, sectionIndex, { title: event.target.value })}
                    placeholder="Section title"
                  />
                  <input
                    type="number"
                    min={1}
                    value={toPageInputValue(section.pageStart)}
                    onChange={(event) => updateSection(chapterIndex, sectionIndex, { pageStart: parsePageInputValue(event.target.value) })}
                    placeholder="Start page"
                  />
                  <input
                    type="number"
                    min={1}
                    value={toPageInputValue(section.pageEnd)}
                    onChange={(event) => updateSection(chapterIndex, sectionIndex, { pageEnd: parsePageInputValue(event.target.value) })}
                    placeholder={toPageInputValue(getSectionDerivedPageEnd(chapter, sectionIndex)) || "End page"}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => deleteSection(chapterIndex, sectionIndex)}
                    aria-label="Delete section"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ))}

          <div className="form-actions">
            <button type="button" onClick={() => void handleSaveAutoSetup()} disabled={isBusy}>
              Confirm and Save Textbook
            </button>
            <button type="button" className="btn-secondary" onClick={() => setStep("toc")}>
              Back to TOC Capture
            </button>
          </div>
          {saveUploadProgress.visible ? (
            <div className="auto-save-upload-progress" role="status" aria-live="polite">
              <p>
                Save and Upload Progress: {saveUploadProgress.percent}% - {saveUploadProgress.detail}
              </p>
              <progress
                className="auto-save-upload-progress__bar"
                max={100}
                value={saveUploadProgress.percent}
                aria-label="Textbook upload progress"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {uploadPreview.open ? (
        <div className="capture-overlay" role="dialog" aria-modal="true" aria-label="Cover image upload preview">
          <div className="capture-overlay__panel upload-preview-panel">
            <h4>Review uploaded image</h4>
            <p className="form-hint">
              Verify the image and OCR text below. Edit the OCR text if anything was misread, then confirm to apply.
            </p>
            <div className="upload-preview-body">
              <div className="upload-preview-image-wrap">
                <img
                  src={uploadPreview.imageDataUrl}
                  alt="Cover image preview"
                  className="upload-preview-image"
                />
                <p className="form-hint upload-preview-provider">OCR provider: {uploadPreview.ocrProviderId}</p>
                <p className="form-hint upload-preview-provider">Target step: {uploadPreview.step === "cover" ? "Cover" : "Copyright Page"}</p>
              </div>
              <div className="upload-preview-ocr-wrap">
                <label>
                  Extracted text (editable)
                  <textarea
                    className="upload-preview-ocr-textarea"
                    value={uploadPreview.editableOcrText}
                    onChange={(event) =>
                      setUploadPreview((current) => ({ ...current, editableOcrText: event.target.value }))
                    }
                    placeholder="No text was extracted. You can type or paste the cover text manually."
                    rows={14}
                  />
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" onClick={confirmUploadPreview}>
                Confirm &amp; Apply
              </button>
              <button type="button" className="btn-secondary" onClick={cancelUploadPreview}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {captureDialog.open ? (
        <div className="capture-overlay" role="dialog" aria-modal="true">
          <div className="capture-overlay__panel">
            <h4>Select capture region</h4>
            <p className="form-hint">Drag a rectangle around the page. It is okay to include extra space.</p>
            <div
              className="capture-overlay__image-wrap"
              onPointerDown={handleSelectionPointerDown}
              onPointerMove={handleSelectionPointerMove}
              onPointerUp={handleSelectionPointerUp}
            >
              <img
                ref={imageRef}
                src={captureDialog.imageDataUrl}
                alt="Screen capture"
                className="capture-overlay__image"
              />
              {selectionRect ? (
                <div className="capture-overlay__selection">
                  <svg className="capture-overlay__selection-svg" aria-hidden="true">
                    <rect
                      x={selectionRect.x}
                      y={selectionRect.y}
                      width={selectionRect.width}
                      height={selectionRect.height}
                      className="capture-overlay__selection-rect"
                    />
                  </svg>
                </div>
              ) : null}
            </div>
            <div className="form-actions">
              <button
                type="button"
                onClick={() => {
                  if (!imageRef.current) {
                    closeSelectionDialog(null);
                    return;
                  }

                  if (!selectionRect) {
                    closeSelectionDialog(createDefaultSelection(imageRef.current));
                    return;
                  }

                  closeSelectionDialog(selectionRect);
                }}
              >
                Use Selection
              </button>
              <button type="button" className="btn-secondary" onClick={() => closeSelectionDialog(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { RelatedIsbn, RelatedIsbnType } from "../../../core/models";

import {
  type AutoConflictResolutionMode,
  buildAutoConflictResolutionPlan,
} from "../../../core/services/autoTextbookConflictService";
import { extractTextFromImageWithFallback } from "../../../core/services/autoOcrService";
import { appendDebugLogEntry } from "../../../core/services";
import { persistAutoTextbook } from "../../../core/services/autoTextbookPersistenceService";
import { uploadTextbookCoverFromDataUrl } from "../../../core/services/coverImageService";
import {
  AUTO_MODE_SCOPE_MESSAGE,
  createInitialAutoCaptureUsage,
  DEFAULT_AUTO_CAPTURE_LIMITS,
  detectPageBoundaryFromRgba,
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
  extractMetadataWithOcrFallbackFromDataUrl,
  type MetadataPipelineResult,
} from "../../../core/services/metadataExtractionPipelineService";
import { syncMetadataCorrectionLearning } from "../../../core/services/metadataCorrectionSyncService";
import { useRepositories } from "../../hooks/useRepositories";
import { useUIStore } from "../../store/uiStore";
import { t as translate } from "../../../core/services/i18nService";
import { captureVisibleChromeTab, isChromeOSRuntime, isSmallChromebookViewport } from "../../utils/platform";
import { getCurrentUser } from "../../../firebase/auth";

type AutoFlowStep = "cover" | "title" | "toc" | "toc-editor";

const RELATED_ISBN_TYPES: RelatedIsbnType[] = ["student", "teacher", "digital", "workbook", "assessment", "other"];

interface AutoTextbookSetupFlowProps {
  runtime?: "webapp" | "extension";
  onSaved: () => void;
  onSwitchToManual: () => void;
  testingSeedState?: {
    step?: AutoFlowStep;
    usage?: { cover: number; title: number; toc: number };
    metadataDraft?: AutoTextbookMetadata;
    metadataConfidence?: AutoMetadataConfidenceMap;
    metadataForm?: Partial<MetadataFormState>;
    coverImageDataUrl?: string | null;
    ocrDraft?: string;
    tocResult?: ParsedTocResult;
    tocPages?: TocPage[];
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

const AUTO_CAPTURE_USAGE_STORAGE_KEY = "courseforge.autoCaptureUsageByDraft";

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

// ── Auto Session Draft — resumable workflow across page reloads ───────────────

const AUTO_SESSION_DRAFT_KEY = "courseforge.autoSessionDraft.v1";
const AUTO_SESSION_MAX_AGE_MS = 86_400_000; // 24 hours

interface AutoSessionDraft {
  version: 1;
  savedAt: number;
  /** Compact base64 data URL; may be null if cover not yet captured. */
  coverImageDataUrl: string | null;
  /** Original raw OCR text (before any user editing). */
  rawOcrText: string;
  /** Snapshot of key metadata fields so the resume card is informative. */
  metadataTitle: string;
  metadataSubject: string;
  metadataPublisher: string;
  step: AutoFlowStep;
  stepsCompleted: { cover: boolean; copyright: boolean };
}

function readAutoSessionDraft(): AutoSessionDraft | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(AUTO_SESSION_DRAFT_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AutoSessionDraft;
    if (parsed?.version !== 1) {
      return null;
    }

    if (Date.now() - parsed.savedAt > AUTO_SESSION_MAX_AGE_MS) {
      window.localStorage.removeItem(AUTO_SESSION_DRAFT_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveAutoSessionDraft(draft: AutoSessionDraft): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(AUTO_SESSION_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Ignore quota or serialization errors; resumability is best-effort.
  }
}

function clearAutoSessionDraft(): void {
  if (typeof window === "undefined") {
    return;
  }

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
    publisherLocation: metadata.publisherLocation ?? "",
    platformUrl: metadata.platformUrl ?? "",
    mhid: metadata.mhid ?? "",
    authorsCsv: (metadata.authors ?? []).join(", "),
    tocExtractionConfidence: tocConfidence > 0 ? tocConfidence.toFixed(2) : "",
  };
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

function metadataResultToAutoMetadata(metadata: MetadataResult): AutoTextbookMetadata {
  return {
    title: metadata.title ?? undefined,
    subtitle: metadata.subtitle ?? undefined,
    edition: metadata.edition ?? undefined,
    publisher: metadata.publisher ?? undefined,
    publisherLocation: metadata.publisherLocation ?? undefined,
    seriesName: metadata.series ?? undefined,
    gradeBand: metadata.gradeLevel ?? undefined,
    subject: metadata.subject ?? undefined,
    copyrightYear: metadata.copyrightYear ?? undefined,
    isbn: metadata.isbn ?? undefined,
    additionalIsbns: metadata.additionalIsbns,
    relatedIsbns: metadata.relatedIsbns,
    platformUrl: metadata.platformUrl ?? undefined,
    mhid: metadata.mhid ?? undefined,
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

async function captureDisplayFrame(input?: { preferChromeTabCapture?: boolean }): Promise<string> {
  if (input?.preferChromeTabCapture) {
    const chromeCapture = await captureVisibleChromeTab();
    if (chromeCapture) {
      return chromeCapture;
    }
  }

  const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });

  try {
    const videoTrack = media.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = media;
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Unable to read the shared screen."));
    });

    await video.play();

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Unable to initialize capture canvas.");
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    media.getTracks().forEach((track) => track.stop());
  }
}

async function cropToSelectionAndAutoBoundary(imageDataUrl: string, selection: SelectionRect): Promise<string> {
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
      // Best effort diagnostics.
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

export function AutoTextbookSetupFlow({ runtime = "webapp", onSaved, onSwitchToManual, testingSeedState }: AutoTextbookSetupFlowProps): React.JSX.Element {
  const language = useUIStore((state) => state.language);
  const chromeOs = useMemo(() => runtime === "extension" && isChromeOSRuntime(), [runtime]);
  const compactChromeLayout = useMemo(() => chromeOs && isSmallChromebookViewport(), [chromeOs]);
  const {
    createTextbook,
    createChapter,
    createSection,
    editTextbook,
    editChapter,
    editSection,
    findTextbookByISBN,
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
  const [lastMetadataImageDataUrl, setLastMetadataImageDataUrl] = useState<string | null>(testingSeedState?.coverImageDataUrl ?? null);
  const [relatedIsbns, setRelatedIsbns] = useState<RelatedIsbn[]>(testingSeedState?.metadataDraft?.relatedIsbns ?? []);
  const [ocrDraft, setOcrDraft] = useState(testingSeedState?.ocrDraft ?? "");
  const [tocResult, setTocResult] = useState<ParsedTocResult>(testingSeedState?.tocResult ?? INITIAL_TOC_RESULT);
  const [tocPages, setTocPages] = useState<TocPage[]>(testingSeedState?.tocPages ?? (testingSeedState?.tocResult ? [{
    pageIndex: 0,
    chapters: testingSeedState.tocResult.chapters,
    confidence: testingSeedState.tocResult.confidence,
  }] : []));
  const [isBusy, setIsBusy] = useState(false);
  const [isRunningOcr, setIsRunningOcr] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingUploadLimitResultRef = useRef<ReturnType<typeof enforceAutoCaptureLimit> | null>(null);
  // Scroll target — metadata fields section revealed after successful OCR.
  const metadataFormRef = useRef<HTMLDivElement>(null);

  // ── Raw OCR / parsed metadata two-section state ──────────────────────────
  // rawOcrText: original, unedited OCR output shown read-only for transparency.
  // ocrDraft: editable copy the user can correct before re-parsing.
  const [rawOcrText, setRawOcrText] = useState(testingSeedState?.ocrDraft ?? "");
  const [isRawOcrExpanded, setIsRawOcrExpanded] = useState(false);

  // ── Resumable session ─────────────────────────────────────────────────────
  // Initialise from localStorage on first mount; cleared on submit or discard.
  const [resumableDraft, setResumableDraft] = useState<AutoSessionDraft | null>(() => readAutoSessionDraft());

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
    if (!coverImageDataUrl && !rawOcrText && !metadataForm.title) {
      return;
    }

    const draft: AutoSessionDraft = {
      version: 1,
      savedAt: Date.now(),
      coverImageDataUrl,
      rawOcrText,
      metadataTitle: metadataForm.title,
      metadataSubject: metadataForm.subject,
      metadataPublisher: metadataForm.publisher,
      step,
      stepsCompleted: {
        cover: Boolean(coverImageDataUrl),
        copyright: Boolean(lastCapturedOcrByStepRef.current.title),
      },
    };

    saveAutoSessionDraft(draft);
  }, [coverImageDataUrl, rawOcrText, metadataForm.title, metadataForm.subject, metadataForm.publisher, step]);

  const canFinishToc = tocResult.chapters.length > 0;

  const stepTitle = useMemo(() => {
    if (step === "cover") return "Auto Setup: Cover";
    if (step === "title") return "Auto Setup: Copyright Page";
    if (step === "toc") return "Auto Setup: Table of Contents";
    return "Auto Setup: TOC Editor";
  }, [step]);

  const stepPrompt = useMemo(() => {
    if (step === "cover") {
      return environmentPreparationMessage;
    }

    if (step === "title") {
      return "Navigate to the copyright page, then click 'Capture Copyright Page'. CourseForge captures the full page for ownership-proof metadata matching.";
    }

    if (step === "toc") {
      return "Navigate to the table of contents. Capture each page until you're done.";
    }

    return "Review the detected chapters and sections, then confirm to save.";
  }, [environmentPreparationMessage, step]);

  function updateMetadataForm<K extends keyof MetadataFormState>(field: K, value: MetadataFormState[K]): void {
    setMetadataForm((current) => ({ ...current, [field]: value }));

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

  function applyMetadataDraft(nextMetadata: AutoTextbookMetadata, tocConfidence = tocResult.confidence): void {
    setMetadataDraft(nextMetadata);
    setMetadataForm(toMetadataFormState(nextMetadata, tocConfidence));
    setRelatedIsbns(nextMetadata.relatedIsbns ?? []);
  }

  function addRelatedIsbn(): void {
    setRelatedIsbns((current) => [...current, { isbn: "", type: "student" }]);
  }

  function removeRelatedIsbn(index: number): void {
    setRelatedIsbns((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function updateRelatedIsbn<K extends keyof RelatedIsbn>(index: number, field: K, value: RelatedIsbn[K]): void {
    setRelatedIsbns((current) => current.map((entry, currentIndex) => currentIndex === index ? { ...entry, [field]: value } : entry));
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

  /** Smooth-scroll the viewport so the metadata fields are centred. */
  function scrollToMetadata(): void {
    window.requestAnimationFrame(() => {
      metadataFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
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
    setOcrDraft(result.rawText);
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
        hasTitle: Boolean(result.title),
        hasPublisher: Boolean(result.publisher),
      },
    });
  }

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

      const rawImage = await captureDisplayFrame({ preferChromeTabCapture: chromeOs });
      emitAutoFlowDiagnostic("frame_captured", {
        traceId,
        context: {
          targetStep,
          imageBytes: rawImage.length,
        },
      });
      const image = await loadImage(rawImage);
      const defaultSelection = createDefaultSelection(image);
      let cropped = "";
      let selection = defaultSelection;
      const requiresManualSelection = targetStep !== "title";

      try {
        if (requiresManualSelection) {
          const selectedRectDisplay = await requestSelection(rawImage);
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
          cropped = await cropToSelectionAndAutoBoundary(rawImage, selection);
        } else {
          emitAutoFlowDiagnostic("selection_skipped_full_page", {
            traceId,
            context: {
              targetStep,
              selectedWidth: selection.width,
              selectedHeight: selection.height,
            },
          });
          cropped = await cropToSelectionAndAutoBoundary(rawImage, selection);
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
        ocrText = pipelineResult.originalOcrOutput?.rawText ?? pipelineResult.result.rawText;
        ocrProviderId = pipelineResult.originalOcrOutput?.providerId ?? "vision-primary";
        emitAutoFlowDiagnostic("metadata_pipeline_completed", {
          traceId,
          context: {
            targetStep,
            metadataSource: pipelineResult.result.source,
            originalOcrProviderId: pipelineResult.originalOcrOutput?.providerId ?? null,
            confidence: pipelineResult.result.confidence,
          },
        });
        ocrProviderStatusMessage = `Metadata source: ${pipelineResult.result.source}${pipelineResult.originalOcrOutput ? ` (OCR: ${pipelineResult.originalOcrOutput.providerId})` : ""}`;
        lastCapturedOcrByStepRef.current[targetStep] = ocrText;
      } else {
        setIsRunningOcr(true);
        emitAutoFlowDiagnostic("toc_ocr_started", {
          traceId,
          context: {
            targetStep,
            imageBytes: cropped.length,
          },
        });
        const ocr = await extractTextFromImageWithFallback(cropped);
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
      const message = error instanceof Error ? error.message : "Unknown capture error.";
      emitAutoFlowDiagnostic("capture_failed", {
        level: "error",
        traceId,
        context: {
          targetStep,
          message,
        },
      });
      setErrorMessage("Unable to capture screen. Try again, or use Upload Image as fallback.");
      appendDebugLogEntry({
        eventType: "error",
        message: "Display capture failed.",
        autoModeStep: targetStep,
        context: { detail: message },
      });
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  function runMetadataExtraction(): void {
    applyMetadataFromText(ocrDraft, step === "title" ? "title" : "cover");
  }

  function runTocExtraction(): void {
    applyTocFromText(ocrDraft);
  }

  async function processImageFileForStep(file: File, targetStep: "cover" | "title"): Promise<void> {
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

      setIsRunningOcr(true);
      const pipelineResult = await extractMetadataWithOcrFallbackFromDataUrl(dataUrl, {
        pageType: targetStep,
        publisherHint: metadataForm.publisher || null,
      });
      setIsRunningOcr(false);

      const ocrText = pipelineResult.originalOcrOutput?.rawText ?? pipelineResult.result.rawText;
      const ocrProviderId = pipelineResult.originalOcrOutput?.providerId ?? "vision-primary";
      emitAutoFlowDiagnostic("upload_pipeline_completed", {
        traceId,
        context: {
          targetStep,
          metadataSource: pipelineResult.result.source,
          ocrProviderId,
          confidence: pipelineResult.result.confidence,
        },
      });
      setOcrProviderStatus(
        `Metadata source: ${pipelineResult.result.source}${pipelineResult.originalOcrOutput ? ` (OCR: ${pipelineResult.originalOcrOutput.providerId})` : ""}`
      );

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
    setRawOcrText(uploadPreview.ocrText);
    setOcrDraft(editableOcrText);
    setModerationAssessment(null);
    if (pipelineResult) {
      lastMetadataPipelineRef.current = pipelineResult;
    }
    if (targetStep === "cover") {
      setCoverImageDataUrl(imageDataUrl);
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
    setIsDragOver(true);
  }

  function handleCoverDropZoneDragLeave(): void {
    setIsDragOver(false);
  }

  function handleCoverDropZoneDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void processImageFileForStep(file, "cover");
    }
  }

  function handleTitleDropZoneDragOver(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsTitleDragOver(true);
  }

  function handleTitleDropZoneDragLeave(): void {
    setIsTitleDragOver(false);
  }

  function handleTitleDropZoneDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsTitleDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void processImageFileForStep(file, "title");
    }
  }

  async function handleCaptureCover(): Promise<void> {
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
  }

  async function handleCaptureTitle(): Promise<void> {
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

    lastCapturedOcrByStepRef.current.title = captured.ocrText;
    setLastMetadataImageDataUrl(captured.imageDataUrl);
    setRawOcrText(captured.ocrText);
    setOcrDraft(captured.ocrText);
    setStep("title");
    if (captured.pipelineResult) {
      lastMetadataPipelineRef.current = captured.pipelineResult;
    }
    lastMetadataCaptureStepRef.current = "title";
    if (captured.metadataResult) {
      applyMetadataFromPipelineResult(captured.metadataResult, "title");
    } else {
      applyMetadataFromText(captured.ocrText, "title");
    }
    setInfoMessage(`Copyright page captured and parsed. Review merged metadata. (Source: ${captured.metadataResult?.source ?? `OCR: ${captured.ocrProviderId}`})`);
    scrollToMetadata();
  }

  async function handleCaptureToc(): Promise<void> {
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

    setOcrDraft(captured.ocrText);
    setStep("toc");
    applyTocFromText(captured.ocrText);
    setInfoMessage(`TOC page captured and parsed. Continue capturing or finish TOC. (OCR: ${captured.ocrProviderId})`);
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

  function updateSection(chapterIndex: number, sectionIndex: number, update: { sectionNumber?: string; title?: string }): void {
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
  }

  function splitChapter(chapterIndex: number): void {
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
  }

  async function handleSaveAutoSetup(): Promise<void> {
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

    const parsedYear = Number(metadataForm.publicationYear);
    if (!Number.isInteger(parsedYear) || parsedYear <= 0) {
      setErrorMessage("Publication year must be a valid whole number.");
      emitAutoFlowDiagnostic("save_validation_failed", {
        level: "warning",
        traceId,
        context: { reason: "invalid_publication_year", value: metadataForm.publicationYear },
      });
      return;
    }

    if (!metadataForm.title.trim()) {
      setErrorMessage("Title is required before saving.");
      emitAutoFlowDiagnostic("save_validation_failed", {
        level: "warning",
        traceId,
        context: { reason: "missing_title" },
      });
      return;
    }

    if (!coverImageDataUrl) {
      setErrorMessage("Capture and accept a cover image before saving Auto setup.");
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
    saveCorrectionRecord({
      pageType: lastMetadataCaptureStepRef.current,
      publisher: metadata.publisher ?? null,
      series: metadata.seriesName ?? null,
      subject: metadata.subject ?? null,
      originalVisionOutput: latestPipeline?.originalVisionOutput ?? null,
      originalOcrOutput: latestPipeline?.originalOcrOutput
        ? { rawText: latestPipeline.originalOcrOutput.rawText }
        : null,
      finalMetadata: finalMetadataResult,
      imageReference: lastMetadataImageDataUrl ?? coverImageDataUrl,
    });

    if (!changedFromOriginal) {
      appendDebugLogEntry({
        eventType: "user_action",
        message: "Metadata accepted without edits; logged as high-confidence sample.",
        autoModeStep: lastMetadataCaptureStepRef.current,
      });
    }

    try {
      setIsBusy(true);

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
        return;
      }

      const requiresAdminReview = imageModeration.decision === "review";

      const trimmedIsbn = metadataForm.isbnRaw.trim();
      const existingDuplicate = trimmedIsbn
        ? await findTextbookByISBN(trimmedIsbn)
        : undefined;

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
        return;
      }

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

        if (coverImageDataUrl) {
          const coverImageUrl = await uploadTextbookCoverFromDataUrl(duplicateMatch.id, coverImageDataUrl);
          await editTextbook(duplicateMatch.id, {
            ...nextTextbookChanges,
            coverImageUrl,
          });
        } else {
          await editTextbook(duplicateMatch.id, nextTextbookChanges);
        }

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
          const chapterPayload = {
            sourceType: "auto" as const,
            index: Number.isInteger(chapterIndexValue) ? chapterIndexValue : chapterInstruction.chapterIndex + 1,
            name: chapterInstruction.autoChapter.title,
            description: chapterInstruction.autoChapter.unitName,
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

          const sectionPayload = {
            sourceType: "auto" as const,
            index: sectionInstruction.sectionIndex + 1,
            title: sectionInstruction.sectionTitle,
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
            tocChapters: tocResult.chapters,
          },
          {
            createTextbook,
            createChapter,
            createSection,
          }
        );
      }

      clearPersistedCaptureUsage(draftKeyRef.current);
      clearAutoSessionDraft();
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

      if (isMetadataCorrectionSharingEnabled()) {
        const syncResult = await syncMetadataCorrectionLearning({
          optedIn: true,
          maxPushRecords: 30,
        });
        if (syncResult.message) {
          setInfoMessage(syncResult.message);
        }
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
  }

  return (
    <section className={`panel auto-textbook-flow${compactChromeLayout ? " auto-textbook-flow--chromeos-compact" : ""}`}>
      <h3>{stepTitle}</h3>

      {/* ── Session resume card — shown when a prior session exists ── */}
      {resumableDraft !== null && !coverImageDataUrl ? (
        <div className="auto-session-resume" role="complementary" aria-label="Resume previous Auto session">
          <p className="auto-session-resume__title">Auto Mode — Session In Progress</p>
          <div className="auto-session-resume__body">
            {resumableDraft.coverImageDataUrl ? (
              <img
                src={resumableDraft.coverImageDataUrl}
                alt="Previous cover thumbnail"
                className="auto-session-resume__thumb"
              />
            ) : null}
            <div>
              <p className="auto-session-resume__meta">
                {resumableDraft.metadataTitle
                  ? <strong>{resumableDraft.metadataTitle}</strong>
                  : <em>Untitled</em>}
                {" "}· Saved {new Date(resumableDraft.savedAt).toLocaleTimeString()}
              </p>
              <p className="auto-session-resume__meta">
                Completed: {[
                  resumableDraft.stepsCompleted.cover && "Cover",
                  resumableDraft.stepsCompleted.copyright && "Copyright",
                ].filter(Boolean).join(", ") || "None yet"}
              </p>
            </div>
          </div>
          <div className="auto-session-resume__actions">
            <button
              type="button"
              onClick={() => {
                if (resumableDraft.coverImageDataUrl) {
                  setCoverImageDataUrl(resumableDraft.coverImageDataUrl);
                  setLastMetadataImageDataUrl(resumableDraft.coverImageDataUrl);
                }
                if (resumableDraft.rawOcrText) {
                  setRawOcrText(resumableDraft.rawOcrText);
                  setOcrDraft(resumableDraft.rawOcrText);
                }
                setMetadataForm((current) => ({
                  ...current,
                  title: resumableDraft.metadataTitle || current.title,
                  subject: resumableDraft.metadataSubject || current.subject,
                  publisher: resumableDraft.metadataPublisher || current.publisher,
                }));
                setStep(resumableDraft.step);
                setResumableDraft(null);
              }}
              disabled={isBusy}
            >
              Resume Session
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                clearAutoSessionDraft();
                setResumableDraft(null);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {chromeOs ? (
        <p className="form-hint">{translate(language, "autoMode", "chromeOsBanner")}</p>
      ) : null}

      <p className="form-hint">
        {AUTO_MODE_SCOPE_MESSAGE}
      </p>

      <p className="form-hint">{stepPrompt}</p>

      <p className="form-hint">
        It is okay to include extra space while capturing; CourseForge will auto-crop page boundaries.
      </p>

      {step === "title" ? (
        <>
          <p className="form-hint">
            Copyright page capture is always treated as full-page to support future ownership verification against stored textbook metadata.
          </p>
          <div className="capture-tip-callout">
            <span className="capture-tip-callout__icon" aria-hidden="true">💡</span>
            <p className="capture-tip-callout__text">
              <strong>Best results tip:</strong> Before capturing, zoom in so the copyright page fills most of your screen — small text is harder for OCR to read accurately. If you zoomed out to see the full page and some fields were missed, try re-capturing at a higher zoom level, or drag &amp; drop a close-up screenshot of just the copyright text.
            </p>
          </div>
        </>
      ) : null}

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      {infoMessage ? <p className="success-text">{infoMessage}</p> : null}
      {moderationAssessment?.decision === "review" ? (
        <p className="form-hint">Image safety review triggered: {moderationAssessment.reason}</p>
      ) : null}
      {ocrProviderStatus && !isRunningOcr ? <p className="form-hint">{ocrProviderStatus}</p> : null}
      {isRunningOcr ? (
        <div className="ocr-loading-banner" role="status" aria-live="polite">
          <span className="ocr-loading-spinner" aria-hidden="true" />
          <span className="ocr-loading-text">Analyzing image — OCR is reading your page. This usually takes a few seconds&hellip;</span>
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
                <span className="extraction-summary__check" aria-hidden="true">✓</span> {field}
              </li>
            ))}
          </ul>
          <p className="form-hint extraction-summary__hint">Scroll down to review and correct each field before clicking <strong>Accept</strong>.</p>
        </div>
      ) : null}

      {step === "cover" ? (
        <div
          className={`cover-drop-zone${isDragOver ? " cover-drop-zone--active" : ""}`}
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
          className={`cover-drop-zone${isTitleDragOver ? " cover-drop-zone--active" : ""}`}
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
          if (file) void processImageFileForStep(file, "cover");
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
          if (file) void processImageFileForStep(file, "title");
          event.target.value = "";
        }}
        aria-label="Upload copyright page image file"
      />

      <div className="form-actions">
        {step === "cover" ? (
          <>
            <button type="button" onClick={() => void handleCaptureCover()} disabled={isBusy}>
              Capture Cover
            </button>
            <button type="button" className="btn-secondary" onClick={() => coverFileInputRef.current?.click()} disabled={isBusy}>
              Upload Image
            </button>
          </>
        ) : null}

        {step === "title" ? (
          <>
            <button type="button" onClick={() => void handleCaptureTitle()} disabled={isBusy}>
              Capture Copyright Page
            </button>
            <button type="button" className="btn-secondary" onClick={() => titleFileInputRef.current?.click()} disabled={isBusy}>
              Upload Copyright Page
            </button>
          </>
        ) : null}

        {step === "toc" ? (
          <>
            <button type="button" onClick={() => void handleCaptureToc()} disabled={isBusy}>
              Capture TOC Page
            </button>
            <button type="button" className="btn-secondary" onClick={() => setStep("toc-editor")} disabled={!canFinishToc || isBusy}>
              Finish TOC
            </button>
          </>
        ) : null}

        <button type="button" className="btn-secondary" onClick={onSwitchToManual}>
          Switch to Manual
        </button>
      </div>

      <label>
        OCR text (editable)
        <textarea
          rows={6}
          aria-label="OCR text"
          value={ocrDraft}
          onChange={(event) => setOcrDraft(event.target.value)}
          placeholder="If the OCR misread something, paste or edit it here before parsing."
        />
      </label>

      {/* ── Raw OCR collapsible section (item #5 / #9) ───────────── */}
      {rawOcrText ? (
        <div className="ocr-raw-section">
          <button
            type="button"
            className="btn-text ocr-raw-section__label"
            onClick={() => setIsRawOcrExpanded((v) => !v)}
            aria-expanded={isRawOcrExpanded}
          >
            {isRawOcrExpanded ? "▾" : "▸"} Raw OCR Output
          </button>
          {isRawOcrExpanded ? (
            <pre className="ocr-raw-section__pre">{rawOcrText}</pre>
          ) : null}
        </div>
      ) : null}

      {/* Standalone re-parse button — only shown when no cover thumbnail is present yet */}
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
                {chapter.sections.length > 0 ? (
                  <span className="toc-capture-summary__section-count"> ({chapter.sections.length} section{chapter.sections.length !== 1 ? "s" : ""})</span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="form-hint">Review the list above. Use the TOC editor to correct any errors after clicking <strong>Finish TOC</strong>.</p>
        </div>
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

      {step !== "toc-editor" ? (
        <p className="form-hint">
          You can edit any of these fields. Your corrections help improve future extractions.
        </p>
      ) : null}

      {step !== "toc-editor" ? (
        <div ref={metadataFormRef} className="metadata-fields-section">
        <div className="form-grid">
          <label>
            Title
            {renderConfidenceDot("title")}
            <input value={metadataForm.title} onChange={(event) => updateMetadataForm("title", event.target.value)} />
          </label>

          <label>
            Subtitle
            {renderConfidenceDot("subtitle")}
            <input value={metadataForm.subtitle} onChange={(event) => updateMetadataForm("subtitle", event.target.value)} />
          </label>

          <label>
            Grade
            <input value={metadataForm.grade} onChange={(event) => updateMetadataForm("grade", event.target.value)} />
          </label>

          <label>
            Grade Band
            {renderConfidenceDot("gradeBand")}
            <input value={metadataForm.gradeBand} onChange={(event) => updateMetadataForm("gradeBand", event.target.value)} />
          </label>

          <label>
            Subject
            {renderConfidenceDot("subject")}
            <select value={metadataForm.subject} onChange={(event) => updateMetadataForm("subject", event.target.value)}>
              {SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </label>

          <label>
            Edition
            {renderConfidenceDot("edition")}
            <input value={metadataForm.edition} onChange={(event) => updateMetadataForm("edition", event.target.value)} />
          </label>

          <label>
            Publication Year
            <input type="number" value={metadataForm.publicationYear} onChange={(event) => updateMetadataForm("publicationYear", event.target.value)} />
          </label>

          <label>
            Copyright Year
            {renderConfidenceDot("copyrightYear")}
            <input type="number" value={metadataForm.copyrightYear} onChange={(event) => updateMetadataForm("copyrightYear", event.target.value)} />
          </label>

          <label>
            ISBN
            {renderConfidenceDot("isbn")}
            <input value={metadataForm.isbnRaw} onChange={(event) => updateMetadataForm("isbnRaw", event.target.value)} />
          </label>

          <label>
            Additional ISBNs (comma separated)
            {renderConfidenceDot("additionalIsbns")}
            <input value={metadataForm.additionalIsbnsCsv} onChange={(event) => updateMetadataForm("additionalIsbnsCsv", event.target.value)} />
          </label>

          <fieldset className="form-fieldset">
            <legend>Related ISBNs (typed)</legend>
            <p className="form-hint">Use this when the copyright page lists student, teacher, digital, workbook, or assessment ISBNs separately.</p>
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
                  placeholder="Note (optional)"
                  className="related-isbn-note"
                />
                <button type="button" className="btn-icon btn-danger" onClick={() => removeRelatedIsbn(index)} aria-label="Remove related ISBN" title="Remove">✕</button>
              </div>
            ))}
            <button type="button" className="btn-secondary" onClick={addRelatedIsbn}>+ Add Related ISBN</button>
          </fieldset>

          <label>
            Authors (comma separated)
            {renderConfidenceDot("authors")}
            <input value={metadataForm.authorsCsv} onChange={(event) => updateMetadataForm("authorsCsv", event.target.value)} />
          </label>

          <label>
            Publisher
            {renderConfidenceDot("publisher")}
            <input value={metadataForm.publisher} onChange={(event) => updateMetadataForm("publisher", event.target.value)} />
          </label>

          <label>
            Publisher Location
            {renderConfidenceDot("publisherLocation")}
            <input value={metadataForm.publisherLocation} onChange={(event) => updateMetadataForm("publisherLocation", event.target.value)} />
          </label>

          <label>
            Publisher URL
            {renderConfidenceDot("platformUrl")}
            <input type="url" value={metadataForm.platformUrl} onChange={(event) => updateMetadataForm("platformUrl", event.target.value)} />
          </label>

          <label>
            MHID
            {renderConfidenceDot("mhid")}
            <input value={metadataForm.mhid} onChange={(event) => updateMetadataForm("mhid", event.target.value)} />
          </label>

          <label>
            Series Name
            {renderConfidenceDot("seriesName")}
            <input value={metadataForm.seriesName} onChange={(event) => updateMetadataForm("seriesName", event.target.value)} />
          </label>
        </div>
        </div>
      ) : null}

      {step === "cover" ? (
        <div className="form-actions">
          <button type="button" onClick={() => setStep("title")} disabled={isBusy || !coverImageDataUrl}>Accept</button>
        </div>
      ) : null}

      {step === "title" ? (
        <div className="form-actions">
          <button type="button" onClick={() => setStep("toc")} disabled={isBusy}>Accept</button>
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
              </div>

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => mergeWithPreviousChapter(chapterIndex)} disabled={chapterIndex === 0}>
                  Merge with Previous
                </button>
                <button type="button" className="btn-secondary" onClick={() => splitChapter(chapterIndex)} disabled={chapter.sections.length < 2}>
                  Split Chapter
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

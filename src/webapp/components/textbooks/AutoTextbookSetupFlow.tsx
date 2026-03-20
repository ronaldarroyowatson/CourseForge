import React, { useEffect, useMemo, useRef, useState } from "react";

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
import { useRepositories } from "../../hooks/useRepositories";
import { useUIStore } from "../../store/uiStore";
import { t as translate } from "../../../core/services/i18nService";
import { captureVisibleChromeTab, isChromeOSRuntime, isSmallChromebookViewport } from "../../utils/platform";

type AutoFlowStep = "cover" | "title" | "toc" | "toc-editor";

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
  imageDataUrl: string;
  ocrText: string;
  ocrProviderId: string;
  editableOcrText: string;
}

interface CaptureResult {
  imageDataUrl: string;
  ocrText: string;
  ocrProviderId: string;
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
  const publicationYear = metadata.copyrightYear ?? new Date().getFullYear();
  return {
    title: metadata.title ?? "",
    subtitle: metadata.subtitle ?? "",
    grade: metadata.gradeBand ?? "",
    gradeBand: metadata.gradeBand ?? "",
    subject: metadata.subject ?? "Other",
    edition: metadata.edition ?? "",
    publicationYear: publicationYear.toString(),
    copyrightYear: metadata.copyrightYear?.toString() ?? "",
    isbnRaw: metadata.isbn ?? "",
    additionalIsbnsCsv: (metadata.additionalIsbns ?? []).join(", "),
    seriesName: metadata.seriesName ?? "",
    publisher: metadata.publisher ?? "",
    publisherLocation: metadata.publisherLocation ?? "",
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
    authors: authors.length > 0 ? authors : undefined,
    copyrightYear: form.copyrightYear ? Number(form.copyrightYear) : undefined,
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
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateTextbookMatch | null>(null);
  const [conflictResolutionMode, setConflictResolutionMode] = useState<AutoConflictResolutionMode>("overwrite_auto");
  const [moderationAssessment, setModerationAssessment] = useState<ImageModerationAssessment | null>(null);
  const [captureDialog, setCaptureDialog] = useState<CaptureDialogState>({ open: false, imageDataUrl: "" });
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<UploadPreviewState>({
    open: false,
    imageDataUrl: "",
    ocrText: "",
    ocrProviderId: "",
    editableOcrText: "",
  });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const selectionResolverRef = useRef<((value: SelectionRect | null) => void) | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingUploadLimitResultRef = useRef<ReturnType<typeof enforceAutoCaptureLimit> | null>(null);

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
    setDuplicateMatch(null);
  }, [metadataForm.isbnRaw]);

  const canFinishToc = tocResult.chapters.length > 0;

  const stepTitle = useMemo(() => {
    if (step === "cover") return "Auto Setup: Cover";
    if (step === "title") return "Auto Setup: Title Page";
    if (step === "toc") return "Auto Setup: Table of Contents";
    return "Auto Setup: TOC Editor";
  }, [step]);

  const stepPrompt = useMemo(() => {
    if (step === "cover") {
      return environmentPreparationMessage;
    }

    if (step === "title") {
      return "Navigate to the title page, then click 'Capture Title Page'.";
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

  async function requestSelection(imageDataUrl: string): Promise<SelectionRect | null> {
    setCaptureDialog({ open: true, imageDataUrl });
    setSelectionRect(null);

    return new Promise<SelectionRect | null>((resolve) => {
      selectionResolverRef.current = resolve;
    });
  }

  function closeSelectionDialog(selection: SelectionRect | null): void {
    selectionResolverRef.current?.(selection);
    selectionResolverRef.current = null;
    setCaptureDialog({ open: false, imageDataUrl: "" });
    setSelectionRect(null);
    setDragStart(null);
  }

  function handleSelectionPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!imageRef.current) {
      return;
    }

    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    setDragStart({ x, y });
    setSelectionRect({ x, y, width: 0, height: 0 });
  }

  function handleSelectionPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragStart || !imageRef.current) {
      return;
    }

    const rect = imageRef.current.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const currentY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);
    const width = Math.abs(currentX - dragStart.x);
    const height = Math.abs(currentY - dragStart.y);
    setSelectionRect({ x, y, width, height });
  }

  function handleSelectionPointerUp(): void {
    setDragStart(null);
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
    const safety = evaluateAutoCaptureSafety(rawText, sourceStep);
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

    const parsed = extractMetadataFromOcrText(rawText);
    const merged = mergeAutoMetadata(metadataDraft, parsed);
    upsertAutoMetadataConfidence(scoreMetadataConfidence(rawText, parsed));
    applyMetadataDraft(merged);
    setErrorMessage(null);
    setInfoMessage("Metadata extracted automatically. Review and edit fields before accepting.");
    appendDebugLogEntry({
      eventType: "metadata_extracted",
      message: "Metadata extracted from OCR draft.",
      autoModeStep: sourceStep,
      context: { hasTitle: Boolean(merged.title), hasIsbn: Boolean(merged.isbn), hasAuthors: Boolean(merged.authors?.length) },
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
    const limitResult = enforceAutoCaptureLimit(usage, targetStep, DEFAULT_AUTO_CAPTURE_LIMITS);
    if (!limitResult.allowed) {
      setErrorMessage(limitResult.message ?? "Capture limit reached.");
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

      const rawImage = await captureDisplayFrame({ preferChromeTabCapture: chromeOs });
      const image = await loadImage(rawImage);
      const defaultSelection = createDefaultSelection(image);
      const selectedRectDisplay = await requestSelection(rawImage);
      if (!selectedRectDisplay) {
        return null;
      }

      const selectedRectNatural = convertSelectionToNaturalPixels(selectedRectDisplay, image);
      const hasMeaningfulSelection = selectedRectNatural.width > 6 && selectedRectNatural.height > 6;
      const selection = hasMeaningfulSelection ? selectedRectNatural : defaultSelection;

      const cropped = await cropToSelectionAndAutoBoundary(rawImage, selection);
      setUsage(limitResult.nextUsage);
      persistCaptureUsage(draftKeyRef.current, limitResult.nextUsage);
      setIsRunningOcr(true);
      const ocr = await extractTextFromImageWithFallback(cropped);
      setIsRunningOcr(false);
      setOcrProviderStatus(`OCR provider: ${ocr.providerId}`);
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
          ocrProvider: ocr.providerId,
        },
      });
      return {
        imageDataUrl: cropped,
        ocrText: ocr.text,
        ocrProviderId: ocr.providerId,
      };
    } catch {
      setIsRunningOcr(false);
      setErrorMessage("Unable to capture screen. Make sure screen sharing is allowed and try again.");
      appendDebugLogEntry({
        eventType: "error",
        message: "Display capture failed.",
        autoModeStep: targetStep,
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

  async function processImageFileForCover(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please select an image file (JPEG, PNG, WEBP, etc.).");
      return;
    }

    const limitResult = enforceAutoCaptureLimit(usage, "cover", DEFAULT_AUTO_CAPTURE_LIMITS);
    if (!limitResult.allowed) {
      setErrorMessage(limitResult.message ?? "Capture limit reached.");
      appendDebugLogEntry({
        eventType: "warning",
        message: "File upload blocked by limit guard.",
        autoModeStep: "cover",
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

      setIsRunningOcr(true);
      const ocr = await extractTextFromImageWithFallback(dataUrl);
      setIsRunningOcr(false);
      setOcrProviderStatus(`OCR provider: ${ocr.providerId}`);

      // Show preview dialog so the user can review image and OCR text before confirming.
      setUploadPreview({
        open: true,
        imageDataUrl: dataUrl,
        ocrText: ocr.text,
        ocrProviderId: ocr.providerId,
        editableOcrText: ocr.text,
      });

      // Commit happens in confirmUploadPreview; store limitResult for use there.
      pendingUploadLimitResultRef.current = limitResult;
    } catch {
      setIsRunningOcr(false);
      setErrorMessage("Unable to process image file. Make sure the file is a valid image and try again.");
      appendDebugLogEntry({
        eventType: "error",
        message: "Cover file upload processing failed.",
        autoModeStep: "cover",
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

    const { imageDataUrl, editableOcrText, ocrProviderId } = uploadPreview;

    setUsage(limitResult.nextUsage);
    persistCaptureUsage(draftKeyRef.current, limitResult.nextUsage);
    pendingUploadLimitResultRef.current = null;

    setCoverImageDataUrl(imageDataUrl);
    setOcrDraft(editableOcrText);
    setModerationAssessment(null);
    applyMetadataFromText(editableOcrText, "cover");
    setInfoMessage(`Cover image loaded and parsed. Review the metadata fields before accepting. (OCR: ${ocrProviderId})`);
    setUploadPreview((current) => ({ ...current, open: false }));

    appendDebugLogEntry({
      eventType: "auto_capture_complete",
      message: "Cover confirmed from uploaded file.",
      autoModeStep: "cover",
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
      void processImageFileForCover(file);
    }
  }

  async function handleCaptureCover(): Promise<void> {
    const captured = await captureForStep("cover");
    if (!captured) {
      return;
    }

    setCoverImageDataUrl(captured.imageDataUrl);
    setOcrDraft(captured.ocrText);
    setModerationAssessment(null);
    setStep("cover");
    applyMetadataFromText(captured.ocrText, "cover");
    setInfoMessage(`Cover captured and parsed. Review the metadata fields before accepting. (OCR: ${captured.ocrProviderId})`);
  }

  async function handleCaptureTitle(): Promise<void> {
    const captured = await captureForStep("title");
    if (!captured) {
      return;
    }

    setOcrDraft(captured.ocrText);
    setStep("title");
    applyMetadataFromText(captured.ocrText, "title");
    setInfoMessage(`Title page captured and parsed. Review merged metadata. (OCR: ${captured.ocrProviderId})`);
  }

  async function handleCaptureToc(): Promise<void> {
    const captured = await captureForStep("toc");
    if (!captured) {
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
    setErrorMessage(null);

    const parsedYear = Number(metadataForm.publicationYear);
    if (!Number.isInteger(parsedYear) || parsedYear <= 0) {
      setErrorMessage("Publication year must be a valid whole number.");
      return;
    }

    if (!metadataForm.title.trim()) {
      setErrorMessage("Title is required before saving.");
      return;
    }

    if (!coverImageDataUrl) {
      setErrorMessage("Capture and accept a cover image before saving Auto setup.");
      return;
    }

    const metadata = fromMetadataFormState(metadataForm);

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
        seriesName: metadata.seriesName,
        publisher: metadata.publisher,
        publisherLocation: metadata.publisherLocation,
        authors: metadata.authors,
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

      onSaved();
    } catch {
      setErrorMessage("Unable to save Auto setup. Please verify metadata and try again.");
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

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      {infoMessage ? <p className="success-text">{infoMessage}</p> : null}
      {moderationAssessment?.decision === "review" ? (
        <p className="form-hint">Image safety review triggered: {moderationAssessment.reason}</p>
      ) : null}
      {ocrProviderStatus ? <p className="form-hint">{ocrProviderStatus}</p> : null}
      {isRunningOcr ? <p className="form-hint">Running OCR...</p> : null}

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
          if (file) void processImageFileForCover(file);
          event.target.value = "";
        }}
        aria-label="Upload cover image file"
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
          <button type="button" onClick={() => void handleCaptureTitle()} disabled={isBusy}>
            Capture Title Page
          </button>
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
        OCR text (auto-filled by pipeline; editable)
        <textarea
          rows={6}
          value={ocrDraft}
          onChange={(event) => setOcrDraft(event.target.value)}
          placeholder="If OCR output needs correction, paste or edit it here before parsing."
        />
      </label>

      {step === "cover" || step === "title" ? (
        <button type="button" className="btn-secondary" onClick={runMetadataExtraction}>
          Run Metadata Extraction
        </button>
      ) : null}

      {step === "toc" ? (
        <button type="button" className="btn-secondary" onClick={runTocExtraction}>
          Parse TOC Capture
        </button>
      ) : null}

      {coverImageDataUrl ? (
        <div className="cover-preview-row">
          <img src={coverImageDataUrl} alt="Auto-cropped cover" className="cover-preview-thumb" />
          <button type="button" className="btn-secondary" onClick={() => void handleCaptureCover()} disabled={isBusy}>
            Retake
          </button>
          <button type="button" className="btn-secondary" onClick={() => coverFileInputRef.current?.click()} disabled={isBusy}>
            Upload New
          </button>
        </div>
      ) : null}

      {step !== "toc-editor" ? (
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
            Series Name
            {renderConfidenceDot("seriesName")}
            <input value={metadataForm.seriesName} onChange={(event) => updateMetadataForm("seriesName", event.target.value)} />
          </label>
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
            <h4>Review uploaded cover image</h4>
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
                  if (!selectionRect || !imageRef.current) {
                    closeSelectionDialog(null);
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

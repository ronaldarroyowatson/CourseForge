import React, { useMemo, useRef, useState } from "react";

import { persistAutoTextbook } from "../../../core/services/autoTextbookPersistenceService";
import {
  createInitialAutoCaptureUsage,
  DEFAULT_AUTO_CAPTURE_LIMITS,
  detectPageBoundaryFromRgba,
  enforceAutoCaptureLimit,
  evaluateAutoCaptureSafety,
  extractMetadataFromOcrText,
  isLikelyTocText,
  mergeAutoMetadata,
  mergeParsedToc,
  parseTocFromOcrText,
  type AutoTextbookMetadata,
  type ParsedTocResult,
  type TocChapter,
} from "../../../core/services/textbookAutoExtractionService";
import { useRepositories } from "../../hooks/useRepositories";

type AutoFlowStep = "cover" | "title" | "toc" | "toc-editor";

interface AutoTextbookSetupFlowProps {
  onSaved: () => void;
  onSwitchToManual: () => void;
}

interface CaptureDialogState {
  open: boolean;
  imageDataUrl: string;
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

async function captureDisplayFrame(): Promise<string> {
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

function createDefaultSelection(image: HTMLImageElement): SelectionRect {
  return {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

export function AutoTextbookSetupFlow({ onSaved, onSwitchToManual }: AutoTextbookSetupFlowProps): React.JSX.Element {
  const { createTextbook, createChapter, createSection } = useRepositories();
  const [step, setStep] = useState<AutoFlowStep>("cover");
  const [usage, setUsage] = useState(createInitialAutoCaptureUsage());
  const [metadataDraft, setMetadataDraft] = useState<AutoTextbookMetadata>({});
  const [metadataForm, setMetadataForm] = useState<MetadataFormState>(() => toMetadataFormState({}, 0));
  const [coverImageDataUrl, setCoverImageDataUrl] = useState<string | null>(null);
  const [ocrDraft, setOcrDraft] = useState("");
  const [tocResult, setTocResult] = useState<ParsedTocResult>(INITIAL_TOC_RESULT);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [captureDialog, setCaptureDialog] = useState<CaptureDialogState>({ open: false, imageDataUrl: "" });
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const selectionResolverRef = useRef<((value: SelectionRect | null) => void) | null>(null);

  const canFinishToc = tocResult.chapters.length > 0;

  const stepTitle = useMemo(() => {
    if (step === "cover") return "Auto Setup: Cover";
    if (step === "title") return "Auto Setup: Title Page";
    if (step === "toc") return "Auto Setup: Table of Contents";
    return "Auto Setup: TOC Editor";
  }, [step]);

  const stepPrompt = useMemo(() => {
    if (step === "cover") {
      return "Open your textbook (web or app), navigate to the cover, then click 'Capture Cover'.";
    }

    if (step === "title") {
      return "Navigate to the title page, then click 'Capture Title Page'.";
    }

    if (step === "toc") {
      return "Navigate to the table of contents. Capture each page until you're done.";
    }

    return "Review the detected chapters and sections, then confirm to save.";
  }, [step]);

  function updateMetadataForm<K extends keyof MetadataFormState>(field: K, value: MetadataFormState[K]): void {
    setMetadataForm((current) => ({ ...current, [field]: value }));
  }

  function applyMetadataDraft(nextMetadata: AutoTextbookMetadata, tocConfidence = tocResult.confidence): void {
    setMetadataDraft(nextMetadata);
    setMetadataForm(toMetadataFormState(nextMetadata, tocConfidence));
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

  async function captureForStep(targetStep: "cover" | "title" | "toc"): Promise<string | null> {
    const limitResult = enforceAutoCaptureLimit(usage, targetStep, DEFAULT_AUTO_CAPTURE_LIMITS);
    if (!limitResult.allowed) {
      setErrorMessage(limitResult.message ?? "Capture limit reached.");
      return null;
    }

    setErrorMessage(null);
    setInfoMessage(null);
    setIsBusy(true);

    try {
      const rawImage = await captureDisplayFrame();
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
      return cropped;
    } catch {
      setErrorMessage("Unable to capture screen. Make sure screen sharing is allowed and try again.");
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  function runMetadataExtraction(): void {
    const safety = evaluateAutoCaptureSafety(ocrDraft, step === "title" ? "title" : "cover");
    if (!safety.allowed) {
      setErrorMessage(safety.message ?? "Capture blocked by safety checks.");
      return;
    }

    const parsed = extractMetadataFromOcrText(ocrDraft);
    const merged = mergeAutoMetadata(metadataDraft, parsed);
    applyMetadataDraft(merged);
    setErrorMessage(null);
    setInfoMessage("Extraction preview updated. Edit fields as needed before accepting.");
  }

  function runTocExtraction(): void {
    const safety = evaluateAutoCaptureSafety(ocrDraft, "toc");
    if (!safety.allowed) {
      setErrorMessage(safety.message ?? "Capture blocked by safety checks.");
      return;
    }

    const parsed = parseTocFromOcrText(ocrDraft);

    if (!isLikelyTocText(ocrDraft) && parsed.chapters.length === 0) {
      setErrorMessage("This Auto tool is only for metadata and table of contents, not full content capture.");
      return;
    }

    const merged = mergeParsedToc(tocResult, parsed);
    setTocResult(merged);
    setErrorMessage(null);
    setMetadataForm((current) => ({
      ...current,
      tocExtractionConfidence: merged.confidence > 0 ? merged.confidence.toFixed(2) : current.tocExtractionConfidence,
    }));
    setInfoMessage(`TOC capture added. ${merged.chapters.length} chapter entries recognized so far.`);
  }

  async function handleCaptureCover(): Promise<void> {
    const captured = await captureForStep("cover");
    if (!captured) {
      return;
    }

    setCoverImageDataUrl(captured);
    setStep("cover");
    setInfoMessage("Cover captured. Run extraction and review the metadata fields.");
  }

  async function handleCaptureTitle(): Promise<void> {
    const captured = await captureForStep("title");
    if (!captured) {
      return;
    }

    setStep("title");
    setInfoMessage("Title page captured. Run extraction to merge additional metadata.");
  }

  async function handleCaptureToc(): Promise<void> {
    const captured = await captureForStep("toc");
    if (!captured) {
      return;
    }

    setStep("toc");
    setInfoMessage("TOC page captured. Run extraction to append chapters and sections.");
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
      await persistAutoTextbook(
        {
          metadata: {
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

      onSaved();
    } catch {
      setErrorMessage("Unable to save Auto setup. Please verify metadata and try again.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="panel auto-textbook-flow">
      <h3>{stepTitle}</h3>

      <p className="form-hint">
        This Auto tool only supports textbook metadata and table of contents capture. It is not for full content extraction.
      </p>

      <p className="form-hint">{stepPrompt}</p>

      <p className="form-hint">
        It is okay to include extra space while capturing; CourseForge will auto-crop page boundaries.
      </p>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      {infoMessage ? <p className="success-text">{infoMessage}</p> : null}

      <div className="form-actions">
        {step === "cover" ? (
          <button type="button" onClick={() => void handleCaptureCover()} disabled={isBusy}>
            Capture Cover
          </button>
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
        </div>
      ) : null}

      {step !== "toc-editor" ? (
        <div className="form-grid">
          <label>
            Title
            <input value={metadataForm.title} onChange={(event) => updateMetadataForm("title", event.target.value)} />
          </label>

          <label>
            Subtitle
            <input value={metadataForm.subtitle} onChange={(event) => updateMetadataForm("subtitle", event.target.value)} />
          </label>

          <label>
            Grade
            <input value={metadataForm.grade} onChange={(event) => updateMetadataForm("grade", event.target.value)} />
          </label>

          <label>
            Grade Band
            <input value={metadataForm.gradeBand} onChange={(event) => updateMetadataForm("gradeBand", event.target.value)} />
          </label>

          <label>
            Subject
            <select value={metadataForm.subject} onChange={(event) => updateMetadataForm("subject", event.target.value)}>
              {SUBJECTS.map((subject) => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </label>

          <label>
            Edition
            <input value={metadataForm.edition} onChange={(event) => updateMetadataForm("edition", event.target.value)} />
          </label>

          <label>
            Publication Year
            <input type="number" value={metadataForm.publicationYear} onChange={(event) => updateMetadataForm("publicationYear", event.target.value)} />
          </label>

          <label>
            Copyright Year
            <input type="number" value={metadataForm.copyrightYear} onChange={(event) => updateMetadataForm("copyrightYear", event.target.value)} />
          </label>

          <label>
            ISBN
            <input value={metadataForm.isbnRaw} onChange={(event) => updateMetadataForm("isbnRaw", event.target.value)} />
          </label>

          <label>
            Additional ISBNs (comma separated)
            <input value={metadataForm.additionalIsbnsCsv} onChange={(event) => updateMetadataForm("additionalIsbnsCsv", event.target.value)} />
          </label>

          <label>
            Authors (comma separated)
            <input value={metadataForm.authorsCsv} onChange={(event) => updateMetadataForm("authorsCsv", event.target.value)} />
          </label>

          <label>
            Publisher
            <input value={metadataForm.publisher} onChange={(event) => updateMetadataForm("publisher", event.target.value)} />
          </label>

          <label>
            Publisher Location
            <input value={metadataForm.publisherLocation} onChange={(event) => updateMetadataForm("publisherLocation", event.target.value)} />
          </label>

          <label>
            Series Name
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

import React, { useCallback, useEffect, useRef, useState } from "react";

import type { RelatedIsbn, RelatedIsbnType } from "../../../core/models";
import { uploadTextbookCoverFromDataUrl, uploadTextbookCoverImage } from "../../../core/services/coverImageService";
import { fetchMetadataByISBN, normalizeISBN } from "../../../core/services/isbnService";
import { findCloudTextbookByISBN } from "../../../core/services/syncService";
import { getCurrentUser } from "../../../firebase/auth";
import { useRepositories } from "../../hooks/useRepositories";
import { useUIStore } from "../../store/uiStore";
import { AutoTextbookSetupFlow } from "./AutoTextbookSetupFlow";

interface TextbookFormProps {
  onSaved: () => void;
  runtime?: "webapp" | "extension";
}

interface TextbookFormState {
  isbn: string;
  title: string;
  grade: string;
  subject: string;
  edition: string;
  publicationYear: string;
  platformUrl: string;
}

const INITIAL_FORM_STATE: TextbookFormState = {
  isbn: "",
  title: "",
  grade: "",
  subject: "",
  edition: "",
  publicationYear: "",
  platformUrl: "",
};

const INITIAL_ISBN_ROW: RelatedIsbn = { isbn: "", type: "student" };

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

const ISBN_TYPES: RelatedIsbnType[] = [
  "student",
  "teacher",
  "digital",
  "workbook",
  "assessment",
  "other",
];

export function TextbookForm({ onSaved, runtime = "webapp" }: TextbookFormProps): React.JSX.Element {
  const { createTextbook, editTextbook, findTextbookByISBN } = useRepositories();
  const { selectedTextbook, setSelectedTextbook } = useUIStore();

  const [form, setForm] = useState<TextbookFormState>(INITIAL_FORM_STATE);
  const [relatedIsbns, setRelatedIsbns] = useState<RelatedIsbn[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUpISBN, setIsLookingUpISBN] = useState(false);
  const [isManualEntryMode, setIsManualEntryMode] = useState(false);
  const [entryMode, setEntryMode] = useState<"choose" | "manual" | "auto">("choose");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Cover image state
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Populate form fields when a textbook is selected for editing
  useEffect(() => {
    if (selectedTextbook) {
      setForm({
        isbn: selectedTextbook.isbnRaw ?? "",
        title: selectedTextbook.title,
        grade: selectedTextbook.grade,
        subject: selectedTextbook.subject,
        edition: selectedTextbook.edition,
        publicationYear: selectedTextbook.publicationYear.toString(),
        platformUrl: selectedTextbook.platformUrl ?? "",
      });
      setRelatedIsbns(selectedTextbook.relatedIsbns ?? []);
      setCoverPreviewUrl(selectedTextbook.coverImageUrl ?? null);
      setCoverFile(null);
      setCoverDataUrl(null);
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsManualEntryMode(false);
      setEntryMode("manual");
    } else {
      setForm(INITIAL_FORM_STATE);
      setRelatedIsbns([]);
      setCoverPreviewUrl(null);
      setCoverFile(null);
      setCoverDataUrl(null);
      setEntryMode("choose");
    }
  }, [selectedTextbook]);

  // Stop camera stream when component unmounts or capture mode exits
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCapturing(false);
  }, []);

  useEffect(() => {
    return stopStream;
  }, [stopStream]);

  const isEditMode = selectedTextbook !== null;
  const showManualForm = isEditMode || entryMode === "manual";

  function updateField<K extends keyof TextbookFormState>(field: K, value: TextbookFormState[K]): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function formatIsbn13ForDisplay(isbnDigits: string): string {
    if (isbnDigits.length !== 13) {
      return isbnDigits;
    }
    return `${isbnDigits.slice(0, 3)}-${isbnDigits.slice(3, 4)}-${isbnDigits.slice(4, 7)}-${isbnDigits.slice(7, 12)}-${isbnDigits.slice(12)}`;
  }

  function handleCancelEdit(): void {
    setSelectedTextbook(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    stopStream();
  }

  // ── Related ISBNs helpers ───────────────────────────────────────────────

  function addRelatedIsbn(): void {
    setRelatedIsbns((prev) => [...prev, { ...INITIAL_ISBN_ROW }]);
  }

  function removeRelatedIsbn(index: number): void {
    setRelatedIsbns((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRelatedIsbn(index: number, field: keyof RelatedIsbn, value: string): void {
    setRelatedIsbns((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  // ── Cover image helpers ──────────────────────────────────────────────────

  function handleCoverFileChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setCoverFile(file);
    setCoverDataUrl(null);
    const url = URL.createObjectURL(file);
    setCoverPreviewUrl(url);
    setCaptureError(null);
  }

  async function handleStartCapture(): Promise<void> {
    setCaptureError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setIsCapturing(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCaptureError("Camera access denied. Please allow camera access or upload an image instead.");
    }
  }

  function handleTakeSnapshot(): void {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setCoverDataUrl(dataUrl);
    setCoverFile(null);
    setCoverPreviewUrl(dataUrl);
    stopStream();
  }

  // ── ISBN Lookup ──────────────────────────────────────────────────────────

  async function handleISBNLookup(): Promise<void> {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!form.isbn.trim()) {
      setErrorMessage("Please enter an ISBN before looking up.");
      return;
    }

    try {
      setIsLookingUpISBN(true);
      const metadata = await fetchMetadataByISBN(form.isbn);

      if (!metadata) {
        setIsManualEntryMode(true);
        setForm((current) => ({
          ...INITIAL_FORM_STATE,
          isbn: current.isbn,
        }));
        setErrorMessage("This ISBN is not available in public databases. Please enter the textbook details manually.");
        return;
      }

      setIsManualEntryMode(false);

      const parsedYear = metadata.publicationDate ? Number.parseInt(metadata.publicationDate.slice(0, 4), 10) : null;

      setForm((current) => ({
        ...current,
        title: metadata.title ?? current.title,
        edition: current.edition,
        publicationYear: parsedYear && Number.isFinite(parsedYear)
          ? parsedYear.toString()
          : current.publicationYear,
      }));

      const authorList = metadata.authors?.join(", ") || "Unknown";
      setSuccessMessage(`ISBN found! Author(s): ${authorList}. Form fields prefilled.`);
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message || "Unable to look up ISBN. Please try again.");
      } else {
        setErrorMessage("Unable to look up ISBN. Please try again.");
      }
    } finally {
      setIsLookingUpISBN(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const parsedYear = Number(form.publicationYear);
    if (!Number.isInteger(parsedYear) || parsedYear <= 0) {
      setErrorMessage("Publication year must be a valid whole number.");
      return;
    }

    const isbnRaw = form.isbn.trim();
    const isbnNormalized = normalizeISBN(isbnRaw);
    const validRelatedIsbns = relatedIsbns.filter((r) => r.isbn.trim().length > 0);

    try {
      setIsSaving(true);

      if (isEditMode && selectedTextbook) {
        let coverImageUrl = selectedTextbook.coverImageUrl ?? null;
        if (coverFile) {
          coverImageUrl = await uploadTextbookCoverImage(selectedTextbook.id, coverFile);
        } else if (coverDataUrl) {
          coverImageUrl = await uploadTextbookCoverFromDataUrl(selectedTextbook.id, coverDataUrl);
        }

        await editTextbook(selectedTextbook.id, {
          title: form.title.trim(),
          grade: form.grade.trim(),
          subject: form.subject.trim(),
          edition: form.edition.trim(),
          publicationYear: parsedYear,
          isbnRaw,
          isbnNormalized,
          relatedIsbns: validRelatedIsbns,
          platformUrl: form.platformUrl.trim() || undefined,
          coverImageUrl,
        });
        setSelectedTextbook(null);
      } else {
        if (isbnRaw) {
          const existingLocal = await findTextbookByISBN(isbnRaw);
          if (existingLocal) {
            setErrorMessage("A textbook with this ISBN already exists in your local library.");
            return;
          }

          const currentUser = getCurrentUser();
          if (currentUser?.uid) {
            try {
              const existingCloud = await findCloudTextbookByISBN(currentUser.uid, isbnRaw);
              if (existingCloud) {
                setErrorMessage("A textbook with this ISBN already exists in your cloud library.");
                return;
              }
            } catch {
              // Cloud duplicate checks are best-effort and should not block local-first saves.
            }
          }
        }

        await createTextbook({
          sourceType: "manual",
          title: form.title.trim(),
          grade: form.grade.trim(),
          subject: form.subject.trim(),
          edition: form.edition.trim(),
          publicationYear: parsedYear,
          isbnRaw,
          isbnNormalized,
          relatedIsbns: validRelatedIsbns,
          platformUrl: form.platformUrl.trim() || undefined,
          coverImageUrl: null,
          coverFile: coverFile ?? undefined,
          coverDataUrl: coverDataUrl ?? undefined,
        });

        setForm(INITIAL_FORM_STATE);
        setRelatedIsbns([]);
        setCoverPreviewUrl(null);
        setCoverFile(null);
        setCoverDataUrl(null);
        setIsManualEntryMode(false);
        setEntryMode("choose");
      }

      onSaved();
    } catch {
      setErrorMessage("Unable to save textbook. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="panel">
      <h3>{isEditMode ? `Edit: ${selectedTextbook?.title ?? "Textbook"}` : "Add Textbook"}</h3>

      {!isEditMode && entryMode === "choose" ? (
        <div className="textbook-entry-mode-grid">
          <button
            type="button"
            className="textbook-entry-mode-card"
            onClick={() => {
              setEntryMode("auto");
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
          >
            <strong>Auto (Recommended)</strong>
            <span>Capture cover, title page, and TOC pages with guided extraction.</span>
          </button>
          <button
            type="button"
            className="textbook-entry-mode-card"
            onClick={() => {
              setEntryMode("manual");
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
          >
            <strong>Manual</strong>
            <span>Use the existing metadata and textbook details form.</span>
          </button>
        </div>
      ) : null}

      {!isEditMode && entryMode === "auto" ? (
        <AutoTextbookSetupFlow
          runtime={runtime}
          onSaved={onSaved}
          onSwitchToManual={() => {
            setEntryMode("manual");
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
        />
      ) : null}

      {showManualForm && isManualEntryMode ? (
        <p className="manual-entry-banner">Manual Entry Mode: Please fill in the textbook details.</p>
      ) : null}

      {showManualForm ? (
      <form onSubmit={handleSubmit} className="form-grid">

        {/* ── Cover Image ─────────────────────────────────────────────── */}
        <fieldset className="form-fieldset">
          <legend>Cover Image (optional)</legend>

          {coverPreviewUrl ? (
            <div className="cover-preview-row">
              <img src={coverPreviewUrl} alt="Cover preview" className="cover-preview-thumb" />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setCoverPreviewUrl(null); setCoverFile(null); setCoverDataUrl(null); }}
              >
                Remove
              </button>
            </div>
          ) : null}

          {isCapturing ? (
            <div className="camera-capture-area">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className="camera-video" playsInline />
              <canvas ref={canvasRef} className="camera-canvas-hidden" />
              <div className="form-actions">
                <button type="button" onClick={handleTakeSnapshot}>Take Snapshot</button>
                <button type="button" className="btn-secondary" onClick={stopStream}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="cover-input-row">
              <label className="cover-file-label">
                Upload Image
                <input type="file" accept="image/*" onChange={handleCoverFileChange} className="cover-file-input" />
              </label>
              <button type="button" className="btn-secondary" onClick={() => void handleStartCapture()}>
                Capture from Camera
              </button>
            </div>
          )}

          {captureError ? <p className="error-text">{captureError}</p> : null}
        </fieldset>

        {/* ── Primary ISBN ─────────────────────────────────────────────── */}
        <div className="form-group-isbn">
          <label htmlFor="isbn">
            ISBN (optional)
            <input
              id="isbn"
              value={form.isbn}
              onChange={(event) => updateField("isbn", event.target.value)}
              onBlur={() => {
                const normalized = normalizeISBN(form.isbn);
                if (normalized.length === 13) {
                  updateField("isbn", formatIsbn13ForDisplay(normalized));
                }
              }}
              placeholder="e.g., 978-0-13-468599-1"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleISBNLookup()}
            disabled={isLookingUpISBN || !form.isbn.trim()}
            className="btn-lookup-isbn"
          >
            {isLookingUpISBN ? "Looking up..." : "Lookup ISBN"}
          </button>
        </div>

        <p className="form-hint">
          You can type an ISBN and save without lookup. Lookup is optional and only helps prefill metadata.
        </p>

        {/* ── Related ISBNs ─────────────────────────────────────────────── */}
        <fieldset className="form-fieldset">
          <legend>Related ISBNs (optional)</legend>
          <p className="form-hint">Add student edition, teacher edition, digital, workbook, or assessment ISBNs.</p>

          {relatedIsbns.map((row, index) => (
            <div key={index} className="related-isbn-row">
              <input
                value={row.isbn}
                onChange={(e) => updateRelatedIsbn(index, "isbn", e.target.value)}
                placeholder="ISBN-10 or ISBN-13"
                className="related-isbn-input"
              />
              <select
                value={row.type}
                onChange={(e) => updateRelatedIsbn(index, "type", e.target.value)}
                aria-label={`Related ISBN type ${index + 1}`}
                className="related-isbn-type"
              >
                {ISBN_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
              <input
                value={row.note ?? ""}
                onChange={(e) => updateRelatedIsbn(index, "note", e.target.value)}
                placeholder="Note (optional)"
                className="related-isbn-note"
              />
              <button
                type="button"
                className="btn-icon btn-danger"
                onClick={() => removeRelatedIsbn(index)}
                aria-label="Remove related ISBN"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}

          <button type="button" className="btn-secondary" onClick={addRelatedIsbn}>
            + Add Related ISBN
          </button>
        </fieldset>

        {/* ── Core fields ──────────────────────────────────────────────── */}
        <label>
          Title
          <input
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
            required
          />
        </label>

        <label>
          Grade
          <input
            value={form.grade}
            onChange={(event) => updateField("grade", event.target.value)}
            required
          />
        </label>

        <label>
          Subject
          <select
            value={form.subject}
            onChange={(event) => updateField("subject", event.target.value)}
            required
          >
            <option value="">— Select subject —</option>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label>
          Edition
          <input
            value={form.edition}
            onChange={(event) => updateField("edition", event.target.value)}
            required
          />
        </label>

        <label>
          Publication Year
          <input
            type="number"
            value={form.publicationYear}
            onChange={(event) => updateField("publicationYear", event.target.value)}
            required
          />
        </label>

        <label>
          Platform URL (optional)
          <input
            type="url"
            value={form.platformUrl}
            onChange={(event) => updateField("platformUrl", event.target.value)}
          />
        </label>

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        {successMessage ? <p className="success-text">{successMessage}</p> : null}

        <div className="form-actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : isEditMode ? "Update Textbook" : "Save Textbook"}
          </button>
          {!isEditMode ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setEntryMode("choose");
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              disabled={isSaving}
            >
              Back
            </button>
          ) : null}
          {isEditMode ? (
            <button type="button" onClick={handleCancelEdit} disabled={isSaving} className="btn-secondary">
              Cancel
            </button>
          ) : null}
        </div>
      </form>
      ) : null}
    </section>
  );
}

import React, { useEffect, useState } from "react";

import { fetchMetadataByISBN, normalizeISBN } from "../../../core/services/isbnService";
import { findCloudTextbookByISBN } from "../../../core/services/syncService";
import { getCurrentUser } from "../../../firebase/auth";
import { useRepositories } from "../../hooks/useRepositories";
import { useUIStore } from "../../store/uiStore";

interface TextbookFormProps {
  onSaved: () => void;
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

export function TextbookForm({ onSaved }: TextbookFormProps): React.JSX.Element {
  const { createTextbook, editTextbook, findTextbookByISBN } = useRepositories();
  const { selectedTextbook, setSelectedTextbook } = useUIStore();

  const [form, setForm] = useState<TextbookFormState>(INITIAL_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUpISBN, setIsLookingUpISBN] = useState(false);
  const [isManualEntryMode, setIsManualEntryMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsManualEntryMode(false);
    } else {
      setForm(INITIAL_FORM_STATE);
    }
  }, [selectedTextbook]);

  const isEditMode = selectedTextbook !== null;

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
  }

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

    try {
      setIsSaving(true);

      if (isEditMode && selectedTextbook) {
        await editTextbook(selectedTextbook.id, {
          title: form.title.trim(),
          grade: form.grade.trim(),
          subject: form.subject.trim(),
          edition: form.edition.trim(),
          publicationYear: parsedYear,
          isbnRaw,
          isbnNormalized,
          platformUrl: form.platformUrl.trim() || undefined,
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
          title: form.title.trim(),
          grade: form.grade.trim(),
          subject: form.subject.trim(),
          edition: form.edition.trim(),
          publicationYear: parsedYear,
          isbnRaw,
          isbnNormalized,
          platformUrl: form.platformUrl.trim() || undefined,
        });

        setForm(INITIAL_FORM_STATE);
        setIsManualEntryMode(false);
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

      {isManualEntryMode ? (
        <p className="manual-entry-banner">Manual Entry Mode: Please fill in the textbook details.</p>
      ) : null}

      <form onSubmit={handleSubmit} className="form-grid">
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
          <input
            value={form.subject}
            onChange={(event) => updateField("subject", event.target.value)}
            required
          />
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
          {isEditMode ? (
            <button type="button" onClick={handleCancelEdit} disabled={isSaving} className="btn-secondary">
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

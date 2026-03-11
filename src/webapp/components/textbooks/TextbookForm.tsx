import React, { useState } from "react";

import { fetchMetadataByISBN } from "../../../core/services/isbnService";
import { useRepositories } from "../../hooks/useRepositories";

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
  const { createTextbook } = useRepositories();
  const [form, setForm] = useState<TextbookFormState>(INITIAL_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUpISBN, setIsLookingUpISBN] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function updateField<K extends keyof TextbookFormState>(field: K, value: TextbookFormState[K]): void {
    setForm((current) => ({ ...current, [field]: value }));
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

      // Prefill form fields with fetched metadata
      setForm((current) => ({
        ...current,
        title: metadata.title || current.title,
        edition: current.edition, // Edition is usually not in Open Library, keep existing
        publicationYear: metadata.publishDate
          ? new Date(metadata.publishDate).getFullYear().toString()
          : current.publicationYear,
      }));

      const authorList = metadata.authors?.join(", ") || "Unknown";
      setSuccessMessage(`ISBN found! Author(s): ${authorList}. Form fields prefilled.`);
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
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

    try {
      setIsSaving(true);
      await createTextbook({
        title: form.title.trim(),
        grade: form.grade.trim(),
        subject: form.subject.trim(),
        edition: form.edition.trim(),
        publicationYear: parsedYear,
        platformUrl: form.platformUrl.trim() || undefined,
      });

      setForm(INITIAL_FORM_STATE);
      onSaved();
    } catch {
      setErrorMessage("Unable to save textbook. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="panel">
      <h3>Add Textbook</h3>

      <form onSubmit={handleSubmit} className="form-grid">
        <div className="form-group-isbn">
          <label htmlFor="isbn">
            ISBN (optional)
            <input
              id="isbn"
              value={form.isbn}
              onChange={(event) => updateField("isbn", event.target.value)}
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

        <button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Textbook"}
        </button>
      </form>
    </section>
  );
}

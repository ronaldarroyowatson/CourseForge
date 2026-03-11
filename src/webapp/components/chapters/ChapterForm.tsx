import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface ChapterFormProps {
  selectedTextbookId: string | null;
  onSaved: () => void;
}

interface ChapterFormState {
  index: string;
  name: string;
  description: string;
}

const INITIAL_FORM_STATE: ChapterFormState = {
  index: "",
  name: "",
  description: "",
};

export function ChapterForm({ selectedTextbookId, onSaved }: ChapterFormProps): React.JSX.Element {
  const { createChapter } = useRepositories();
  const [form, setForm] = useState<ChapterFormState>(INITIAL_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function updateField<K extends keyof ChapterFormState>(
    field: K,
    value: ChapterFormState[K]
  ): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedTextbookId) {
      setErrorMessage("Select a textbook before adding chapters.");
      return;
    }

    const parsedIndex = Number(form.index);
    if (!Number.isInteger(parsedIndex) || parsedIndex <= 0) {
      setErrorMessage("Chapter index must be a positive whole number.");
      return;
    }

    try {
      setIsSaving(true);
      await createChapter({
        textbookId: selectedTextbookId,
        index: parsedIndex,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      });

      setForm(INITIAL_FORM_STATE);
      onSaved();
    } catch {
      setErrorMessage("Unable to save chapter. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="panel">
      <h3>Add Chapter</h3>

      <form onSubmit={handleSubmit} className="form-grid">
        <label>
          Chapter Index
          <input
            type="number"
            min={1}
            value={form.index}
            onChange={(event) => updateField("index", event.target.value)}
            required
          />
        </label>

        <label>
          Name
          <input
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            required
          />
        </label>

        <label>
          Description (optional)
          <input
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
          />
        </label>

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        <button type="submit" disabled={isSaving || !selectedTextbookId}>
          {isSaving ? "Saving..." : "Save Chapter"}
        </button>
      </form>
    </section>
  );
}

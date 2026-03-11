import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface SectionFormProps {
  selectedChapterId: string | null;
  onSaved: () => void;
}

interface SectionFormState {
  index: string;
  title: string;
  notes: string;
}

const INITIAL_FORM_STATE: SectionFormState = {
  index: "",
  title: "",
  notes: "",
};

export function SectionForm({ selectedChapterId, onSaved }: SectionFormProps): React.JSX.Element {
  const { createSection } = useRepositories();
  const [form, setForm] = useState<SectionFormState>(INITIAL_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function updateField<K extends keyof SectionFormState>(
    field: K,
    value: SectionFormState[K]
  ): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedChapterId) {
      setErrorMessage("Select a chapter before adding sections.");
      return;
    }

    const parsedIndex = Number(form.index);
    if (!Number.isInteger(parsedIndex) || parsedIndex <= 0) {
      setErrorMessage("Section index must be a positive whole number.");
      return;
    }

    try {
      setIsSaving(true);
      await createSection({
        chapterId: selectedChapterId,
        index: parsedIndex,
        title: form.title.trim(),
        notes: form.notes.trim() || undefined,
      });

      setForm(INITIAL_FORM_STATE);
      onSaved();
    } catch {
      setErrorMessage("Unable to save section. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="panel">
      <h3>Add Section</h3>

      <form onSubmit={handleSubmit} className="form-grid">
        <label>
          Section Index
          <input
            type="number"
            min={1}
            value={form.index}
            onChange={(event) => updateField("index", event.target.value)}
            required
          />
        </label>

        <label>
          Title
          <input
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
            required
          />
        </label>

        <label>
          Notes (optional)
          <input
            value={form.notes}
            onChange={(event) => updateField("notes", event.target.value)}
          />
        </label>

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        <button type="submit" disabled={isSaving || !selectedChapterId}>
          {isSaving ? "Saving..." : "Save Section"}
        </button>
      </form>
    </section>
  );
}

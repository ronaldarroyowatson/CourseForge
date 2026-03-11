import React, { useEffect, useRef, useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";
import { getNextIndex, incrementTrailingNumber } from "../../utils/predictiveText";

interface SectionFormProps {
  selectedChapterId: string | null;
  refreshKey: number;
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

export function SectionForm({ selectedChapterId, refreshKey, onSaved }: SectionFormProps): React.JSX.Element {
  const { createSection, fetchSectionsByChapterId } = useRepositories();
  const [form, setForm] = useState<SectionFormState>(INITIAL_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previousSuggestedIndex = useRef("");
  const previousSuggestedTitle = useRef("");

  function updateField<K extends keyof SectionFormState>(
    field: K,
    value: SectionFormState[K]
  ): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    let isMounted = true;

    async function loadSuggestions(): Promise<void> {
      if (!selectedChapterId) {
        previousSuggestedIndex.current = "";
        previousSuggestedTitle.current = "";
        setForm(INITIAL_FORM_STATE);
        return;
      }

      const sections = await fetchSectionsByChapterId(selectedChapterId);
      if (!isMounted) {
        return;
      }

      const sortedSections = [...sections].sort((left, right) => left.index - right.index);
      const lastSection = sortedSections.at(-1);
      const nextSuggestedIndex = getNextIndex(sortedSections.map((section) => section.index));
      const nextSuggestedTitle = lastSection ? incrementTrailingNumber(lastSection.title) : "";

      setForm((current) => ({
        ...current,
        index:
          current.index === "" || current.index === previousSuggestedIndex.current
            ? nextSuggestedIndex
            : current.index,
        title:
          current.title === "" || current.title === previousSuggestedTitle.current
            ? nextSuggestedTitle
            : current.title,
      }));

      previousSuggestedIndex.current = nextSuggestedIndex;
      previousSuggestedTitle.current = nextSuggestedTitle;
    }

    void loadSuggestions();

    return () => {
      isMounted = false;
    };
  }, [fetchSectionsByChapterId, refreshKey, selectedChapterId]);

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
      previousSuggestedIndex.current = "";
      previousSuggestedTitle.current = "";
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

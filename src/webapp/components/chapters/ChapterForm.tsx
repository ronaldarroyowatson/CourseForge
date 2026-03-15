import React, { useEffect, useRef, useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";
import { getNextIndex, incrementTrailingNumber } from "../../utils/predictiveText";

interface ChapterFormProps {
  selectedTextbookId: string | null;
  refreshKey: number;
  onSaved: (chapterId: string) => void;
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

export function ChapterForm({ selectedTextbookId, refreshKey, onSaved }: ChapterFormProps): React.JSX.Element {
  const { createChapter, fetchChaptersByTextbookId } = useRepositories();
  const [form, setForm] = useState<ChapterFormState>(INITIAL_FORM_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previousSuggestedIndex = useRef("");
  const previousSuggestedName = useRef("");

  function updateField<K extends keyof ChapterFormState>(
    field: K,
    value: ChapterFormState[K]
  ): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  useEffect(() => {
    let isMounted = true;

    async function loadSuggestions(): Promise<void> {
      if (!selectedTextbookId) {
        previousSuggestedIndex.current = "";
        previousSuggestedName.current = "";
        setForm(INITIAL_FORM_STATE);
        return;
      }

      const chapters = await fetchChaptersByTextbookId(selectedTextbookId);
      if (!isMounted) {
        return;
      }

      const sortedChapters = [...chapters].sort((left, right) => left.index - right.index);
      const lastChapter = sortedChapters.at(-1);
      const nextSuggestedIndex = getNextIndex(sortedChapters.map((chapter) => chapter.index));
      const nextSuggestedName = lastChapter ? incrementTrailingNumber(lastChapter.name) : "";

      setForm((current) => ({
        ...current,
        index:
          current.index === "" || current.index === previousSuggestedIndex.current
            ? nextSuggestedIndex
            : current.index,
        name:
          current.name === "" || current.name === previousSuggestedName.current
            ? nextSuggestedName
            : current.name,
      }));

      previousSuggestedIndex.current = nextSuggestedIndex;
      previousSuggestedName.current = nextSuggestedName;
    }

    void loadSuggestions();

    return () => {
      isMounted = false;
    };
  }, [fetchChaptersByTextbookId, refreshKey, selectedTextbookId]);

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
      const createdChapterId = await createChapter({
        sourceType: "manual",
        textbookId: selectedTextbookId,
        index: parsedIndex,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      });

      setForm(INITIAL_FORM_STATE);
      previousSuggestedIndex.current = "";
      previousSuggestedName.current = "";
      onSaved(createdChapterId);
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

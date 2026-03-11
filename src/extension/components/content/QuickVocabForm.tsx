import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface QuickVocabFormProps {
  selectedSectionId?: string;
  onSaved: () => void;
}

export function QuickVocabForm({ selectedSectionId, onSaved }: QuickVocabFormProps): React.JSX.Element {
  const { createVocabTerm } = useRepositories();
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedSectionId) {
      setErrorMessage("Select a section before adding vocab.");
      return;
    }

    try {
      setIsSaving(true);
      await createVocabTerm({
        sectionId: selectedSectionId,
        word: word.trim(),
        definition: definition.trim() || undefined,
      });
      setWord("");
      setDefinition("");
      setSuccessMessage("Vocab term saved.");
      onSaved();
    } catch {
      setErrorMessage("Unable to save vocab term.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="quick-form" onSubmit={handleSubmit}>
      <h3 className="quick-form-title">Quick Vocab</h3>
      {!selectedSectionId ? <p className="sidebar-note">Select a section to enable this form.</p> : null}
      <fieldset className="quick-form-fields" disabled={!selectedSectionId || isSaving}>
        <input
          placeholder="Word"
          value={word}
          onChange={(event) => setWord(event.target.value)}
          required
        />
        <input
          placeholder="Definition (optional)"
          value={definition}
          onChange={(event) => setDefinition(event.target.value)}
        />
      </fieldset>
      {successMessage ? <p className="sidebar-success">{successMessage}</p> : null}
      {errorMessage ? <p className="sidebar-error">{errorMessage}</p> : null}
      <button type="submit" disabled={!selectedSectionId || isSaving}>
        {isSaving ? "Saving..." : "Add Vocab"}
      </button>
    </form>
  );
}

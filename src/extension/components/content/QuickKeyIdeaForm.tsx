import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface QuickKeyIdeaFormProps {
  selectedSectionId?: string;
  onSaved: () => void;
}

export function QuickKeyIdeaForm({ selectedSectionId, onSaved }: QuickKeyIdeaFormProps): React.JSX.Element {
  const { createKeyIdea } = useRepositories();
  const [text, setText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedSectionId) {
      setErrorMessage("Select a section before adding key ideas.");
      return;
    }

    try {
      setIsSaving(true);
      await createKeyIdea({
        sectionId: selectedSectionId,
        text: text.trim(),
      });
      setText("");
      setSuccessMessage("Key idea saved.");
      onSaved();
    } catch {
      setErrorMessage("Unable to save key idea.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="quick-form" onSubmit={handleSubmit}>
      <h3 className="quick-form-title">Quick Key Idea</h3>
      {!selectedSectionId ? <p className="sidebar-note">Select a section to enable this form.</p> : null}
      <fieldset className="quick-form-fields" disabled={!selectedSectionId || isSaving}>
        <input
          placeholder="Key idea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          required
        />
      </fieldset>
      {successMessage ? <p className="sidebar-success">{successMessage}</p> : null}
      {errorMessage ? <p className="sidebar-error">{errorMessage}</p> : null}
      <button type="submit" disabled={!selectedSectionId || isSaving}>
        {isSaving ? "Saving..." : "Add Key Idea"}
      </button>
    </form>
  );
}

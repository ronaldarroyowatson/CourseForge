import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface QuickConceptFormProps {
  selectedSectionId?: string;
  onSaved: () => void;
}

export function QuickConceptForm({ selectedSectionId, onSaved }: QuickConceptFormProps): React.JSX.Element {
  const { createConcept } = useRepositories();
  const [name, setName] = useState("");
  const [explanation, setExplanation] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedSectionId) {
      setErrorMessage("Select a section before adding concepts.");
      return;
    }

    try {
      setIsSaving(true);
      await createConcept({
        sectionId: selectedSectionId,
        name: name.trim(),
        explanation: explanation.trim() || undefined,
      });
      setName("");
      setExplanation("");
      setSuccessMessage("Concept saved.");
      onSaved();
    } catch {
      setErrorMessage("Unable to save concept.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="quick-form" onSubmit={handleSubmit}>
      <h3 className="quick-form-title">Quick Concept</h3>
      {!selectedSectionId ? <p className="sidebar-note">Select a section to enable this form.</p> : null}
      <fieldset className="quick-form-fields" disabled={!selectedSectionId || isSaving}>
        <input
          placeholder="Concept name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <input
          placeholder="Explanation (optional)"
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </fieldset>
      {successMessage ? <p className="sidebar-success">{successMessage}</p> : null}
      {errorMessage ? <p className="sidebar-error">{errorMessage}</p> : null}
      <button type="submit" disabled={!selectedSectionId || isSaving}>
        {isSaving ? "Saving..." : "Add Concept"}
      </button>
    </form>
  );
}

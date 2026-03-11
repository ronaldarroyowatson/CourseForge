import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface QuickEquationFormProps {
  selectedSectionId?: string;
  onSaved: () => void;
}

export function QuickEquationForm({ selectedSectionId, onSaved }: QuickEquationFormProps): React.JSX.Element {
  const { createEquation } = useRepositories();
  const [name, setName] = useState("");
  const [latex, setLatex] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedSectionId) {
      setErrorMessage("Select a section before adding equations.");
      return;
    }

    try {
      setIsSaving(true);
      await createEquation({
        sectionId: selectedSectionId,
        name: name.trim(),
        latex: latex.trim(),
        description: description.trim() || undefined,
      });
      setName("");
      setLatex("");
      setDescription("");
      setSuccessMessage("Equation saved.");
      onSaved();
    } catch {
      setErrorMessage("Unable to save equation.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="quick-form" onSubmit={handleSubmit}>
      <h3 className="quick-form-title">Quick Equation</h3>
      {!selectedSectionId ? <p className="sidebar-note">Select a section to enable this form.</p> : null}
      <fieldset className="quick-form-fields" disabled={!selectedSectionId || isSaving}>
        <input
          placeholder="Equation name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <input
          placeholder="LaTeX"
          value={latex}
          onChange={(event) => setLatex(event.target.value)}
          required
        />
        <input
          placeholder="Description (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </fieldset>
      {successMessage ? <p className="sidebar-success">{successMessage}</p> : null}
      {errorMessage ? <p className="sidebar-error">{errorMessage}</p> : null}
      <button type="submit" disabled={!selectedSectionId || isSaving}>
        {isSaving ? "Saving..." : "Add Equation"}
      </button>
    </form>
  );
}

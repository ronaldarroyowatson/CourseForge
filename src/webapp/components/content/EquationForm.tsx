import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface EquationFormProps {
  selectedSectionId: string | null;
  onSaved: () => void;
}

export function EquationForm({ selectedSectionId, onSaved }: EquationFormProps): React.JSX.Element {
  const { createEquation } = useRepositories();
  const [name, setName] = useState("");
  const [latex, setLatex] = useState("");
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedSectionId) {
      setErrorMessage("Select a section before adding equations.");
      return;
    }

    try {
      await createEquation({
        sectionId: selectedSectionId,
        name: name.trim(),
        latex: latex.trim(),
        description: description.trim() || undefined,
      });
      setName("");
      setLatex("");
      setDescription("");
      onSaved();
    } catch {
      setErrorMessage("Unable to save equation.");
    }
  }

  return (
    <section className="panel">
      <h3>Add Equation</h3>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          LaTeX
          <input value={latex} onChange={(event) => setLatex(event.target.value)} required />
        </label>
        <label>
          Description (optional)
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        <button type="submit" disabled={!selectedSectionId}>
          Save Equation
        </button>
      </form>
    </section>
  );
}

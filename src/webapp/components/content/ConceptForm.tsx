import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface ConceptFormProps {
  selectedSectionId: string | null;
  onSaved: () => void;
}

export function ConceptForm({ selectedSectionId, onSaved }: ConceptFormProps): React.JSX.Element {
  const { createConcept } = useRepositories();
  const [name, setName] = useState("");
  const [explanation, setExplanation] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedSectionId) {
      setErrorMessage("Select a section before adding concepts.");
      return;
    }

    try {
      await createConcept({
        sectionId: selectedSectionId,
        name: name.trim(),
        explanation: explanation.trim() || undefined,
      });
      setName("");
      setExplanation("");
      onSaved();
    } catch {
      setErrorMessage("Unable to save concept.");
    }
  }

  return (
    <section className="panel">
      <h3>Add Concept</h3>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Explanation (optional)
          <input value={explanation} onChange={(event) => setExplanation(event.target.value)} />
        </label>
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        <button type="submit" disabled={!selectedSectionId}>
          Save Concept
        </button>
      </form>
    </section>
  );
}

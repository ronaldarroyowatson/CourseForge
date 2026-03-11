import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface VocabFormProps {
  selectedSectionId: string | null;
  onSaved: () => void;
}

export function VocabForm({ selectedSectionId, onSaved }: VocabFormProps): React.JSX.Element {
  const { createVocabTerm } = useRepositories();
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedSectionId) {
      setErrorMessage("Select a section before adding vocab.");
      return;
    }

    try {
      await createVocabTerm({
        sectionId: selectedSectionId,
        word: word.trim(),
        definition: definition.trim() || undefined,
      });
      setWord("");
      setDefinition("");
      onSaved();
    } catch {
      setErrorMessage("Unable to save vocab term.");
    }
  }

  return (
    <section className="panel">
      <h3>Add Vocab</h3>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Word
          <input value={word} onChange={(event) => setWord(event.target.value)} required />
        </label>
        <label>
          Definition (optional)
          <input value={definition} onChange={(event) => setDefinition(event.target.value)} />
        </label>
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        <button type="submit" disabled={!selectedSectionId}>
          Save Vocab
        </button>
      </form>
    </section>
  );
}

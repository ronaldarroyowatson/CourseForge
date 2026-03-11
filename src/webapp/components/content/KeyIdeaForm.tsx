import React, { useState } from "react";

import { useRepositories } from "../../hooks/useRepositories";

interface KeyIdeaFormProps {
  selectedSectionId: string | null;
  onSaved: () => void;
}

export function KeyIdeaForm({ selectedSectionId, onSaved }: KeyIdeaFormProps): React.JSX.Element {
  const { createKeyIdea } = useRepositories();
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);

    if (!selectedSectionId) {
      setErrorMessage("Select a section before adding key ideas.");
      return;
    }

    try {
      await createKeyIdea({
        sectionId: selectedSectionId,
        text: text.trim(),
      });
      setText("");
      onSaved();
    } catch {
      setErrorMessage("Unable to save key idea.");
    }
  }

  return (
    <section className="panel">
      <h3>Add Key Idea</h3>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Text
          <input value={text} onChange={(event) => setText(event.target.value)} required />
        </label>
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        <button type="submit" disabled={!selectedSectionId}>
          Save Key Idea
        </button>
      </form>
    </section>
  );
}

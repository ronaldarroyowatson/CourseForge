import React from "react";

import type { VocabTerm } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface VocabPanelProps {
  selectedSectionId: string | null;
}

export function VocabPanel({ selectedSectionId }: VocabPanelProps): React.JSX.Element {
  const { createVocabTerm, fetchVocabTermsBySectionId, removeVocabTerm } = useRepositories();
  const [terms, setTerms] = React.useState<VocabTerm[]>([]);
  const [word, setWord] = React.useState("");
  const [definition, setDefinition] = React.useState("");
  const termInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    async function loadTerms(): Promise<void> {
      if (!selectedSectionId) {
        setTerms([]);
        return;
      }

      const rows = await fetchVocabTermsBySectionId(selectedSectionId);
      if (!isMounted) {
        return;
      }

      setTerms(rows);
    }

    void loadTerms();

    return () => {
      isMounted = false;
    };
  }, [fetchVocabTermsBySectionId, selectedSectionId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedWord = word.trim();
    const trimmedDefinition = definition.trim();

    if (!trimmedWord || !trimmedDefinition || !selectedSectionId) {
      return;
    }

    const id = await createVocabTerm({
      sectionId: selectedSectionId,
      word: trimmedWord,
      definition: trimmedDefinition,
    });

    setWord("");
    setDefinition("");
    const rows = await fetchVocabTermsBySectionId(selectedSectionId);
    setTerms(rows);
    window.requestAnimationFrame(() => {
      termInputRef.current?.focus();
    });

    if (!rows.some((row) => row.id === id)) {
      setTerms((current) => current);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    await removeVocabTerm(id);
    setTerms((current) => current.filter((term) => term.id !== id));
  }

  return (
    <section className="panel">
      <h3>Add Vocab</h3>
      <form onSubmit={(event) => { void handleSubmit(event); }} className="form-grid">
        <label>
          Word
          <input ref={termInputRef} value={word} onChange={(event) => setWord(event.target.value)} required />
        </label>
        <label>
          Definition
          <input value={definition} onChange={(event) => setDefinition(event.target.value)} required />
        </label>
        <button type="submit">Save Vocab</button>
      </form>

      {!selectedSectionId ? <p>Select a section to add vocab terms.</p> : null}

      <ul className="textbook-list content-list">
        {terms.map((term) => (
          <li key={term.id} className="textbook-row">
            <div>
              <strong>{term.word}</strong>
              {term.definition ? <p>{term.definition}</p> : null}
            </div>
            <button type="button" onClick={() => { void handleDelete(term.id); }}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

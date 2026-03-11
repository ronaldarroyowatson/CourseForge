import React, { useEffect, useState } from "react";

import type { VocabTerm } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface VocabListProps {
  selectedSectionId: string | null;
  refreshKey: number;
}

export function VocabList({ selectedSectionId, refreshKey }: VocabListProps): React.JSX.Element {
  const { fetchVocabTermsBySectionId, removeVocabTerm } = useRepositories();
  const [items, setItems] = useState<VocabTerm[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      if (!selectedSectionId) {
        setItems([]);
        return;
      }

      try {
        const results = await fetchVocabTermsBySectionId(selectedSectionId);
        setItems(results);
      } catch {
        setErrorMessage("Unable to load vocab terms.");
      }
    }

    void load();
  }, [fetchVocabTermsBySectionId, refreshKey, selectedSectionId]);

  async function handleDelete(id: string): Promise<void> {
    await removeVocabTerm(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <section className="panel">
      <h3>Vocab Terms</h3>
      {!selectedSectionId ? <p>Select a section to view vocab.</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      <ul className="textbook-list">
        {items.map((item) => (
          <li key={item.id} className="textbook-row">
            <div>
              <strong>{item.word}</strong>
              {item.definition ? <p>{item.definition}</p> : null}
            </div>
            <button type="button" onClick={() => void handleDelete(item.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

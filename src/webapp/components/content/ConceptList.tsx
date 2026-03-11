import React, { useEffect, useState } from "react";

import type { Concept } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface ConceptListProps {
  selectedSectionId: string | null;
  refreshKey: number;
}

export function ConceptList({ selectedSectionId, refreshKey }: ConceptListProps): React.JSX.Element {
  const { fetchConceptsBySectionId, removeConcept } = useRepositories();
  const [items, setItems] = useState<Concept[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      if (!selectedSectionId) {
        setItems([]);
        return;
      }

      try {
        const results = await fetchConceptsBySectionId(selectedSectionId);
        setItems(results);
      } catch {
        setErrorMessage("Unable to load concepts.");
      }
    }

    void load();
  }, [fetchConceptsBySectionId, refreshKey, selectedSectionId]);

  async function handleDelete(id: string): Promise<void> {
    await removeConcept(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <section className="panel">
      <h3>Concepts</h3>
      {!selectedSectionId ? <p>Select a section to view concepts.</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      <ul className="textbook-list">
        {items.map((item) => (
          <li key={item.id} className="textbook-row">
            <div>
              <strong>{item.name}</strong>
              {item.explanation ? <p>{item.explanation}</p> : null}
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

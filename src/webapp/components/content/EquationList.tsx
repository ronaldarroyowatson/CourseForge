import React, { useEffect, useState } from "react";

import type { Equation } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface EquationListProps {
  selectedSectionId: string | null;
  refreshKey: number;
}

export function EquationList({ selectedSectionId, refreshKey }: EquationListProps): React.JSX.Element {
  const { fetchEquationsBySectionId, removeEquation } = useRepositories();
  const [items, setItems] = useState<Equation[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      if (!selectedSectionId) {
        setItems([]);
        return;
      }

      try {
        const results = await fetchEquationsBySectionId(selectedSectionId);
        setItems(results);
      } catch {
        setErrorMessage("Unable to load equations.");
      }
    }

    void load();
  }, [fetchEquationsBySectionId, refreshKey, selectedSectionId]);

  async function handleDelete(id: string): Promise<void> {
    await removeEquation(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <section className="panel">
      <h3>Equations</h3>
      {!selectedSectionId ? <p>Select a section to view equations.</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      <ul className="textbook-list">
        {items.map((item) => (
          <li key={item.id} className="textbook-row">
            <div>
              <strong>{item.name}</strong>
              <p>{item.latex}</p>
              {item.description ? <p>{item.description}</p> : null}
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

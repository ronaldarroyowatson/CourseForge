import React, { useEffect, useState } from "react";

import type { KeyIdea } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface KeyIdeaListProps {
  selectedSectionId: string | null;
  refreshKey: number;
}

export function KeyIdeaList({ selectedSectionId, refreshKey }: KeyIdeaListProps): React.JSX.Element {
  const { fetchKeyIdeasBySectionId, removeKeyIdea } = useRepositories();
  const [items, setItems] = useState<KeyIdea[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      if (!selectedSectionId) {
        setItems([]);
        return;
      }

      try {
        const results = await fetchKeyIdeasBySectionId(selectedSectionId);
        setItems(results);
      } catch {
        setErrorMessage("Unable to load key ideas.");
      }
    }

    void load();
  }, [fetchKeyIdeasBySectionId, refreshKey, selectedSectionId]);

  async function handleDelete(id: string): Promise<void> {
    await removeKeyIdea(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <section className="panel">
      <h3>Key Ideas</h3>
      {!selectedSectionId ? <p>Select a section to view key ideas.</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      <ul className="textbook-list">
        {items.map((item) => (
          <li key={item.id} className="textbook-row">
            <div>
              <p>{item.text}</p>
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

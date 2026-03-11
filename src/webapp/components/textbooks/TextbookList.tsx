import React, { useState } from "react";

import type { Textbook } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface TextbookListProps {
  textbooks: Textbook[];
  isLoading: boolean;
  loadError: string | null;
  selectedTextbookId: string | null;
  onSelectTextbook: (id: string) => void;
  onDeleted: (id: string) => void;
}

export function TextbookList({
  textbooks,
  isLoading,
  loadError,
  selectedTextbookId,
  onSelectTextbook,
  onDeleted,
}: TextbookListProps): React.JSX.Element {
  const { removeTextbook } = useRepositories();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDelete(id: string): Promise<void> {
    try {
      await removeTextbook(id);
      onDeleted(id);
    } catch {
      setErrorMessage("Unable to delete textbook.");
    }
  }

  return (
    <section className="panel">
      <h3>Textbooks</h3>

      {isLoading ? <p>Loading textbooks...</p> : null}
      {loadError ? <p className="error-text">{loadError}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {!isLoading && textbooks.length === 0 ? <p>No textbooks yet.</p> : null}

      <ul className="textbook-list">
        {textbooks.map((textbook) => (
          <li key={textbook.id} className="textbook-row">
            <div>
              <strong>{textbook.title}</strong>
              <p>
                Grade {textbook.grade} • {textbook.subject} • {textbook.publicationYear}
              </p>
              <p>
                <button
                  type="button"
                  onClick={() => onSelectTextbook(textbook.id)}
                  disabled={selectedTextbookId === textbook.id}
                >
                  {selectedTextbookId === textbook.id ? "Selected" : "Select"}
                </button>
              </p>
            </div>

            <button type="button" onClick={() => void handleDelete(textbook.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

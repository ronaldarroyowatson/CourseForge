import React, { useEffect, useState } from "react";

import type { Textbook } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface TextbookListProps {
  refreshKey: number;
  selectedTextbookId: string | null;
  onSelectTextbook: (id: string) => void;
}

export function TextbookList({
  refreshKey,
  selectedTextbookId,
  onSelectTextbook,
}: TextbookListProps): React.JSX.Element {
  const { fetchTextbooks, removeTextbook } = useRepositories();
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTextbooks(): Promise<void> {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const results = await fetchTextbooks();

        if (isMounted) {
          setTextbooks(results);
        }
      } catch {
        if (isMounted) {
          setErrorMessage("Unable to load textbooks.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadTextbooks();

    return () => {
      isMounted = false;
    };
  }, [fetchTextbooks, refreshKey]);

  async function handleDelete(id: string): Promise<void> {
    try {
      await removeTextbook(id);
      setTextbooks((current) => current.filter((textbook) => textbook.id !== id));
    } catch {
      setErrorMessage("Unable to delete textbook.");
    }
  }

  return (
    <section className="panel">
      <h3>Textbooks</h3>

      {isLoading ? <p>Loading textbooks...</p> : null}
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

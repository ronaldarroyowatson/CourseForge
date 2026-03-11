import React, { useState } from "react";
import { ArchiveIcon } from "../icons/ArchiveIcon";
import { PencilIcon } from "../icons/PencilIcon";
import { StarIcon } from "../icons/StarIcon";

import type { Textbook } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";
import { useUIStore } from "../../store/uiStore";

interface TextbookListProps {
  textbooks: Textbook[];
  isLoading: boolean;
  loadError: string | null;
  selectedTextbookId: string | null;
  onSelectTextbook: (id: string) => void;
  onDeleted: (id: string) => void;
  onRefresh: () => void;
}

function sortTextbooks(textbooks: Textbook[]): Textbook[] {
  return [...textbooks].sort((a, b) => {
    // Favorites first
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    // Archived last
    if (a.isArchived && !b.isArchived) return 1;
    if (!a.isArchived && b.isArchived) return -1;
    return 0;
  });
}

export function TextbookList({
  textbooks,
  isLoading,
  loadError,
  selectedTextbookId,
  onSelectTextbook,
  onDeleted,
  onRefresh,
}: TextbookListProps): React.JSX.Element {
  const { removeTextbook, toggleTextbookFavorite, toggleTextbookArchive } = useRepositories();
  const { setSelectedTextbook } = useUIStore();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDelete(id: string): Promise<void> {
    try {
      await removeTextbook(id);
      onDeleted(id);
    } catch {
      setErrorMessage("Unable to delete textbook.");
    }
  }

  async function handleToggleFavorite(textbook: Textbook): Promise<void> {
    try {
      await toggleTextbookFavorite(textbook.id, !textbook.isFavorite);
      onRefresh();
    } catch {
      setErrorMessage("Unable to update favorite status.");
    }
  }

  async function handleToggleArchive(textbook: Textbook): Promise<void> {
    try {
      await toggleTextbookArchive(textbook.id, !textbook.isArchived);
      onRefresh();
    } catch {
      setErrorMessage("Unable to update archive status.");
    }
  }

  function handleEdit(textbook: Textbook): void {
    setSelectedTextbook(textbook);
  }

  const sorted = sortTextbooks(textbooks);

  return (
    <section className="panel">
      <h3>Textbooks</h3>

      {isLoading ? <p>Loading textbooks...</p> : null}
      {loadError ? <p className="error-text">{loadError}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {!isLoading && textbooks.length === 0 ? <p>No textbooks yet.</p> : null}

      <ul className="textbook-list">
        {sorted.map((textbook) => (
          <li
            key={textbook.id}
            className={[
              "textbook-row",
              textbook.isArchived ? "textbook-row--archived" : "",
              textbook.isFavorite ? "textbook-row--favorite" : "",
            ].filter(Boolean).join(" ")}
          >
            <div className="textbook-row__info">
              <strong>{textbook.title}</strong>
              <p>
                Grade {textbook.grade} &bull; {textbook.subject} &bull; {textbook.publicationYear}
              </p>
              <div className="textbook-row__actions">
                <button
                  type="button"
                  onClick={() => onSelectTextbook(textbook.id)}
                  disabled={selectedTextbookId === textbook.id}
                >
                  {selectedTextbookId === textbook.id ? "Selected" : "Select"}
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(textbook)}
                  className="btn-icon"
                  title="Edit textbook"
                  aria-label="Edit textbook"
                >
                  <PencilIcon size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleFavorite(textbook)}
                  className="btn-icon"
                  title="Favorite textbook"
                  aria-label="Favorite textbook"
                  aria-pressed={textbook.isFavorite}
                >
                  <StarIcon size={15} filled={textbook.isFavorite} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleArchive(textbook)}
                  className="btn-icon"
                  title="Archive textbook"
                  aria-label="Archive textbook"
                  aria-pressed={textbook.isArchived}
                >
                  <ArchiveIcon size={15} />
                </button>
              </div>
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

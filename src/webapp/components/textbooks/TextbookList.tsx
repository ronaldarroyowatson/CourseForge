import React, { useState } from "react";
import { ArchiveIcon } from "../icons/ArchiveIcon";
import { PencilIcon } from "../icons/PencilIcon";
import { StarIcon } from "../icons/StarIcon";

import type { Textbook } from "../../../core/models";
import { syncNow } from "../../../core/services/syncService";
import { useRepositories } from "../../hooks/useRepositories";
import { useUIStore } from "../../store/uiStore";

interface TextbookListProps {
  textbooks: Textbook[];
  isLoading: boolean;
  loadError: string | null;
  selectedTextbookId: string | null;
  onSelectTextbook: (id: string) => void;
  onContinueToSections: () => void;
  onDeleted: (id: string) => void;
  onRefresh: () => void;
}

function getSyncBadge(textbook: Textbook): { label: string; className: string } {
  if (textbook.pendingSync) {
    return { label: "Pending cloud sync", className: "sync-badge sync-badge--pending" };
  }

  if (textbook.source === "cloud") {
    return { label: "Cloud synced", className: "sync-badge sync-badge--synced" };
  }

  return { label: "Local only", className: "sync-badge sync-badge--local" };
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
  onContinueToSections,
  onDeleted,
  onRefresh,
}: TextbookListProps): React.JSX.Element {
  const { removeTextbook, toggleTextbookFavorite, toggleTextbookArchive } = useRepositories();
  const { setSelectedTextbook } = useUIStore();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retrySyncInProgress, setRetrySyncInProgress] = useState<Set<string>>(new Set());

  async function handleDelete(id: string): Promise<void> {
    onDeleted(id);

    try {
      await removeTextbook(id);
    } catch {
      setErrorMessage("Unable to delete textbook.");
      onRefresh();
    }
  }

  async function handleRetrySync(textbookId: string): Promise<void> {
    setRetrySyncInProgress((prev) => new Set(prev).add(textbookId));

    try {
      await syncNow();
      onRefresh();
    } catch {
      setErrorMessage("Unable to retry cloud sync. Please try again.");
    } finally {
      setRetrySyncInProgress((prev) => {
        const next = new Set(prev);
        next.delete(textbookId);
        return next;
      });
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

      <div className="nav-button-row">
        <button
          type="button"
          onClick={onContinueToSections}
          disabled={!selectedTextbookId}
          aria-label="Continue to sections"
        >
          Continue to Sections
        </button>
      </div>

      <ul className="textbook-list">
        {sorted.map((textbook) => {
          const syncBadge = getSyncBadge(textbook);

          return (<li
            key={textbook.id}
            className={[
              "textbook-row",
              textbook.isArchived ? "textbook-row--archived" : "",
              textbook.isFavorite ? "textbook-row--favorite" : "",
            ].filter(Boolean).join(" ")}
          >
            {textbook.coverImageUrl ? (
              <img
                src={textbook.coverImageUrl}
                alt={`${textbook.title} cover`}
                className="textbook-row__cover"
              />
            ) : null}

            <div className="textbook-row__info">
              <strong>{textbook.title}</strong>
              {textbook.subtitle ? <p className="textbook-row__meta">{textbook.subtitle}</p> : null}
              <p>
                Grade {textbook.grade} &bull; {textbook.subject} &bull; {textbook.publicationYear}
              </p>
              {textbook.seriesName || textbook.publisher || textbook.gradeBand ? (
                <p className="textbook-row__meta">
                  {textbook.seriesName ? `Series: ${textbook.seriesName}` : ""}
                  {textbook.seriesName && textbook.publisher ? " • " : ""}
                  {textbook.publisher ? `Publisher: ${textbook.publisher}` : ""}
                  {(textbook.seriesName || textbook.publisher) && textbook.gradeBand ? " • " : ""}
                  {textbook.gradeBand ? `Grade Band: ${textbook.gradeBand}` : ""}
                </p>
              ) : null}
              <p className="textbook-row__meta">
                ISBN: {textbook.isbnRaw?.trim() ? textbook.isbnRaw : "Not set"}
                {textbook.relatedIsbns && textbook.relatedIsbns.length > 0 ? (
                  <span className="related-isbn-badge">
                    {" "}+{textbook.relatedIsbns.length} related
                  </span>
                ) : null}
              </p>
              <p className="textbook-row__meta">
                <span className={syncBadge.className}>{syncBadge.label}</span>
                {textbook.pendingSync && (
                  <button
                    type="button"
                    onClick={() => void handleRetrySync(textbook.id)}
                    disabled={retrySyncInProgress.has(textbook.id)}
                    title="Retry cloud sync"
                    aria-label="Retry cloud sync"
                    className="btn-retry-sync"
                  >
                    {retrySyncInProgress.has(textbook.id) ? "Retrying..." : "Retry Sync"}
                  </button>
                )}
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
                >
                  <StarIcon size={15} filled={textbook.isFavorite} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleArchive(textbook)}
                  className="btn-icon"
                  title="Archive textbook"
                  aria-label="Archive textbook"
                >
                  <ArchiveIcon size={15} />
                </button>
              </div>
            </div>

            <button type="button" onClick={() => void handleDelete(textbook.id)}>
              Delete
            </button>
          </li>);
        })}
      </ul>
    </section>
  );
}

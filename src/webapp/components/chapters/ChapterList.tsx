import React, { useEffect, useState } from "react";

import type { Chapter } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface ChapterListProps {
  selectedTextbookId: string | null;
  selectedChapterId: string | null;
  onSelectChapter: (id: string) => void;
  refreshKey: number;
}

export function ChapterList({
  selectedTextbookId,
  selectedChapterId,
  onSelectChapter,
  refreshKey,
}: ChapterListProps): React.JSX.Element {
  const { fetchChaptersByTextbookId, removeChapter } = useRepositories();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadChapters(): Promise<void> {
      if (!selectedTextbookId) {
        setChapters([]);
        return;
      }

      try {
        setIsLoading(true);
        setErrorMessage(null);
        const results = await fetchChaptersByTextbookId(selectedTextbookId);

        if (isMounted) {
          setChapters(results);
        }
      } catch {
        if (isMounted) {
          setErrorMessage("Unable to load chapters.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadChapters();

    return () => {
      isMounted = false;
    };
  }, [fetchChaptersByTextbookId, refreshKey, selectedTextbookId]);

  async function handleDelete(id: string): Promise<void> {
    try {
      await removeChapter(id);
      setChapters((current) => current.filter((chapter) => chapter.id !== id));
    } catch {
      setErrorMessage("Unable to delete chapter.");
    }
  }

  return (
    <section className="panel">
      <h3>Chapters</h3>

      {!selectedTextbookId ? <p>Select a textbook to view chapters.</p> : null}
      {isLoading ? <p>Loading chapters...</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {selectedTextbookId && !isLoading && chapters.length === 0 ? <p>No chapters yet.</p> : null}

      <ul className="textbook-list">
        {chapters.map((chapter) => (
          <li key={chapter.id} className="textbook-row">
            <div>
              <strong>
                {chapter.index}. {chapter.name}
              </strong>
              {chapter.description ? <p>{chapter.description}</p> : null}
              <p>
                <button
                  type="button"
                  onClick={() => onSelectChapter(chapter.id)}
                  disabled={selectedChapterId === chapter.id}
                >
                  {selectedChapterId === chapter.id ? "Selected" : "Select"}
                </button>
              </p>
            </div>

            <button type="button" onClick={() => void handleDelete(chapter.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

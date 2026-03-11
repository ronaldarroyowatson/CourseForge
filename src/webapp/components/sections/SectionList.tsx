import React, { useEffect, useState } from "react";

import type { Section } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface SectionListProps {
  selectedChapterId: string | null;
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  refreshKey: number;
}

export function SectionList({
  selectedChapterId,
  selectedSectionId,
  onSelectSection,
  refreshKey,
}: SectionListProps): React.JSX.Element {
  const { fetchSectionsByChapterId, removeSection } = useRepositories();
  const [sections, setSections] = useState<Section[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSections(): Promise<void> {
      if (!selectedChapterId) {
        setSections([]);
        return;
      }

      try {
        setIsLoading(true);
        setErrorMessage(null);
        const results = await fetchSectionsByChapterId(selectedChapterId);

        if (isMounted) {
          setSections(results);
        }
      } catch {
        if (isMounted) {
          setErrorMessage("Unable to load sections.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSections();

    return () => {
      isMounted = false;
    };
  }, [fetchSectionsByChapterId, refreshKey, selectedChapterId]);

  async function handleDelete(id: string): Promise<void> {
    try {
      await removeSection(id);
      setSections((current) => current.filter((section) => section.id !== id));
      if (selectedSectionId === id) {
        onSelectSection(null);
      }
    } catch {
      setErrorMessage("Unable to delete section.");
    }
  }

  return (
    <section className="panel">
      <h3>Sections</h3>

      {!selectedChapterId ? <p>Select a chapter to view sections.</p> : null}
      {isLoading ? <p>Loading sections...</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {selectedChapterId && !isLoading && sections.length === 0 ? <p>No sections yet.</p> : null}

      <ul className="textbook-list">
        {sections.map((section) => (
          <li key={section.id} className="textbook-row">
            <div>
              <strong>
                {section.index}. {section.title}
              </strong>
              {section.notes ? <p>{section.notes}</p> : null}
              <p>
                <button
                  type="button"
                  onClick={() => onSelectSection(section.id)}
                  disabled={selectedSectionId === section.id}
                >
                  {selectedSectionId === section.id ? "Selected" : "Select"}
                </button>
              </p>
            </div>

            <button type="button" onClick={() => void handleDelete(section.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

import React, { useEffect, useState } from "react";

import type { Section } from "../../../core/models";
import {
  listConceptsBySectionId,
  listKeyIdeasBySectionId,
  listVocabTermsBySectionId,
} from "../../../core/services/repositories";
import { useRepositories } from "../../hooks/useRepositories";

interface SectionContentCounts {
  vocab: number;
  concepts: number;
  keyIdeas: number;
}

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
  const [contentCounts, setContentCounts] = useState<Map<string, SectionContentCounts>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSections(): Promise<void> {
      if (!selectedChapterId) {
        setSections([]);
        setContentCounts(new Map());
        return;
      }

      try {
        setIsLoading(true);
        setErrorMessage(null);
        const results = await fetchSectionsByChapterId(selectedChapterId);

        if (isMounted) {
          setSections(results);

          const countEntries = await Promise.all(
            results.map(async (section) => {
              const [vocab, concepts, keyIdeas] = await Promise.all([
                listVocabTermsBySectionId(section.id),
                listConceptsBySectionId(section.id),
                listKeyIdeasBySectionId(section.id),
              ]);
              return {
                id: section.id,
                counts: { vocab: vocab.length, concepts: concepts.length, keyIdeas: keyIdeas.length },
              };
            })
          );

          if (isMounted) {
            const map = new Map<string, SectionContentCounts>();
            countEntries.forEach(({ id, counts }) => map.set(id, counts));
            setContentCounts(map);
          }
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
      setContentCounts((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
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
        {sections.map((section) => {
          const counts = contentCounts.get(section.id);
          const hasContent = Boolean(counts && (counts.vocab > 0 || counts.concepts > 0 || counts.keyIdeas > 0));
          const hasNotes = Boolean(section.notes?.trim());
          const isComplete = hasNotes && hasContent;
          const rowClassName = isComplete
            ? "textbook-row textbook-row--complete"
            : "textbook-row textbook-row--needs-attention";

          return (
            <li key={section.id} className={rowClassName}>
              <div>
                <strong>
                  {section.index}. {section.title}
                </strong>
                <span
                  className={
                    isComplete
                      ? "content-health-badge content-health-badge--ready"
                      : "content-health-badge content-health-badge--missing"
                  }
                >
                  {isComplete
                    ? "Ready"
                    : !hasNotes && !hasContent
                    ? "Missing Notes & Content"
                    : !hasNotes
                    ? "Missing Notes"
                    : "No Content Imported"}
                </span>
                {counts && hasContent ? (
                  <p className="section-content-counts">
                    {[
                      counts.vocab > 0 ? `${counts.vocab} vocab` : null,
                      counts.concepts > 0 ? `${counts.concepts} concepts` : null,
                      counts.keyIdeas > 0 ? `${counts.keyIdeas} key ideas` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {section.notes ? <p>{section.notes}</p> : <p>Add section notes to mark this section complete.</p>}
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
          );
        })}
      </ul>
    </section>
  );
}

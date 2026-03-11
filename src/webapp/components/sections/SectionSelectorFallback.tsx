import React from "react";

import type { Chapter, Section } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface SectionSelectorFallbackProps {
  selectedTextbookId: string | null;
  selectedChapterId: string | null;
  selectedSectionId: string | null;
  onSelectChapter: (chapterId: string | null) => void;
  onSelectSection: (sectionId: string | null) => void;
}

export function SectionSelectorFallback({
  selectedTextbookId,
  selectedChapterId,
  selectedSectionId,
  onSelectChapter,
  onSelectSection,
}: SectionSelectorFallbackProps): React.JSX.Element {
  const { fetchChaptersByTextbookId, fetchSectionsByChapterId } = useRepositories();
  const [chapters, setChapters] = React.useState<Chapter[]>([]);
  const [sections, setSections] = React.useState<Section[]>([]);

  React.useEffect(() => {
    let isMounted = true;

    async function loadChapters(): Promise<void> {
      if (!selectedTextbookId) {
        setChapters([]);
        return;
      }

      const rows = await fetchChaptersByTextbookId(selectedTextbookId);
      if (!isMounted) {
        return;
      }

      setChapters(rows);
    }

    void loadChapters();

    return () => {
      isMounted = false;
    };
  }, [fetchChaptersByTextbookId, selectedTextbookId]);

  React.useEffect(() => {
    let isMounted = true;

    async function loadSections(): Promise<void> {
      if (!selectedChapterId) {
        setSections([]);
        return;
      }

      const rows = await fetchSectionsByChapterId(selectedChapterId);
      if (!isMounted) {
        return;
      }

      setSections(rows);
    }

    void loadSections();

    return () => {
      isMounted = false;
    };
  }, [fetchSectionsByChapterId, selectedChapterId]);

  return (
    <section className="panel">
      <h3>Section Selector</h3>
      <p className="form-hint">Use this fallback selector if automatic selection fails.</p>

      <div className="form-grid">
        <label>
          Chapter
          <select
            value={selectedChapterId ?? ""}
            onChange={(event) => {
              const nextChapterId = event.target.value || null;
              onSelectChapter(nextChapterId);
              onSelectSection(null);
            }}
            disabled={!selectedTextbookId}
          >
            <option value="">Select chapter</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.index}. {chapter.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Section
          <select
            value={selectedSectionId ?? ""}
            onChange={(event) => {
              onSelectSection(event.target.value || null);
            }}
            disabled={!selectedChapterId}
          >
            <option value="">Select section</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.index}. {section.title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

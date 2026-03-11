import React, { useEffect, useState } from "react";

import type { Chapter } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface ChapterSelectorProps {
  selectedTextbookId?: string;
  selectedChapterId?: string;
  onSelectChapter: (id: string | undefined) => void;
}

export function ChapterSelector({
  selectedTextbookId,
  selectedChapterId,
  onSelectChapter,
}: ChapterSelectorProps): React.JSX.Element {
  const { fetchChaptersByTextbookId } = useRepositories();
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    async function loadChapters(): Promise<void> {
      if (!selectedTextbookId) {
        setChapters([]);
        return;
      }

      const results = await fetchChaptersByTextbookId(selectedTextbookId);
      setChapters(results);
    }

    void loadChapters();
  }, [fetchChaptersByTextbookId, selectedTextbookId]);

  return (
    <label className="selector-field">
      Chapter
      <select
        value={selectedChapterId ?? ""}
        onChange={(event) => onSelectChapter(event.target.value || undefined)}
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
  );
}

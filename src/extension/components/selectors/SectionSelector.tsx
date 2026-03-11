import React, { useEffect, useState } from "react";

import type { Section } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface SectionSelectorProps {
  selectedChapterId?: string;
  selectedSectionId?: string;
  onSelectSection: (id: string | undefined) => void;
}

export function SectionSelector({
  selectedChapterId,
  selectedSectionId,
  onSelectSection,
}: SectionSelectorProps): React.JSX.Element {
  const { fetchSectionsByChapterId } = useRepositories();
  const [sections, setSections] = useState<Section[]>([]);

  useEffect(() => {
    async function loadSections(): Promise<void> {
      if (!selectedChapterId) {
        setSections([]);
        return;
      }

      const results = await fetchSectionsByChapterId(selectedChapterId);
      setSections(results);
    }

    void loadSections();
  }, [fetchSectionsByChapterId, selectedChapterId]);

  return (
    <label className="selector-field">
      Section
      <select
        value={selectedSectionId ?? ""}
        onChange={(event) => onSelectSection(event.target.value || undefined)}
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
  );
}

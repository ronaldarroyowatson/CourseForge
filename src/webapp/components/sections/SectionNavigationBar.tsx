import React from "react";

import type { Section } from "../../../core/models";

interface SectionNavigationBarProps {
  selectedSection: Section | null;
  previousSection: Section | null;
  nextSection: Section | null;
  onSelectSection: (sectionId: string) => void;
  onOpenContent: (panel: "vocab" | "equations" | "concepts") => void;
  onOpenPowerPoints: () => void;
}

export function SectionNavigationBar({
  selectedSection,
  previousSection,
  nextSection,
  onSelectSection,
  onOpenContent,
  onOpenPowerPoints,
}: SectionNavigationBarProps): React.JSX.Element {
  return (
    <section className="panel section-nav-panel" aria-label="Section navigation controls">
      <h3>Section Navigation</h3>

      <div className="nav-button-row">
        <button
          type="button"
          onClick={() => {
            if (previousSection) {
              onSelectSection(previousSection.id);
            }
          }}
          disabled={!previousSection}
          aria-label={previousSection ? `Previous section ${previousSection.title}` : "No previous section"}
        >
          {previousSection ? `< Previous Section: ${previousSection.title}` : "< Previous Section"}
        </button>

        <button
          type="button"
          onClick={() => {
            if (nextSection) {
              onSelectSection(nextSection.id);
            }
          }}
          disabled={!nextSection}
          aria-label={nextSection ? `Next section ${nextSection.title}` : "No next section"}
        >
          {nextSection ? `Next Section: ${nextSection.title} >` : "Next Section >"}
        </button>
      </div>

      <div className="nav-button-row">
        <button
          type="button"
          onClick={() => onOpenContent("vocab")}
          disabled={!selectedSection}
          aria-label="Add vocab for selected section"
        >
          Add Vocab
        </button>
        <button
          type="button"
          onClick={() => onOpenContent("equations")}
          disabled={!selectedSection}
          aria-label="Add equations for selected section"
        >
          Add Equations
        </button>
        <button
          type="button"
          onClick={() => onOpenContent("concepts")}
          disabled={!selectedSection}
          aria-label="Add concepts for selected section"
        >
          Add Concepts
        </button>
        <button
          type="button"
          onClick={onOpenPowerPoints}
          disabled={!selectedSection}
          aria-label="Open PowerPoints for selected section"
        >
          PowerPoints
        </button>
      </div>
    </section>
  );
}

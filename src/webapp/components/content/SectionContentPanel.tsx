import React from "react";
import type { Chapter, Section } from "../../../core/models";

import { ConceptPanel } from "../concepts/ConceptPanel";
import { EquationPanel } from "../equations/EquationPanel";
import { SectionSelectorFallback } from "../sections/SectionSelectorFallback";
import { VocabPanel } from "../vocab/VocabPanel";
import { KeyIdeaPanel } from "./KeyIdeaPanel";

export type ContentPanelTab = "vocab" | "equations" | "concepts";

interface SectionContentPanelProps {
  selectedTextbookId: string | null;
  selectedChapterId: string | null;
  selectedSectionId: string | null;
  selectedChapter: Chapter | null;
  selectedSection: Section | null;
  previousSection: Section | null;
  nextSection: Section | null;
  activePanel: ContentPanelTab;
  onSelectChapter: (chapterId: string | null) => void;
  onSelectSection: (sectionId: string | null) => void;
  onSelectSectionById: (sectionId: string) => void;
  onBackToSections: () => void;
  onSelectPanel: (panel: ContentPanelTab) => void;
}

export function SectionContentPanel({
  selectedTextbookId,
  selectedChapterId,
  selectedSectionId,
  selectedChapter,
  selectedSection,
  previousSection,
  nextSection,
  activePanel,
  onSelectChapter,
  onSelectSection,
  onSelectSectionById,
  onBackToSections,
  onSelectPanel,
}: SectionContentPanelProps): React.JSX.Element {
  function renderActivePanel(): React.JSX.Element {
    if (activePanel === "equations") {
      return <EquationPanel selectedSectionId={selectedSectionId} />;
    }

    if (activePanel === "concepts") {
      return <ConceptPanel selectedSectionId={selectedSectionId} />;
    }

    return <VocabPanel selectedSectionId={selectedSectionId} />;
  }

  return (
    <section className="content-workspace">
      <section className="panel section-nav-panel" aria-label="Content navigation controls">
        <h3>Content Navigation</h3>

        <div className="nav-button-row">
          <button
            type="button"
            onClick={onBackToSections}
            aria-label={selectedSection ? `Back to section ${selectedSection.title}` : "Back to sections"}
          >
            {selectedSection ? `Back to Section: ${selectedSection.title}` : "Back to Sections"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedChapterId) {
                onSelectChapter(selectedChapterId);
                onBackToSections();
              }
            }}
            disabled={!selectedChapterId}
            aria-label={selectedChapter ? `Back to chapter ${selectedChapter.name}` : "Back to chapter"}
          >
            {selectedChapter ? `Back to Chapter: ${selectedChapter.name}` : "Back to Chapter"}
          </button>
        </div>

        <div className="nav-button-row">
          <button
            type="button"
            onClick={() => {
              if (previousSection) {
                onSelectSectionById(previousSection.id);
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
                onSelectSectionById(nextSection.id);
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
            className={activePanel === "vocab" ? "btn-secondary" : ""}
            onClick={() => onSelectPanel("vocab")}
          >
            Add Vocab
          </button>
          <button
            type="button"
            className={activePanel === "equations" ? "btn-secondary" : ""}
            onClick={() => onSelectPanel("equations")}
          >
            Add Equations
          </button>
          <button
            type="button"
            className={activePanel === "concepts" ? "btn-secondary" : ""}
            onClick={() => onSelectPanel("concepts")}
          >
            Add Concepts
          </button>
        </div>
      </section>

      <SectionSelectorFallback
        selectedTextbookId={selectedTextbookId}
        selectedChapterId={selectedChapterId}
        selectedSectionId={selectedSectionId}
        onSelectChapter={onSelectChapter}
        onSelectSection={onSelectSection}
      />

      {selectedSectionId ? (
        <div className="panel-grid content-grid">
          {renderActivePanel()}
          <KeyIdeaPanel selectedSectionId={selectedSectionId} />
        </div>
      ) : (
        <section className="panel">
          <h3>Section Content</h3>
          <p>Select a section to open vocab, equations, concepts, and key ideas.</p>
        </section>
      )}
    </section>
  );
}

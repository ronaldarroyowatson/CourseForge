import React from "react";

export type WorkflowTab = "textbook" | "chapters" | "sections";

interface WorkflowRibbonProps {
  activeTab: WorkflowTab;
  canOpenChapters: boolean;
  canOpenSections: boolean;
  onSelectTab: (tab: WorkflowTab) => void;
}

export function WorkflowRibbon({
  activeTab,
  canOpenChapters,
  canOpenSections,
  onSelectTab,
}: WorkflowRibbonProps): React.JSX.Element {
  return (
    <nav className="workflow-ribbon" aria-label="CourseForge onboarding workflow">
      <button
        type="button"
        className={`workflow-ribbon-tab${activeTab === "textbook" ? " active" : ""}`}
        onClick={() => onSelectTab("textbook")}
      >
        Textbook
      </button>
      <button
        type="button"
        className={`workflow-ribbon-tab${activeTab === "chapters" ? " active" : ""}`}
        onClick={() => onSelectTab("chapters")}
        disabled={!canOpenChapters}
      >
        Chapters
      </button>
      <button
        type="button"
        className={`workflow-ribbon-tab${activeTab === "sections" ? " active" : ""}`}
        onClick={() => onSelectTab("sections")}
        disabled={!canOpenSections}
      >
        Sections
      </button>
    </nav>
  );
}
import React from "react";

export type WorkflowTab = "textbook" | "chapters" | "sections" | "content" | "powerpoints";

interface WorkflowRibbonProps {
  activeTab: WorkflowTab;
  canOpenChapters: boolean;
  canOpenSections: boolean;
  canOpenContent: boolean;
  canOpenPowerPoints: boolean;
  onSelectTab: (tab: WorkflowTab) => void;
}

export function WorkflowRibbon({
  activeTab,
  canOpenChapters,
  canOpenSections,
  canOpenContent,
  canOpenPowerPoints,
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
      <button
        type="button"
        className={`workflow-ribbon-tab${activeTab === "content" ? " active" : ""}`}
        onClick={() => onSelectTab("content")}
        disabled={!canOpenContent}
      >
        Content
      </button>
      <button
        type="button"
        className={`workflow-ribbon-tab${activeTab === "powerpoints" ? " active" : ""}`}
        onClick={() => onSelectTab("powerpoints")}
        disabled={!canOpenPowerPoints}
      >
        PowerPoints
      </button>
    </nav>
  );
}
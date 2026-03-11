import React from "react";

export type QuickAddMode = "vocab" | "equation" | "concept" | "keyidea";

interface QuickAddTabsProps {
  activeMode: QuickAddMode;
  onModeChange: (mode: QuickAddMode) => void;
}

const QUICK_ADD_MODES: { mode: QuickAddMode; label: string }[] = [
  { mode: "vocab", label: "Vocab" },
  { mode: "equation", label: "Equation" },
  { mode: "concept", label: "Concept" },
  { mode: "keyidea", label: "Key Idea" },
];

/**
 * Tab selector for switching between Quick Add form types.
 * Minimal UI with four tabs: Vocab, Equation, Concept, Key Idea.
 */
export function QuickAddTabs({ activeMode, onModeChange }: QuickAddTabsProps): React.JSX.Element {
  return (
    <div className="quick-add-tabs">
      {QUICK_ADD_MODES.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          className={`quick-add-tab ${activeMode === mode ? "active" : ""}`}
          onClick={() => onModeChange(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

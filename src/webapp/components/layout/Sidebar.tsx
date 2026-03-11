import React from "react";

const SIDEBAR_ITEMS = ["Textbooks", "Chapters", "Sections", "Content", "Export"];

/**
 * Sidebar is a static shell placeholder until navigation and feature screens are added.
 */
export function Sidebar(): React.JSX.Element {
  return (
    <aside className="app-sidebar" aria-label="Primary">
      <h2>Workspace</h2>
      <ul>
        {SIDEBAR_ITEMS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </aside>
  );
}

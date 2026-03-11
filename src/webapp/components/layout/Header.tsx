import React from "react";

/**
 * Header keeps product identity and a short phase status line.
 */
export function Header(): React.JSX.Element {
  return (
    <header className="app-header">
      <h1>CourseForge</h1>
      <p>Teacher-guided curriculum builder</p>
    </header>
  );
}

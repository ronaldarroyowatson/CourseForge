import React from "react";

interface AccordionTileProps {
  title: string;
  summary: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function AccordionTile({
  title,
  summary,
  isExpanded,
  onToggle,
  children,
}: AccordionTileProps): React.JSX.Element {
  return (
    <section className="accordion-tile">
      <button type="button" className="accordion-tile-header" onClick={onToggle}>
        <span>
          <strong>{title}</strong>
          <span className="accordion-tile-summary">{summary}</span>
        </span>
        <span className="accordion-tile-icon" aria-hidden="true">
          {isExpanded ? "Hide" : "Show"}
        </span>
      </button>

      {isExpanded ? <div className="accordion-tile-body">{children}</div> : null}
    </section>
  );
}
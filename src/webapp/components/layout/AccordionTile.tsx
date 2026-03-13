import React from "react";

interface AccordionTileProps {
  title: string;
  summary: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function AccordionTile({
  title,
  summary,
  isExpanded,
  onToggle,
  children,
  className,
  disabled = false,
}: AccordionTileProps): React.JSX.Element {
  const rootClassName = className ? `accordion-tile ${className}` : "accordion-tile";

  return (
    <section className={rootClassName}>
      <button
        type="button"
        className="accordion-tile-header"
        onClick={onToggle}
        disabled={disabled}
      >
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
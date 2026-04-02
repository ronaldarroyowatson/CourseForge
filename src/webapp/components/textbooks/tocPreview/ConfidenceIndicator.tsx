import React from "react";

interface ConfidenceIndicatorProps {
  confidence: number;
}

function getToneClass(confidence: number): string {
  if (confidence >= 0.8) {
    return "toc-confidence toc-confidence--high";
  }

  if (confidence >= 0.55) {
    return "toc-confidence toc-confidence--medium";
  }

  return "toc-confidence toc-confidence--low";
}

export function ConfidenceIndicator({ confidence }: ConfidenceIndicatorProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(confidence * 100)));
  return (
    <span
      className={getToneClass(confidence)}
      title={`Extraction confidence: ${pct}%`}
      aria-label={`Extraction confidence ${pct} percent`}
    >
      {pct}%
    </span>
  );
}

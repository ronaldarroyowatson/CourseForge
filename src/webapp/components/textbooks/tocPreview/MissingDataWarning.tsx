import React from "react";

interface MissingDataWarningProps {
  missingFields: string[];
}

export function MissingDataWarning({ missingFields }: MissingDataWarningProps): React.JSX.Element | null {
  if (missingFields.length === 0) {
    return null;
  }

  return (
    <p className="toc-missing-warning" role="status" aria-live="polite">
      Missing: {missingFields.join(", ")}
    </p>
  );
}

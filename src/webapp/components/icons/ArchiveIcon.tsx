import React from "react";

interface IconProps {
  size?: number;
  className?: string;
}

/** Archive box icon used for the archive toggle. */
export function ArchiveIcon({ size = 16, className }: IconProps): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Lid of the archive box */}
      <rect width="20" height="5" x="2" y="3" rx="1" />
      {/* Body of the archive box */}
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      {/* Horizontal handle in the middle */}
      <path d="M10 12h4" />
    </svg>
  );
}

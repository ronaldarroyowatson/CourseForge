import React from "react";

interface StarIconProps {
  size?: number;
  /** When true renders a filled star (favorited). When false renders an outline star. */
  filled?: boolean;
  className?: string;
}

/** Star icon used for the favorite toggle. Renders filled when `filled === true`. */
export function StarIcon({ size = 16, filled = false, className }: StarIconProps): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

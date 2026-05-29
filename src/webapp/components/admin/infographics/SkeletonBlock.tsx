import React from "react";

interface SkeletonBlockProps {
  width?: string;
  height?: string;
  borderRadius?: string;
  className?: string;
}

export function SkeletonBlock({
  width = "100%",
  height = "1.2rem",
  borderRadius = "6px",
  className = "",
}: SkeletonBlockProps): React.JSX.Element {
  return (
    <div
      className={`cf-skeleton${className ? ` ${className}` : ""}`}
      style={{ width, height, borderRadius }}
      aria-hidden="true"
    />
  );
}

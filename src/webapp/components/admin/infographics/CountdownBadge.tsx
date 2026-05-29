import React from "react";
import { SkeletonBlock } from "./SkeletonBlock";
import { getCountdownRingColor } from "./colorUtils";

interface CountdownBadgeProps {
  secondsLeft: number;
  timeString: string;
  loading?: boolean;
}

const COUNTDOWN_PERIOD_SECONDS = 24 * 60 * 60;

export function CountdownBadge({ secondsLeft, timeString, loading = false }: CountdownBadgeProps): React.JSX.Element {
  const safeSecondsLeft = Math.max(0, Math.min(secondsLeft, COUNTDOWN_PERIOD_SECONDS));
  const percentRemaining = (safeSecondsLeft / COUNTDOWN_PERIOD_SECONDS) * 100;
  const ringColor = getCountdownRingColor(percentRemaining);
  const ringStrokeWidth = 10;
  const ringSize = 126;
  const radius = (ringSize - ringStrokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (percentRemaining / 100) * circumference;

  return (
    <div
      className="cf-countdown-ring"
      title="Daily Firestore quota resets at midnight Pacific Time."
    >
      {loading ? (
        <div className="cf-countdown-ring__visual cf-countdown-ring__loading">
          <SkeletonBlock width={`${ringSize}px`} height={`${ringSize}px`} borderRadius="50%" />
          <SkeletonBlock width="8rem" height="1rem" />
        </div>
      ) : (
        <div className="cf-countdown-ring__visual">
          <svg
            className="cf-countdown-ring__svg"
            width={ringSize}
            height={ringSize}
            viewBox={`0 0 ${ringSize} ${ringSize}`}
            aria-hidden="true"
          >
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke="var(--cf-surface-muted)"
              strokeWidth={ringStrokeWidth}
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth={ringStrokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{
                transform: "rotate(-90deg)",
                transformOrigin: "center",
                transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease",
              }}
            />
          </svg>
          <span className="cf-countdown-ring__center-value" aria-live="polite" aria-atomic="true">
            {timeString}
          </span>
        </div>
      )}
      <span className="cf-countdown-ring__label">Until daily reset (Pacific)</span>
    </div>
  );
}

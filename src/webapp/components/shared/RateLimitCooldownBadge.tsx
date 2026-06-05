import React, { useEffect, useRef, useState } from "react";

interface RateLimitCooldownBadgeProps {
  /**
   * The epoch timestamp (ms) when the cooldown window expires.
   * If 0 or in the past, the badge is not rendered.
   */
  expiryMs: number;
  /** Optional label shown next to the ring. */
  label?: string;
}

/**
 * A small animated countdown ring shown while API/AI providers are in a
 * rate-limit cooldown window.
 *
 * - Red while > 60% of cooldown remains
 * - Yellow while 20–60% remains
 * - Green in the final 20%, then fades out
 */
export function RateLimitCooldownBadge({ expiryMs, label }: RateLimitCooldownBadgeProps): React.JSX.Element | null {
  const totalRef = useRef<number>(0);
  const lastExpiryRef = useRef<number>(0);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const now = Date.now();
    const remaining = expiryMs - now;
    if (remaining <= 0) {
      setVisible(false);
      return;
    }

    // Capture total duration on first mount and whenever expiry changes.
    if (totalRef.current === 0 || lastExpiryRef.current !== expiryMs) {
      totalRef.current = remaining;
      lastExpiryRef.current = expiryMs;
    }
    setRemainingMs(remaining);
    setVisible(true);

    const interval = setInterval(() => {
      const r = expiryMs - Date.now();
      if (r <= 0) {
        setRemainingMs(0);
        setVisible(false);
        clearInterval(interval);
      } else {
        setRemainingMs(r);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [expiryMs]);

  if (!visible || remainingMs <= 0) {
    return null;
  }

  const total = totalRef.current || remainingMs;
  const fraction = Math.min(1, Math.max(0, remainingMs / total));

  // Color: red → yellow → green
  const color = fraction > 0.6 ? "#ef4444" : fraction > 0.2 ? "#f59e0b" : "#22c55e";

  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = circumference * fraction;

  const seconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeLabel = minutes > 0
    ? `${minutes}m ${secs}s`
    : `${seconds}s`;

  return (
    <span className="cf-rate-limit-badge" role="status" aria-live="polite" aria-label={`Cloud OCR cooldown: ${timeLabel} remaining`}>
      <svg
        className="cf-rate-limit-badge__ring"
        width="22"
        height="22"
        viewBox="0 0 22 22"
        aria-hidden="true"
      >
        {/* Track */}
        <circle
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth="2.5"
        />
        {/* Progress arc */}
        <circle
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${strokeDash} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
          style={{ transition: "stroke-dasharray 0.5s linear, stroke 0.5s" }}
        />
      </svg>
      <span className="cf-rate-limit-badge__text" style={{ color }}>
        {label ?? "Cloud OCR cooldown:"} {timeLabel}
      </span>
    </span>
  );
}

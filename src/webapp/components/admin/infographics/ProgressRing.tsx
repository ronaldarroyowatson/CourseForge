import React from "react";
import { getInterpolatedColorLight } from "./colorUtils";
import { SkeletonBlock } from "./SkeletonBlock";

interface ProgressRingProps {
  value: number;
  max: number;
  label: string;
  sublabel?: string;
  loading?: boolean;
  error?: boolean;
  size?: number;
  strokeWidth?: number;
}

const SPIKE_THRESHOLD_RATIO = 0.2;
const SPIKE_FLASH_DURATION_MS = 1600;

export function ProgressRing({
  value,
  max,
  label,
  sublabel,
  loading = false,
  error = false,
  size = 96,
  strokeWidth = 9,
}: ProgressRingProps): React.JSX.Element {
  const safeMax = max > 0 ? max : 1;
  const safeValue = Math.max(0, Math.min(value, safeMax));
  const percent = (safeValue / safeMax) * 100;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const fillOffset = circumference - (percent / 100) * circumference;

  const color = getInterpolatedColorLight(percent);

  // Spike detection: flash ring border if usage jumps > 20% of max in one render cycle
  const prevValueRef = React.useRef<number>(0);
  const spikeTimerRef = React.useRef<number | null>(null);
  const [isSpiking, setIsSpiking] = React.useState(false);

  React.useEffect(() => {
    if (loading || safeMax <= 0) {
      prevValueRef.current = 0;
      return;
    }

    const prev = prevValueRef.current;
    const delta = safeValue - prev;
    const threshold = safeMax * SPIKE_THRESHOLD_RATIO;

    if (delta > threshold && prev > 0) {
      if (spikeTimerRef.current !== null) {
        window.clearTimeout(spikeTimerRef.current);
      }
      setIsSpiking(true);
      spikeTimerRef.current = window.setTimeout(() => {
        setIsSpiking(false);
        spikeTimerRef.current = null;
      }, SPIKE_FLASH_DURATION_MS);
    }

    prevValueRef.current = safeValue;

    return () => {
      if (spikeTimerRef.current !== null) {
        window.clearTimeout(spikeTimerRef.current);
      }
    };
  }, [safeValue, safeMax, loading]);

  if (error) {
    return (
      <div className="cf-progress-ring">
        <span className="cf-progress-ring__error-icon" aria-hidden="true">⚠</span>
        <span className="cf-progress-ring__label">{label}</span>
        <span className="cf-progress-ring__values">Data unavailable</span>
      </div>
    );
  }

  const cx = size / 2;
  const cy = size / 2;

  return (
    <div
      className={`cf-progress-ring${isSpiking ? " cf-progress-ring--spiking" : ""}`}
      role="meter"
      aria-label={`${label}: ${safeValue.toLocaleString()} of ${safeMax.toLocaleString()}`}
      aria-valuenow={safeValue}
      aria-valuemin={0}
      aria-valuemax={safeMax}
    >
      {loading ? (
        <SkeletonBlock width={`${size}px`} height={`${size}px`} borderRadius="50%" />
      ) : (
        <svg
          className="cf-progress-ring__svg"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          {/* Track circle */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="var(--cf-surface-muted)"
            strokeWidth={strokeWidth}
          />
          {/* Progress arc — rotated so 0% starts at top */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={fillOffset}
            style={{
              transform: "rotate(-90deg)",
              transformOrigin: "center",
              transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease",
            }}
          />
          {/* Center text */}
          <text
            x={cx}
            y={cy - 5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={size < 80 ? "12" : "14"}
            fontWeight="700"
            fill="var(--cf-text-strong)"
          >
            {percent >= 1 ? `${Math.round(percent)}%` : "<1%"}
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="9"
            fill="var(--cf-text-muted)"
          >
            {safeValue >= 1000 ? `${(safeValue / 1000).toFixed(1)}k` : safeValue}
            {" / "}
            {safeMax >= 1000 ? `${(safeMax / 1000).toFixed(0)}k` : safeMax}
          </text>
        </svg>
      )}
      <span className="cf-progress-ring__label">{label}</span>
      {sublabel ? <span className="cf-progress-ring__values">{sublabel}</span> : null}
    </div>
  );
}

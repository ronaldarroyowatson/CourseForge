import React from "react";
import { SkeletonBlock } from "./SkeletonBlock";

export type TrendDirection = "up" | "down" | "neutral";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string | null | undefined;
  loading?: boolean;
  error?: boolean;
  trend?: TrendDirection;
  accentColor?: string;
  formatValue?: (v: number | string) => string;
}

function TrendArrow({ direction }: { direction: TrendDirection }): React.JSX.Element {
  if (direction === "up") {
    return <span className="cf-stat-card__trend cf-stat-card__trend--up" aria-label="trending up">▲</span>;
  }
  if (direction === "down") {
    return <span className="cf-stat-card__trend cf-stat-card__trend--down" aria-label="trending down">▼</span>;
  }
  return <span className="cf-stat-card__trend cf-stat-card__trend--neutral" aria-label="stable">–</span>;
}

export function StatCard({
  icon,
  label,
  value,
  loading = false,
  error = false,
  trend,
  accentColor,
  formatValue,
}: StatCardProps): React.JSX.Element {
  const displayValue = React.useMemo(() => {
    if (value === null || value === undefined) return "—";
    if (formatValue) return formatValue(value);
    if (typeof value === "number") return value.toLocaleString();
    return String(value);
  }, [value, formatValue]);

  if (error) {
    return (
      <div className="cf-fallback-tile">
        <span className="cf-fallback-tile__icon" aria-hidden="true">⚠</span>
        <span>{label}</span>
        <span className="cf-fallback-tile__msg">Data unavailable</span>
      </div>
    );
  }

  return (
    <div className="cf-stat-card" role="group" aria-label={label}>
      {accentColor ? (
        <div className="cf-stat-card__accent-bar" style={{ background: accentColor }} aria-hidden="true" />
      ) : null}
      <div className="cf-stat-card__header">
        <div className="cf-stat-card__icon" aria-hidden="true">{icon}</div>
        <span className="cf-stat-card__label">{label}</span>
      </div>
      {loading ? (
        <div className="cf-stat-card__skeleton-area">
          <SkeletonBlock height="2rem" width="60%" />
        </div>
      ) : (
        <div className="cf-stat-card__body">
          <span className="cf-stat-card__value">{displayValue}</span>
          {trend !== undefined ? <TrendArrow direction={trend} /> : null}
        </div>
      )}
    </div>
  );
}

import React from "react";
import { getInterpolatedColor } from "./colorUtils";
import { SkeletonBlock } from "./SkeletonBlock";

interface QuotaBarProps {
  value: number;
  max: number;
  label: string;
  loading?: boolean;
  error?: boolean;
}

export function QuotaBar({ value, max, label, loading = false, error = false }: QuotaBarProps): React.JSX.Element {
  const safeMax = max > 0 ? max : 1;
  const safeValue = Math.max(0, Math.min(value, safeMax));
  const percent = (safeValue / safeMax) * 100;
  const color = getInterpolatedColor(percent);

  if (error) {
    return (
      <div className="cf-quota-bar cf-quota-bar--error">
        <span className="cf-quota-bar__label">{label}</span>
        <span className="cf-quota-bar__error-msg">Data unavailable</span>
      </div>
    );
  }

  return (
    <div className="cf-quota-bar" role="meter" aria-label={`${label}: ${Math.round(percent)}%`}>
      <div className="cf-quota-bar__header">
        <span className="cf-quota-bar__label">{label}</span>
        <span className="cf-quota-bar__pct" style={{ color }}>{Math.round(percent)}%</span>
      </div>
      {loading ? (
        <SkeletonBlock height="8px" borderRadius="999px" />
      ) : (
        <div className="cf-quota-bar__track">
          <div
            className="cf-quota-bar__fill"
            style={{
              width: `${percent}%`,
              background: color,
              transition: "width 0.8s cubic-bezier(0.4,0,0.2,1), background 0.5s ease",
            }}
          />
        </div>
      )}
      <div className="cf-quota-bar__values">
        <span>{safeValue.toLocaleString()}</span>
        <span>{safeMax.toLocaleString()}</span>
      </div>
    </div>
  );
}

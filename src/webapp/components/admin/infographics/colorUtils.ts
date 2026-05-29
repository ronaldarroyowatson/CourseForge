/**
 * Color interpolation utilities for infographic components.
 * Thresholds: < 50% = green, 50–95% = yellow→red, >= 95% = solid red.
 */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Returns an HSL color string smoothly interpolated based on usage percentage [0–100].
 * 0–50%:  green (hsl 120) → yellow (hsl 60)
 * 50–95%: yellow (hsl 60) → red (hsl 0)
 * ≥ 95%:  solid red
 */
export function getInterpolatedColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));

  if (p >= 95) {
    return "hsl(0, 82%, 52%)";
  }

  if (p >= 50) {
    const t = (p - 50) / 45;
    const hue = lerp(60, 0, t);
    return `hsl(${hue.toFixed(1)}, 82%, 48%)`;
  }

  const t = p / 50;
  const hue = lerp(120, 60, t);
  return `hsl(${hue.toFixed(1)}, 72%, 40%)`;
}

/**
 * Returns the color for a stroke/border on a ProgressRing, lighter than the fill.
 */
export function getInterpolatedColorLight(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));

  if (p >= 95) {
    return "hsl(0, 90%, 62%)";
  }

  if (p >= 50) {
    const t = (p - 50) / 45;
    const hue = lerp(60, 0, t);
    return `hsl(${hue.toFixed(1)}, 90%, 56%)`;
  }

  const t = p / 50;
  const hue = lerp(120, 60, t);
  return `hsl(${hue.toFixed(1)}, 80%, 50%)`;
}

/**
 * Countdown ring color: 100% remaining = red, 50% = yellow, 25% or less = green.
 */
export function getCountdownRingColor(percentRemaining: number): string {
  const p = Math.max(0, Math.min(100, percentRemaining));

  if (p <= 25) {
    return "hsl(120, 72%, 42%)";
  }

  if (p <= 50) {
    const t = (p - 25) / 25;
    const hue = lerp(120, 60, t);
    return `hsl(${hue.toFixed(1)}, 84%, 48%)`;
  }

  const t = (p - 50) / 50;
  const hue = lerp(60, 0, t);
  return `hsl(${hue.toFixed(1)}, 84%, 52%)`;
}

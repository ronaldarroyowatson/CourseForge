export function isLikelyCourseForgeSelfCapture(label: string): boolean {
  const normalized = (label || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized.includes("courseforge")
    || normalized.includes("localhost:3000");
}

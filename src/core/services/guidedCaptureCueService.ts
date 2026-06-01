export type GuidedCueType = "openToc" | "openGlossary" | "openChapter" | "openSection" | "nextPage";

export interface GuidedCuePoint {
  xRatio?: number;
  yRatio?: number;
  label?: string;
  capturedAt: number;
}

export interface GuidedCueEntry {
  type: GuidedCueType;
  acknowledged: boolean;
  point?: GuidedCuePoint;
}

export interface GuidedCaptureCuePlan {
  version: 1;
  viewerHost?: string;
  cues: Partial<Record<GuidedCueType, GuidedCueEntry>>;
}

export const REQUIRED_AUTOMATION_CUES: GuidedCueType[] = ["openToc", "openGlossary", "nextPage"];

const ALL_CUE_TYPES: GuidedCueType[] = ["openToc", "openGlossary", "openChapter", "openSection", "nextPage"];

function normalizeRatio(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  if (value < 0 || value > 1) {
    return undefined;
  }

  return value;
}

export function createEmptyGuidedCaptureCuePlan(viewerHost?: string): GuidedCaptureCuePlan {
  return {
    version: 1,
    viewerHost: viewerHost?.trim() || undefined,
    cues: {},
  };
}

export function markGuidedCue(
  plan: GuidedCaptureCuePlan,
  type: GuidedCueType,
  point?: { xRatio?: number; yRatio?: number; label?: string }
): GuidedCaptureCuePlan {
  const nextPlan: GuidedCaptureCuePlan = {
    ...plan,
    version: 1,
    cues: {
      ...plan.cues,
    },
  };

  nextPlan.cues[type] = {
    type,
    acknowledged: true,
    point: {
      xRatio: normalizeRatio(point?.xRatio),
      yRatio: normalizeRatio(point?.yRatio),
      label: point?.label?.trim() || undefined,
      capturedAt: Date.now(),
    },
  };

  return nextPlan;
}

export function clearGuidedCue(plan: GuidedCaptureCuePlan, type: GuidedCueType): GuidedCaptureCuePlan {
  const cues = { ...plan.cues };
  delete cues[type];

  return {
    ...plan,
    version: 1,
    cues,
  };
}

export function getMissingGuidedCues(
  plan: GuidedCaptureCuePlan,
  required: GuidedCueType[] = REQUIRED_AUTOMATION_CUES
): GuidedCueType[] {
  return required.filter((type) => !plan.cues[type]?.acknowledged);
}

function hasCuePoint(entry: GuidedCueEntry | undefined): boolean {
  if (!entry?.point) {
    return false;
  }

  return typeof entry.point.xRatio === "number" && typeof entry.point.yRatio === "number";
}

export function getMissingGuidedCuesForAutomation(
  plan: GuidedCaptureCuePlan,
  required: GuidedCueType[] = REQUIRED_AUTOMATION_CUES
): GuidedCueType[] {
  return required.filter((type) => {
    const entry = plan.cues[type];
    return !entry?.acknowledged || !hasCuePoint(entry);
  });
}

export function getGuidedCueCompletion(plan: GuidedCaptureCuePlan): { completed: number; total: number; percent: number } {
  const completed = ALL_CUE_TYPES.filter((type) => plan.cues[type]?.acknowledged).length;
  const total = ALL_CUE_TYPES.length;

  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function isGuidedCuePlanReady(plan: GuidedCaptureCuePlan): boolean {
  return getMissingGuidedCues(plan).length === 0;
}

export function isGuidedCuePlanReadyForAutomation(plan: GuidedCaptureCuePlan): boolean {
  return getMissingGuidedCuesForAutomation(plan).length === 0;
}

export function getGuidedCueLabel(type: GuidedCueType): string {
  switch (type) {
    case "openToc":
      return "TOC opener";
    case "openGlossary":
      return "Glossary opener";
    case "openChapter":
      return "Chapter opener";
    case "openSection":
      return "Section opener";
    case "nextPage":
      return "Next page control";
    default:
      return type;
  }
}

import { appendDebugLogEntry } from "./debugLogService";
import type { DirectionalFlow } from "./designSystemService";

export type DscLayoutCardKind = "examples" | "controls" | "status" | "settings" | "preview";

export interface DscCardPlacement {
  kind: DscLayoutCardKind;
  columnSpan: number;
  order: number;
  minWidthPx: number;
}

export interface DscMasonryFeatureSet {
  dragAndDrop: boolean;
  autoArrange: boolean;
  previewModalMirroring: boolean;
  statusSettingsPreviewUnification: boolean;
}

export interface DscMasonryLayoutDecision {
  engine: "masonry";
  columnCount: number;
  minColumnWidthPx: number;
  gapPx: number;
  rowGapPx: number;
  spacingToken: number;
  denseFlow: boolean;
  adaptiveReflow: boolean;
  optionalFibonacciSpacing: boolean;
  directionalFlow: DirectionalFlow;
  placements: {
    examples: DscCardPlacement;
    controls: DscCardPlacement;
  };
  cardTypeHeuristics: Record<DscLayoutCardKind, string>;
  featureSet: DscMasonryFeatureSet;
}

export const FIBONACCI_SPACING_TOKENS = [5, 8, 13, 21, 34] as const;

function selectSpacingToken(availableWidthPx: number): number {
  if (availableWidthPx >= 1440) {
    return 34;
  }

  if (availableWidthPx >= 1080) {
    return 21;
  }

  if (availableWidthPx >= 720) {
    return 13;
  }

  return 8;
}

function selectColumnCount(availableWidthPx: number): number {
  if (availableWidthPx >= 1440) {
    return 12;
  }

  if (availableWidthPx >= 900) {
    return 10;
  }

  return 1;
}

export function selectDscMasonryLayout(
  availableWidthPx: number,
  options: {
    directionalFlow?: DirectionalFlow;
    optionalFibonacciSpacing?: boolean;
  } = {},
): DscMasonryLayoutDecision {
  const columnCount = selectColumnCount(availableWidthPx);
  const spacingToken = selectSpacingToken(availableWidthPx);
  const minColumnWidthPx = columnCount === 1 ? 320 : 220;
  const examplesSpan = columnCount === 12 ? 7 : columnCount === 10 ? 6 : 1;
  const controlsSpan = columnCount === 12 ? 5 : columnCount === 10 ? 4 : 1;

  return {
    engine: "masonry",
    columnCount,
    minColumnWidthPx,
    gapPx: spacingToken,
    rowGapPx: spacingToken,
    spacingToken,
    denseFlow: true,
    adaptiveReflow: true,
    optionalFibonacciSpacing: options.optionalFibonacciSpacing ?? true,
    directionalFlow: options.directionalFlow ?? "left-to-right",
    placements: {
      examples: {
        kind: "examples",
        columnSpan: examplesSpan,
        order: 1,
        minWidthPx: 420,
      },
      controls: {
        kind: "controls",
        columnSpan: controlsSpan,
        order: 2,
        minWidthPx: 360,
      },
    },
    cardTypeHeuristics: {
      examples: "Prefer wide spans for preview-heavy surfaces and let height drive flow.",
      controls: "Prefer narrower columns with dense stacking for inputs and presets.",
      status: "Collapse to chips or compact blocks when width is constrained.",
      settings: "Keep settings in ordered groups with stable reading flow.",
      preview: "Mirror example surfaces so modal previews match live cards.",
    },
    featureSet: {
      dragAndDrop: true,
      autoArrange: true,
      previewModalMirroring: true,
      statusSettingsPreviewUnification: true,
    },
  };
}

export async function logDscMasonryLayoutDecision(
  decision: DscMasonryLayoutDecision,
  context: Record<string, unknown> = {},
): Promise<void> {
  await appendDebugLogEntry({
    eventType: "info",
    message: `DSC masonry layout: ${decision.columnCount} columns, gap ${decision.gapPx}px, flow ${decision.directionalFlow}.`,
    context: {
      engine: decision.engine,
      columnCount: decision.columnCount,
      gapPx: decision.gapPx,
      rowGapPx: decision.rowGapPx,
      spacingToken: decision.spacingToken,
      adaptiveReflow: decision.adaptiveReflow,
      dragAndDrop: decision.featureSet.dragAndDrop,
      autoArrange: decision.featureSet.autoArrange,
      previewModalMirroring: decision.featureSet.previewModalMirroring,
      statusSettingsPreviewUnification: decision.featureSet.statusSettingsPreviewUnification,
      ...context,
    },
  });
}
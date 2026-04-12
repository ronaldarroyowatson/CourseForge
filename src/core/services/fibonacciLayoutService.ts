import { appendDebugLogEntry } from "./debugLogService";

export type FibonacciRatioName = "1:1" | "2:1" | "3:2" | "5:3" | "8:5" | "13:8";

export interface FibonacciRatio {
  name: FibonacciRatioName;
  a: number;
  b: number;
}

export const FIBONACCI_RATIOS: readonly FibonacciRatio[] = [
  { name: "1:1", a: 1, b: 1 },
  { name: "2:1", a: 2, b: 1 },
  { name: "3:2", a: 3, b: 2 },
  { name: "5:3", a: 5, b: 3 },
  { name: "8:5", a: 8, b: 5 },
  { name: "13:8", a: 13, b: 8 },
] as const;

export type LayoutMode = "horizontal" | "vertical";

export interface TwoCardLayoutDecision {
  ratio: FibonacciRatio;
  mode: LayoutMode;
  /** flex-grow for the example (preview) pane — larger value */
  exampleFlexGrow: number;
  /** flex-grow for the controls pane — smaller value */
  controlsFlexGrow: number;
}

export interface ThreeCardLayoutDecision {
  ratios: [FibonacciRatio, FibonacciRatio, FibonacciRatio];
  mode: LayoutMode;
}

const NARROW_BREAKPOINT_PX = 640;
const WIDE_BREAKPOINT_PX = 960;
const EXTRA_WIDE_BREAKPOINT_PX = 1200;

/**
 * Selects Fibonacci ratio and layout mode for a two-card composition.
 * - Wide (>=960px):   5:3 — Example Card gets 5 units, Controls Card gets 3 units
 * - Normal (>=640px): 3:2 — Example Card gets 3 units, Controls Card gets 2 units
 * - Narrow (<640px):  vertical stacking (height ratios 3:2 via CSS)
 */
export function selectTwoCardLayout(availableWidthPx: number): TwoCardLayoutDecision {
  const mode: LayoutMode = availableWidthPx < NARROW_BREAKPOINT_PX ? "vertical" : "horizontal";
  const ratio: FibonacciRatio =
    availableWidthPx >= WIDE_BREAKPOINT_PX
      ? { name: "5:3", a: 5, b: 3 }
      : { name: "3:2", a: 3, b: 2 };

  return {
    ratio,
    mode,
    exampleFlexGrow: ratio.a,
    controlsFlexGrow: ratio.b,
  };
}

/**
 * Selects Fibonacci ratios for a three-card composition.
 * - Extra-wide (>=1200px): 8:5:3
 * - Normal (>=640px):      5:3:2
 * - Narrow (<640px):       vertical stacking
 */
export function selectThreeCardLayout(availableWidthPx: number): ThreeCardLayoutDecision {
  const mode: LayoutMode = availableWidthPx < NARROW_BREAKPOINT_PX ? "vertical" : "horizontal";
  const ratios: [FibonacciRatio, FibonacciRatio, FibonacciRatio] =
    availableWidthPx >= EXTRA_WIDE_BREAKPOINT_PX
      ? [
          { name: "8:5", a: 8, b: 5 },
          { name: "5:3", a: 5, b: 3 },
          { name: "3:2", a: 3, b: 2 },
        ]
      : [
          { name: "5:3", a: 5, b: 3 },
          { name: "3:2", a: 3, b: 2 },
          { name: "1:1", a: 1, b: 1 },
        ];

  return { ratios, mode };
}

/**
 * Logs a two-card Fibonacci layout decision to the debug log.
 */
export async function logFibonacciLayoutDecision(
  decision: TwoCardLayoutDecision,
  context: Record<string, unknown> = {},
): Promise<void> {
  await appendDebugLogEntry({
    eventType: "info",
    message: `Fibonacci layout: ${decision.ratio.name} (${decision.mode}). Example flex=${decision.exampleFlexGrow}, Controls flex=${decision.controlsFlexGrow}.`,
    context: {
      ratio: decision.ratio.name,
      mode: decision.mode,
      exampleFlexGrow: decision.exampleFlexGrow,
      controlsFlexGrow: decision.controlsFlexGrow,
      ...context,
    },
  });
}

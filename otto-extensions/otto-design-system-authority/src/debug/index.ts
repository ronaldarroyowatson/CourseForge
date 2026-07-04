import { deepFreeze } from "../core/freeze.js";
import { traceOverlayRules } from "./trace-overlay.js";

export { traceOverlayRules };

export const debugRules = deepFreeze({
  traceOverlay: traceOverlayRules
} as const);

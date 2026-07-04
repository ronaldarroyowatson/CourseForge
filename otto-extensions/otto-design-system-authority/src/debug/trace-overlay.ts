import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";
import { colorTokens } from "../tokens/color.js";

export const traceOverlayRules = deepFreeze({
  id: "otto.design.debug.trace-overlay",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    enabledByDefault: false,
    layers: {
      layoutBounds: colorTokens.config.semantic.info.background,
      interactiveArea: colorTokens.config.semantic.warning.background,
      asyncRegion: colorTokens.config.semantic.success.background,
      errorRegion: colorTokens.config.semantic.error.background
    },
    opacity: 0.22,
    borderStyle: "dashed"
  }
} as const);

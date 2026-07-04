import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";
import { colorTokens } from "../tokens/color.js";

export const errorBehavior = deepFreeze({
  id: "otto.design.behavior.error",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    field: {
      borderColor: colorTokens.config.semantic.error.border,
      outlineColor: colorTokens.config.semantic.error.background,
      messageColor: colorTokens.config.semantic.error.background
    },
    surface: {
      background: colorTokens.config.semantic.error.background,
      foreground: colorTokens.config.semantic.error.foreground
    }
  }
} as const);

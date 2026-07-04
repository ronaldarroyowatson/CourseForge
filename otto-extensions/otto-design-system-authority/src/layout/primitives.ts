import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";
import { spacingTokens } from "../tokens/spacing.js";

export const layoutPrimitives = deepFreeze({
  id: "otto.design.layout.primitives",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    stack: {
      display: "flex",
      direction: "column",
      gap: spacingTokens.config.md
    },
    flow: {
      display: "flex",
      direction: "row",
      wrap: "wrap",
      gap: spacingTokens.config.sm
    },
    grid: {
      display: "grid",
      gap: spacingTokens.config.lg,
      minColumnWidth: "14rem"
    }
  }
} as const);

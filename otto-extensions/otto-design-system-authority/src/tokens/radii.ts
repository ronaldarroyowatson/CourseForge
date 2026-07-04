import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const radiiTokens = deepFreeze({
  id: "otto.design.tokens.radii",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    none: "0",
    sm: "0.25rem",
    md: "0.5rem",
    lg: "0.75rem",
    pill: "999px"
  }
} as const);

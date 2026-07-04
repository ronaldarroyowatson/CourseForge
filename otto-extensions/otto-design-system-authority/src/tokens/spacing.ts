import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const spacingTokens = deepFreeze({
  id: "otto.design.tokens.spacing",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    none: "0rem",
    xxs: "0.125rem",
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.5rem",
    xxl: "2rem",
    section: "3rem"
  }
} as const);

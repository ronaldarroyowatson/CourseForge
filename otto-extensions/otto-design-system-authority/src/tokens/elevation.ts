import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const elevationTokens = deepFreeze({
  id: "otto.design.tokens.elevation",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    none: "none",
    raised: "0 1px 2px rgb(15 23 42 / 0.15)",
    floating: "0 8px 16px rgb(15 23 42 / 0.22)",
    overlay: "0 16px 42px rgb(15 23 42 / 0.35)"
  }
} as const);

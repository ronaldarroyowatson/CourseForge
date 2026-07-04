import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const gravityRules = deepFreeze({
  id: "otto.design.layout.gravity",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    mainAxis: ["start", "center", "end", "space-between"],
    crossAxis: ["start", "center", "end", "stretch"],
    defaults: {
      stack: { main: "start", cross: "stretch" },
      flow: { main: "start", cross: "center" },
      grid: { main: "start", cross: "stretch" }
    }
  }
} as const);

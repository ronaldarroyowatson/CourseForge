import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const directionalRules = deepFreeze({
  id: "otto.design.layout.directional",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    writingModes: ["horizontal-tb", "vertical-rl"],
    direction: ["ltr", "rtl"],
    axisAliases: {
      inlineStart: "left",
      inlineEnd: "right",
      blockStart: "top",
      blockEnd: "bottom"
    }
  }
} as const);

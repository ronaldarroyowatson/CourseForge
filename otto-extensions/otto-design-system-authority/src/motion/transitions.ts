import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";
import { motionTokens } from "../tokens/motion.js";

export const motionTransitions = deepFreeze({
  id: "otto.design.motion.transitions",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    interactive:
      `background-color ${motionTokens.config.duration.fast} ${motionTokens.config.easing.standard}, transform ${motionTokens.config.duration.fast} ${motionTokens.config.easing.standard}`,
    emphasis:
      `box-shadow ${motionTokens.config.duration.normal} ${motionTokens.config.easing.standard}, opacity ${motionTokens.config.duration.normal} ${motionTokens.config.easing.standard}`,
    async:
      `opacity ${motionTokens.config.duration.slow} ${motionTokens.config.easing.standard}`
  }
} as const);

import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";
import { motionTokens } from "../tokens/motion.js";

export const interactionBehavior = deepFreeze({
  id: "otto.design.behavior.interaction",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    hover: {
      transformY: motionTokens.config.distance.hoverRaise,
      duration: motionTokens.config.duration.fast,
      easing: motionTokens.config.easing.standard
    },
    press: {
      transformY: motionTokens.config.distance.pressDepth,
      duration: motionTokens.config.duration.instant,
      easing: motionTokens.config.easing.accelerate
    },
    disabled: {
      opacity: 0.55,
      cursor: "not-allowed"
    }
  }
} as const);

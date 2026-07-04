import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";
import { motionTokens } from "../tokens/motion.js";

export const motionChoreography = deepFreeze({
  id: "otto.design.motion.choreography",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    enter: {
      duration: motionTokens.config.duration.normal,
      easing: motionTokens.config.easing.decelerate,
      fromOpacity: 0,
      fromTranslateY: motionTokens.config.distance.enterOffset
    },
    exit: {
      duration: motionTokens.config.duration.fast,
      easing: motionTokens.config.easing.accelerate,
      toOpacity: 0,
      toTranslateY: motionTokens.config.distance.enterOffset
    },
    hover: {
      duration: motionTokens.config.duration.fast,
      easing: motionTokens.config.easing.standard
    },
    press: {
      duration: motionTokens.config.duration.instant,
      easing: motionTokens.config.easing.accelerate
    },
    async: {
      duration: motionTokens.config.duration.slow,
      easing: motionTokens.config.easing.standard
    }
  }
} as const);

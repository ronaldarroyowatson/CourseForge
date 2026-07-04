import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";
import { motionTokens } from "../tokens/motion.js";

export const asyncBehavior = deepFreeze({
  id: "otto.design.behavior.async",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    loading: {
      pulseDuration: motionTokens.config.duration.slow,
      opacity: 0.7
    },
    validating: {
      shimmerDuration: motionTokens.config.duration.normal,
      opacity: 0.82
    },
    saving: {
      lockInteraction: true,
      spinnerDuration: motionTokens.config.duration.fast
    },
    error: {
      shakeDuration: motionTokens.config.duration.fast,
      retriesSuggested: true
    }
  }
} as const);

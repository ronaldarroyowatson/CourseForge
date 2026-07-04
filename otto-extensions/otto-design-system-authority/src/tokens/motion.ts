import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const motionTokens = deepFreeze({
  id: "otto.design.tokens.motion",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    duration: {
      instant: "50ms",
      fast: "120ms",
      normal: "200ms",
      slow: "320ms"
    },
    easing: {
      standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      emphasized: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      decelerate: "cubic-bezier(0, 0, 0.2, 1)",
      accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    },
    distance: {
      hoverRaise: "-1px",
      pressDepth: "1px",
      enterOffset: "8px"
    }
  }
} as const);

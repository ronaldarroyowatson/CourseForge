import { deepFreeze } from "../core/freeze.js";
import { motionChoreography } from "./choreography.js";
import { motionTransitions } from "./transitions.js";

export { motionChoreography, motionTransitions };

export const motionRules = deepFreeze({
  choreography: motionChoreography,
  transitions: motionTransitions
} as const);

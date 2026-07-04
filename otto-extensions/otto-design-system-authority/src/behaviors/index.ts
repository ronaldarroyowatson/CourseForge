import { deepFreeze } from "../core/freeze.js";
import { asyncBehavior } from "./async.js";
import { errorBehavior } from "./error.js";
import { interactionBehavior } from "./interaction.js";

export { asyncBehavior, errorBehavior, interactionBehavior };

export const behaviorRules = deepFreeze({
  interaction: interactionBehavior,
  async: asyncBehavior,
  error: errorBehavior
} as const);

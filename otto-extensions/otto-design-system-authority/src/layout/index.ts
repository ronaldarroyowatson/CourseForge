import { deepFreeze } from "../core/freeze.js";
import { directionalRules } from "./directional.js";
import { gravityRules } from "./gravity.js";
import { layoutPrimitives } from "./primitives.js";

export { directionalRules, gravityRules, layoutPrimitives };

export const layoutRules = deepFreeze({
  primitives: layoutPrimitives,
  directional: directionalRules,
  gravity: gravityRules
} as const);

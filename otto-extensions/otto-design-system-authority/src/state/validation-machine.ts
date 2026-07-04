import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const validationStateMachine = deepFreeze({
  id: "otto.design.state.validation",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    initial: "pristine",
    states: ["pristine", "validating", "valid", "invalid"],
    transitions: {
      pristine: ["validating"],
      validating: ["valid", "invalid"],
      valid: ["validating", "invalid"],
      invalid: ["validating", "valid"]
    }
  }
} as const);

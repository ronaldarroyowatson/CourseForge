import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const saveStateMachine = deepFreeze({
  id: "otto.design.state.save",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    initial: "idle",
    states: ["idle", "dirty", "saving", "saved", "error"],
    transitions: {
      idle: ["dirty"],
      dirty: ["saving", "idle"],
      saving: ["saved", "error"],
      saved: ["dirty", "idle"],
      error: ["saving", "dirty", "idle"]
    }
  }
} as const);

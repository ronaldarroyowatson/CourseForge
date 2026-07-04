import { deepFreeze } from "../core/freeze.js";
import { RULESET_VERSION } from "../core/types.js";

export const lifecycleStateMachine = deepFreeze({
  id: "otto.design.state.lifecycle",
  version: RULESET_VERSION,
  immutable: true,
  config: {
    initial: "idle",
    states: ["idle", "loading", "ready", "saving", "error"],
    transitions: {
      idle: ["loading"],
      loading: ["ready", "error"],
      ready: ["saving", "loading", "error"],
      saving: ["ready", "error"],
      error: ["loading", "ready"]
    }
  }
} as const);

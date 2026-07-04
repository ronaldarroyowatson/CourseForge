import { deepFreeze } from "../core/freeze.js";
import { lifecycleStateMachine } from "./lifecycle-machine.js";
import { saveStateMachine } from "./save-machine.js";
import { validationStateMachine } from "./validation-machine.js";

export { lifecycleStateMachine, saveStateMachine, validationStateMachine };

export const stateMachines = deepFreeze({
  lifecycle: lifecycleStateMachine,
  validation: validationStateMachine,
  save: saveStateMachine
} as const);

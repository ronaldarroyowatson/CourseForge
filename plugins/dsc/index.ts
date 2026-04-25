import {
  getDSCComponents,
  getDSCDefaults,
  getDSCExamples,
  getDSCSettings,
  registerDSCModule,
  unregisterDSCModule,
} from "../../modules/dsc/index";

export function register(): void {
  registerDSCModule();
}

export function unregister(): void {
  unregisterDSCModule();
}

export function getSettings() {
  return getDSCSettings();
}

export function getExamples() {
  return getDSCExamples();
}

export function getControls() {
  return getDSCComponents();
}

export function getDefaults() {
  return getDSCDefaults();
}

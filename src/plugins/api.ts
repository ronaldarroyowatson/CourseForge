export type PluginRuntimeMode = "webapp" | "extension" | "cli";

export const COURSEFORGE_PLUGIN_API_VERSION = "1.0.0";

export interface PluginRegistrationContext {
  pluginId: string;
  hostVersion: string;
  apiVersion: string;
  mode: PluginRuntimeMode;
}

export type PluginSettingType = "boolean" | "number" | "string" | "select";

export interface PluginSettingOption {
  label: string;
  value: string;
}

export interface PluginSettingDefinition {
  key: string;
  label: string;
  description?: string;
  type: PluginSettingType;
  required?: boolean;
  defaultValue?: boolean | number | string;
  options?: PluginSettingOption[];
}

export interface PluginExampleDefinition {
  id: string;
  title: string;
  description?: string;
  order?: number;
}

export type PluginControlKind = "button" | "slider" | "toggle" | "input" | "select";

export interface PluginControlDefinition {
  id: string;
  label: string;
  kind: PluginControlKind;
  helpText?: string;
}

export type PluginDefaults = Record<string, unknown>;

export interface PluginHealthStatus {
  ok: boolean;
  message?: string;
}

export interface PluginManifest {
  name: string;
  id: string;
  version: string;
  description: string;
  optional: boolean;
  entry: string;
}

export interface PluginApi {
  register(context: PluginRegistrationContext): void | Promise<void>;
  unregister(context: PluginRegistrationContext): void | Promise<void>;
  getSettings?(): PluginSettingDefinition[];
  getExamples?(): PluginExampleDefinition[];
  getControls?(): PluginControlDefinition[];
  getDefaults?(): PluginDefaults;
  onInstall?(context: PluginRegistrationContext): void | Promise<void>;
  onUninstall?(context: PluginRegistrationContext): void | Promise<void>;
  healthCheck?(): PluginHealthStatus | Promise<PluginHealthStatus>;
}

export interface PluginStatus {
  manifest: PluginManifest;
  installed: boolean;
  loaded: boolean;
  error?: string;
}

export interface PluginStatusEvent {
  changedPluginId?: string;
  statuses: PluginStatus[];
}

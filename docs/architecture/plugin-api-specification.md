# Plugin API Specification

## Purpose

This specification defines the stable plugin runtime contract for CourseForge plugins. Every plugin entry module must conform to this API to be loadable by the plugin loader.

## Full Plugin API Interface

```ts
export interface PluginRegistrationContext {
  pluginId: string;
  hostVersion: string;
  apiVersion: string;
  mode: "webapp" | "extension" | "cli";
}

export interface PluginSettingDefinition {
  key: string;
  label: string;
  description?: string;
  type: "boolean" | "number" | "string" | "select";
  required?: boolean;
  defaultValue?: boolean | number | string;
  options?: Array<{ label: string; value: string }>;
}

export interface PluginExampleDefinition {
  id: string;
  title: string;
  description?: string;
  order?: number;
}

export interface PluginControlDefinition {
  id: string;
  label: string;
  kind: "button" | "slider" | "toggle" | "input" | "select";
  helpText?: string;
}

export type PluginDefaults = Record<string, unknown>;

export interface PluginApi {
  register(context: PluginRegistrationContext): void | Promise<void>;
  unregister(context: PluginRegistrationContext): void | Promise<void>;

  getSettings?(): PluginSettingDefinition[];
  getExamples?(): PluginExampleDefinition[];
  getControls?(): PluginControlDefinition[];
  getDefaults?(): PluginDefaults;

  onInstall?(context: PluginRegistrationContext): void | Promise<void>;
  onUninstall?(context: PluginRegistrationContext): void | Promise<void>;
  healthCheck?(): { ok: boolean; message?: string } | Promise<{ ok: boolean; message?: string }>;
}
```

## Required Methods

- `register(context)`
- `unregister(context)`

These methods are mandatory and form the minimum lifecycle contract.

## Optional Methods

- `getSettings()`
- `getExamples()`
- `getControls()`
- `getDefaults()`
- `onInstall(context)`
- `onUninstall(context)`
- `healthCheck()`

Optional methods allow plugin UX metadata and install-time hooks without requiring all plugins to implement every capability.

## Versioning Rules

1. `apiVersion` follows semantic versioning: `MAJOR.MINOR.PATCH`.
2. MAJOR changes may remove or alter behavior.
3. MINOR changes add optional capabilities without breaking existing plugins.
4. PATCH changes are bug fixes or clarifications only.

### Compatibility policy

- Host accepts plugin API versions where plugin major equals host major.
- Host may support adjacent older minor versions for transition windows.
- Unsupported versions produce explicit status errors and skip load.

## Stability Guarantees

CourseForge guarantees:

1. Required method names remain stable across PATCH and MINOR.
2. Optional metadata methods remain additive-first.
3. Manifest schema changes are announced with migration guidance.
4. Plugin loader failure is isolated from host startup and settings render.

## Settings, Examples, Controls, and Defaults Contract

Plugins expose UX metadata through optional methods:

- settings: configurable user-facing options
- examples: sample presets or demonstrations
- controls: runtime interactive controls
- defaults: default token map and startup values

Rules:

1. IDs and keys must be stable and deterministic.
2. Returned arrays must be serializable.
3. Defaults must map only known setting/control keys.
4. Plugin metadata should be safe to render even if plugin runtime features are disabled.

## Manifest Requirements

Every plugin folder must include `plugin.json` with at minimum:

- `name`
- `id`
- `version`
- `description`
- `optional`
- `entry`

The loader validates these fields before any runtime import.

## Error Semantics

The loader maps plugin failures to stable error identifiers:

- `missing-plugin`
- `missing-entry`
- `invalid-manifest`
- `invalid-plugin-api`
- `register-failed`
- `unregister-failed`

These codes are intended for both UI and CLI output.

## Permanent MemPalace Rule

From now on, every architectural change, new file, refactor, plugin addition, plugin removal, loader update, installer/uninstaller change, CLI command, or design decision MUST be written into MemPalace using add_memory. MemPalace is the authoritative source of truth for the CourseForge architecture.

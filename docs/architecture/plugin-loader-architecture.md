# Plugin Loader Architecture

## Purpose

The CourseForge plugin loader is the runtime control plane that discovers optional plugins, validates plugin manifests, loads and unloads plugin modules, and publishes plugin status to both UI and CLI surfaces.

## Full ASCII Plugin Loader Architecture Diagram

```text
+----------------------------------------------------------------------------------+
|                                  CourseForge Host                                |
|                                                                                  |
|  +-------------------------+                  +-------------------------------+   |
|  | Settings Page (React)   |                  | CLI (scripts/program-cli.mjs)|   |
|  | - Install/Uninstall     |                  | - plugins status             |   |
|  | - Open plugin workspace |                  | - plugins install <id>       |   |
|  | - Show status           |                  | - plugins uninstall <id>     |   |
|  +-----------+-------------+                  +---------------+---------------+   |
|              |                                                |                   |
|              | calls loader API                               | consumes statuses  |
|              v                                                v                   |
|      +--------------------------------------------------------------------+      |
|      |                     src/plugins/loader.ts                           |      |
|      |--------------------------------------------------------------------|      |
|      | scanPlugins()         loadPlugin()         unloadPlugin()          |      |
|      | installPlugin()       uninstallPlugin()    getPluginStatuses()     |      |
|      | subscribePluginStatusChanges()             getPluginControls()      |      |
|      +--------------------------+-----------------------------+------------+      |
|                                 |                             |                   |
|                                 | reads manifest              | dynamic import     |
|                                 v                             v                   |
|                     +----------------------+      +------------------------+      |
|                     | plugins/*/plugin.json|      | plugins/*/index.ts     |      |
|                     +----------+-----------+      +-----------+------------+      |
|                                |                          register()/unregister() |
|                                |                                      |           |
|                                v                                      v           |
|                     +---------------------------+          +-------------------+   |
|                     | src/plugins/api.ts        |<---------| Plugin module API |   |
|                     | contract + helper types   |          | implementation    |   |
|                     +---------------------------+          +-------------------+   |
|                                                                                  |
|  +----------------------------+                                                   |
|  | Local install state store  |                                                   |
|  | - localStorage in browser  |                                                   |
|  | - in-memory fallback       |                                                   |
|  +----------------------------+                                                   |
+----------------------------------------------------------------------------------+

Installer / Uninstaller lifecycle integration:

  package scripts -> copy/remove plugins/* -> plugin manifests discovered on next scan
  loader handles missing manifest/entry as non-fatal status errors
```

## Loader Responsibilities

1. Discover all plugin manifests under `plugins/*/plugin.json`.
2. Validate each manifest and return stable metadata for UI and CLI.
3. Resolve install state from persistent storage.
4. Dynamically import plugin entries and invoke lifecycle hooks.
5. Track loaded plugin modules and prevent duplicate registration.
6. Emit status updates for reactive UI and script consumers.
7. Fail gracefully when manifests or entries are missing.

## Register and Unregister Lifecycle

### Register flow

1. Host requests `installPlugin(id)` or `loadPlugin(id)`.
2. Loader verifies manifest exists and plugin is installed.
3. Loader imports plugin entry module.
4. Loader calls `register(context)`.
5. Loader marks plugin as loaded and publishes updated status.

### Unregister flow

1. Host requests `unloadPlugin(id)` or `uninstallPlugin(id)`.
2. Loader finds loaded plugin module.
3. Loader calls `unregister(context)`.
4. Loader removes module from loaded map.
5. If uninstalling, loader persists installed state as false.
6. Loader publishes updated status.

## Settings Page Integration

The Settings page uses loader APIs to:

- render installed/not-installed plugin states
- perform install and uninstall actions
- open plugin-specific UX only when plugin is loaded
- display non-fatal error messages from status data

## CLI Integration

CLI commands consume loader-compatible status semantics:

- `plugins status`: list manifest + installed + loaded + error
- `plugins install <id>`: persist install state and trigger load
- `plugins uninstall <id>`: unload and persist uninstall state

The loader remains the single authoritative lifecycle contract.

## Installer and Uninstaller Integration

Installer and uninstaller own filesystem lifecycle:

- installer packages plugin folders under `plugins/`
- uninstaller removes plugin artifacts and plugin state files
- loader does not mutate package assets; it only reacts to discovered manifests and runtime state

This separation keeps runtime loading predictable and installer behavior idempotent.

## Failure Modes and Guardrails

- Missing manifest: return `missing-plugin` status, keep host stable.
- Missing entry module: return `missing-entry` status.
- Register/unregister error: capture error in plugin status, do not crash host.
- Unknown plugin id: report as optional missing plugin.

## Permanent MemPalace Rule

From now on, every architectural change, new file, refactor, plugin addition, plugin removal, loader update, installer/uninstaller change, CLI command, or design decision MUST be written into MemPalace using add_memory. MemPalace is the authoritative source of truth for the CourseForge architecture.

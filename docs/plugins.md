# CourseForge Plugin Architecture

## Overview

CourseForge supports optional plugins loaded through a lifecycle-aware plugin loader. The base installation ships without optional plugins activated. Plugins can be installed and uninstalled from UI and CLI.

## Plugin Structure

- Plugin root folder: `plugins/`
- Each plugin has:
  - `plugin.json` manifest
  - `index.ts` entry exporting lifecycle functions

Example DSC manifest:

- Name: Design System Controls
- Id: `dsc`
- Optional: `true`
- Entry: `./index.ts`

## Loader Lifecycle

The plugin loader lives in `src/core/services/pluginService.ts` and provides:

- `scanPlugins()`
- `loadPlugin(id)`
- `unloadPlugin(id)`
- `installPlugin(id)`
- `uninstallPlugin(id)`
- `getPluginStatuses()`
- `getPluginStatus(id)`

Behavior:

- Missing plugin manifests are handled gracefully.
- Installed state is persisted in plugin state storage.
- Loader dynamically loads and unloads plugin modules without crashing the host UI.

## DSC Plugin Behavior

### Not Installed

- Settings card title: Design System Controls
- Helper text: Not Installed
- Button: Install DSC Plugin
- Only minimal settings are shown:
  - Light/Dark mode
  - Base color selector
- No examples, no controls, no floating DSC card

### Installed

- Settings card title: Design System Controls
- Buttons:
  - Open Design System Controls
  - Uninstall DSC Plugin
- Opening DSC restores:
  - Example Card
  - Controls Card
  - Floating top-layer card
  - Full examples and controls

## CLI Plugin Management

Commands:

- `courseforge plugins install dsc`
- `courseforge plugins uninstall dsc`
- `courseforge plugins status`

Behavior:

- Install/uninstall operations are idempotent.
- Missing plugins return non-fatal status output.
- Status command reports installed and available plugins.

## Installer Behavior

Default installer behavior:

- Installs base CourseForge program only
- Does not preinstall DSC plugin
- Writes DSC plugin state as not installed

Optional plugin enablement:

- User installs from Settings via Install DSC Plugin
- Or installs with CLI using `courseforge plugins install dsc`

## Uninstaller Behavior

When uninstalling CourseForge:

- Removes base program components
- Removes DSC plugin directory when present
- Removes plugin state files
- Cleans remaining plugin artifacts idempotently
- Handles already-removed plugin state without errors

## Creating New Plugins

1. Create `plugins/<plugin-id>/plugin.json`
2. Create `plugins/<plugin-id>/index.ts`
3. Export lifecycle API:
   - `register()`
   - `unregister()`
   - optional settings/controls/examples/defaults helpers
4. Add plugin-specific tests for:
   - install
   - uninstall
   - status
   - missing-plugin handling

## MemPalace Integration

Plugin architecture decisions and lifecycle decisions should be persisted in repository memory after major changes. For DSC:

- Floating card layering and clipping rules are preserved.
- Optional-plugin lifecycle is documented for future refactors.
- Installer and uninstaller plugin cleanup behavior is recorded for maintenance.

From now on, every architectural change, new file, refactor, plugin addition, plugin removal, loader update, installer/uninstaller change, CLI command, or design decision MUST be written into MemPalace using add_memory. MemPalace is the authoritative source of truth for the CourseForge architecture.

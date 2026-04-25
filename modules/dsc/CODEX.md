# DSC Module Architecture

## Overview

The DSC module is the standalone package for Design System Controls in CourseForge. It centralizes DSC registration, component access, defaults, settings metadata, and canonical example identifiers.

## Architecture

- Module shell: `modules/dsc/index.ts`
- Runtime integration: host app consumes module through plugin loader
- Source of defaults: `src/core/services/designSystemService.ts`
- Source of UI: `src/webapp/components/settings/DesignSystemSettingsCard.tsx` and `src/webapp/components/settings/FloatingDesignSystemCard.tsx`

## Component Hierarchy

- `DesignSystemSettingsCard` is the in-card DSC workspace.
- `FloatingDesignSystemCard` is a portal-backed shell that hosts the settings card.
- Settings page decides whether to render plugin actions, minimal settings, or full DSC controls.

## Layout Rules

- DSC workspace uses masonry decisions from `selectDscMasonryLayout`.
- Adaptive behavior depends on container width and directional flow.
- Optional Fibonacci spacing can be enabled for paired card rhythm.

## Pairing Rules

- Each control section is rendered as paired row:
  - Example cell
  - Controls cell
- Directional flow can mirror ordering for RTL workflows.

## Z-Height Rules

- Floating DSC card uses viewport-level portal rendering.
- Floating card must stay on highest visual layer (`data-floating-layer=highest`).
- Card escapes parent clipping by rendering to document body.

## Memory Integration Rules

- Registration state is persisted via plugin state.
- Architecture decisions are persisted to MemPalace repository memory after major lifecycle changes.
- Loader, settings page, CLI, and installer must agree on plugin lifecycle semantics.

## Permanent MemPalace Governance Rule

From now on, every architectural change, new file, refactor, plugin addition, plugin removal, loader update, installer/uninstaller change, CLI command, or design decision MUST be written into MemPalace using add_memory. MemPalace is the authoritative source of truth for the CourseForge architecture.

CourseForge owns the MemPalace instance.
CourseForge MUST auto-start MemPalace and MUST maintain it.
If MemPalace crashes, CourseForge MUST restart it immediately.

## Test Strategy

- Unit tests for plugin loader and lifecycle helpers.
- Integration tests for settings card states with plugin installed/uninstalled.
- CLI tests for plugin install/uninstall/status commands.
- Installer guardrail tests ensure plugin lifecycle hooks remain present.

## CourseForge Integration

- DSC is optional by default.
- Base install exposes minimal settings only.
- Installing DSC plugin enables full examples, controls, and floating workspace.
- Uninstall removes plugin state and plugin files without impacting base app startup.

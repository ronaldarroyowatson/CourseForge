# Plugin Marketplace Blueprint

## Purpose

This blueprint defines how CourseForge will support discovery, metadata, installation, and lifecycle management for a plugin marketplace.

## Marketplace Folder Structure

```text
plugins/
  dsc/
    plugin.json
    index.ts

marketplace/
  index.json                  # local catalog index (future)
  signatures/                 # detached signatures (future)
  cache/                      # downloaded metadata/assets (future)
  installed/                  # installed package metadata (future)
```

## Marketplace Metadata Format

Proposed marketplace catalog item:

```json
{
  "id": "dsc",
  "name": "Design System Controls",
  "summary": "Design token controls and preview workspace",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "entry": "./index.ts",
  "optional": true,
  "author": "CourseForge Team",
  "homepage": "https://example.invalid/plugins/dsc",
  "tags": ["design-system", "settings", "ui"],
  "checksum": "sha256:...",
  "signature": "base64-signature",
  "dependencies": []
}
```

## Marketplace CLI Commands

Current and planned command surface:

1. `courseforge plugins status`
2. `courseforge plugins install <plugin-id>`
3. `courseforge plugins uninstall <plugin-id>`
4. `courseforge plugins marketplace list` (planned)
5. `courseforge plugins marketplace show <plugin-id>` (planned)
6. `courseforge plugins marketplace install <plugin-id>` (planned)

CLI command outputs should consume loader/marketplace status models directly.

## Marketplace UI Concepts

Settings page marketplace section should include:

1. Search and filter by tags/capabilities.
2. Plugin cards with install state, version, and compatibility.
3. Metadata drawer showing defaults, controls, and changelog snippet.
4. Install/uninstall buttons with optimistic status feedback.
5. Error state rendering for signature or compatibility failures.

## Marketplace Runtime Components

- `src/plugins/marketplace.ts` as the marketplace service scaffold.
- `src/plugins/loader.ts` remains authoritative for runtime load/unload.
- Plugin manifests remain source of local runtime discovery.
- Remote catalog metadata augments but does not replace local manifest validation.

## Future Expansion

### Plugin signing

- Require detached signatures for remote-distributed plugins.
- Verify signatures before install and again at load time.

### Version negotiation

- Enforce API compatibility gates between host and plugin.
- Support constrained version ranges and rollback metadata.

### Dependency management

- Permit declared plugin dependencies with cycle detection.
- Resolve install order and partial-failure rollback policy.

### Trust model

- Introduce trust levels: official, verified, community.
- Surface trust level in UI and CLI.

## Operational Rules

1. Marketplace fetch failures must not block app startup.
2. Loader remains offline-capable for already-installed plugins.
3. All install and uninstall operations must remain idempotent.
4. Metadata and status schemas remain backward-compatible whenever possible.

## Permanent MemPalace Rule

From now on, every architectural change, new file, refactor, plugin addition, plugin removal, loader update, installer/uninstaller change, CLI command, or design decision MUST be written into MemPalace using add_memory. MemPalace is the authoritative source of truth for the CourseForge architecture.

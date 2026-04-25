# MemPalace Integration

## Purpose

MemPalace is now the persistent architectural memory layer for CourseForge. This file defines the mandatory workflow for recording architecture and design decisions.

## Permanent Governance Rule

From now on, every architectural change, new file, refactor, plugin addition, plugin removal, loader update, installer/uninstaller change, CLI command, or design decision MUST be written into MemPalace using add_memory. MemPalace is the authoritative source of truth for the CourseForge architecture.

## Scope of Required Logging

The following changes require immediate MemPalace logging:

1. Architecture documents and ADR-style decisions.
2. New modules, services, or interfaces.
3. Plugin lifecycle changes (loader, API, marketplace).
4. Installer/uninstaller behavior changes.
5. CLI command additions, removals, or semantic changes.
6. Breaking behavioral changes and migration guidance.

## Canonical Workflow

1. Implement code or document changes.
2. Write a concise MemPalace summary using add_memory.
3. Include rationale, affected files, and compatibility impact.
4. Link follow-up tasks when applicable.

## Required Memory Entry Template

Use this structure for every architectural memory entry:

- title: short decision title
- date: YYYY-MM-DD
- category: architecture | plugin | installer | cli | workflow
- change: what changed
- rationale: why it changed
- impact: affected modules and compatibility
- follow-up: optional next actions

## VS Code Agent Enforcement

The VS Code agent workflow must treat MemPalace logging as a required completion step for architecture-impacting changes.

Enforcement points:

1. Copilot instructions include this policy as mandatory.
2. Codex instructions include this policy as mandatory.
3. Architecture docs include this policy for long-term maintainers.
4. Task completion is blocked until memory entries are recorded.

## Integration With Plugin Architecture

For plugin-related work, at minimum record:

- loader lifecycle contract updates
- plugin API schema changes
- marketplace metadata and command contract changes

## Auditability

Every memory record must be deterministic and attributable to a specific change set. This ensures maintainers can reconstruct architecture evolution without relying on ephemeral chat context.

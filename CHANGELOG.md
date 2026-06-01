# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

## [1.7.0] - 2026-06-01

### Added

- Extraction orchestration foundation for Auto setup with science and math priority ordering: vocabulary, equations, concepts, and key ideas.
- Budget-threshold pause and batch-sizing logic for extraction runs to avoid overrunning token and sync budgets.
- Resumable extraction checkpoint state persisted with Auto session drafts, including queue restore and cleanup behavior.

### Updated

- Auto setup queue cards now surface extraction readiness versus paused-near-limit status.
- Core services index now exports extraction orchestration helpers for upcoming guided overlay and glossary automation slices.

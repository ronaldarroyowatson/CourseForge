# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Fixed

- Locked DSC semantic palette roles to exact authoritative values for MAJOR/MINOR/ACCENT/SUCCESS/WARNING/ERROR/INFO and prevented harmony controls from overriding semantic role colors.

### Added

- Added comprehensive DSC debug reporting with token-resolution records, fallback chains, component interaction state maps, contrast checks, and theme-generation snapshots.
- Added unified Settings Debug Log controls for report generation, full local debug clear, unified debug-mode toggling, and copy-to-clipboard report export.
- Added unified CLI debug pipeline support for `courseforge debug` with `--clear`, `--enable`, `--disable`, and `--report` flags.
- Added test coverage for locked semantic palette enforcement, DSC debug report structure, rolling debug-log safety, and CLI report generation.

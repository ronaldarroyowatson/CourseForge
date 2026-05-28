# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

## [1.6.3] - 2026-05-28

### Fixed

- Stopped stale pending-update metadata from overriding the true latest GitHub release in the settings page.
- Let the manual Sync Now path clear stale write-budget blocks before retrying the sync.

## [1.6.2] - 2026-05-28

### Fixed

- Hardened super-admin access so only the owner allowlist can promote or manage global privileges.
- Persisted daily sync usage to Firestore so admin and super-admin dashboards show stable read/write totals.
- Added a Super Admin global quota view and sync bypass for operational troubleshooting.

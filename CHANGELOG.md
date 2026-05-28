# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

## [1.6.4] - 2026-05-28

### Fixed

- Cleared stale read/write budget blocks when retrying Sync Now manually.
- Let the Super Admin navigation re-check claims at click time so a stale store state cannot hide the button.
- Kept the update banner anchored to the real GitHub release instead of pending-update metadata.

## [1.6.3] - 2026-05-28

### Fixed

- Stopped stale pending-update metadata from overriding the true latest GitHub release in the settings page.
- Let the manual Sync Now path clear stale write-budget blocks before retrying the sync.

## [1.6.2] - 2026-05-28

### Fixed

- Hardened super-admin access so only the owner allowlist can promote or manage global privileges.
- Persisted daily sync usage to Firestore so admin and super-admin dashboards show stable read/write totals.
- Added a Super Admin global quota view and sync bypass for operational troubleshooting.

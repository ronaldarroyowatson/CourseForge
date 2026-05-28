# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning.

## [Unreleased]

### Added

- Added School Admin and Super Admin upgrade flow, including Settings-based school/district affiliation, school-scoped admin controls, and global super-admin role/promotion tooling.

### Changed

- Super Admin dashboard stats now use authoritative sources: Firebase Auth user totals, collection-group textbook totals, and aggregated OCR/premium usage counters.
- Settings school affiliation placeholders now use generic helper text for first-time setup guidance.

### Fixed

- Improved dark-mode text visibility for textbook card status badges (for example `Partial`, `Best Data`, and duplicate-resolution quality chips) by using high-contrast dark-theme color overrides.

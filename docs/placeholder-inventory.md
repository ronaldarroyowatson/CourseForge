# Placeholder Inventory

Last updated: 2026-03-29
Scope: source, docs, scripts, and tests (release/build artifacts excluded)

## Replace Soon (production-facing)

1. `src/webapp/public/placeholder-icons/coderabbit-placeholder.svg`

- Purpose: temporary app/icon asset.
- Referenced by packaging script and release notes.
- Action: replace with final brand icon.

1. `scripts/create-portable-package.ps1:24`

- Uses `src/webapp/public/placeholder-icons/coderabbit-placeholder.svg` as source icon.
- Action: update to final icon path when asset is replaced.

1. `src/webapp/components/layout/Sidebar.tsx:6`

- Comment states sidebar is a static shell placeholder.
- Action: implement real navigation behavior and remove placeholder note.

## Keep (intentional runtime guard)

1. `src/firebase/firebaseConfig.ts:11`
1. `src/firebase/firebaseConfig.ts:14`
1. `src/firebase/firebaseConfig.ts:18`
1. `src/firebase/firebaseConfig.ts:19`

- These detect unresolved Firebase env placeholders (`YOUR_*`, `PLACEHOLDER`) and block startup with a clear error.
- Action: keep as-is.

## Keep (UI terminology, not backlog placeholders)

1. `src/webapp/styles/globals.css:365` (`.placeholder-panel`)
1. `src/webapp/styles/globals.css:521` (`.workflow-card-placeholder`)
1. `src/webapp/components/app/TextbookWorkspace.tsx:567`
1. `src/webapp/components/app/TextbookWorkspace.tsx:589`
1. `src/webapp/components/app/TextbookWorkspace.tsx:628`
1. `src/webapp/components/app/TextbookWorkspace.tsx:693`
1. `src/webapp/components/app/TextbookWorkspace.tsx:705`
1. `src/webapp/components/auth/LoginPage.tsx:44`
1. `src/webapp/components/auth/RequireAuth.tsx:15`
1. `src/webapp/components/auth/RequireAdmin.tsx:16`
1. `src/webapp/components/settings/SettingsPage.tsx:968`

- These are naming/style hooks or loading-state copy, not unresolved product placeholders.
- Action: no immediate change unless design language is renamed.

## Test Fixtures (do not replace)

1. `tests/core/xml.formatXml.test.ts:28` (`https://example.com/...`)
1. `tests/integration/app.integration.test.tsx:31` (`teacher@example.com`)
1. `tests/integration/extension.auth.communication.integration.test.ts:11` (`ext@example.com`)
1. `tests/integration/firebase.connection.integration.test.ts:25`
1. `tests/integration/firebase.connection.integration.test.ts:174`
1. `tests/integration/settings.updater.integration.test.tsx:108`
1. `tests/integration/startupSync.probe.test.tsx:14`
1. `tests/rules/firestore.rules.test.ts:85`
1. `tests/rules/firestore.rules.test.ts:295`

- Action: keep as synthetic fixture values.

## Documentation Mentions

1. `CHANGELOG.md:84`
1. `docs/releases/1.4.18.md:5`

- Historical references to the placeholder icon migration.
- Action: keep as release history.

## Notes

- The broad search term `placeholder` also matches many normal input `placeholder="..."` attributes. Those are expected UX text and were intentionally excluded from replace lists.
- Release bundles under `release/` contain mirrored compiled references and should not be used as source-of-truth for replacement work.

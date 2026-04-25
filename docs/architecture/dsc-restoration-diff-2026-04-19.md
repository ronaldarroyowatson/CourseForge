# DSC Restoration Diff Report (2026-04-19)

## Scope

This report captures intended-vs-current DSC recovery work completed in this patch set.

## Non-DSC Bug First: Ghost Textbooks

- Root cause: textbook delete flow removed local records immediately but did not propagate deletion to cloud, so sync could rehydrate records on startup.
- Fixes:
  - Repository delete now creates tombstones (`isDeleted`, `pendingSync`) for textbook plus chapter/section/content descendants.
  - Sync pipeline now handles tombstones by deleting cloud docs and then removing local tombstones.
  - Local listing APIs hide deleted textbooks from normal views.
  - Added boot-load and delete lifecycle logs for diagnostics.

## DSC Settings Card Behavior

- Before:
  - Settings card mixed launcher controls with extra minimal controls and duplicate status signals.
- After:
  - Not installed: helper text + `Install DSC Module` only.
  - Installed: helper text + `Open DSC Module` and `Uninstall DSC Module` only.
  - Duplicate installed/not-installed text removed.

## DSC Controls and Examples Restored

- Primary color scale:
  - Restored standardized 10-shade scale rendering.
  - Added luminance equation/helper text and per-shade luminance display.
  - Swatches now render actual per-shade color (no identical blocks).

- Accent and brand controls:
  - Moved from broad accent scale to 3 derived colors (brand/accent/alt).
  - Added color-wheel visualization with radial markers.
  - Added brand/accent radial distance sliders and helper equations.

- Harmony controls:
  - Added `System Default` and `Tetradic` options.
  - Harmony helper text now reflects full option set.

- Glow and shadow:
  - Default glow enabled for immediate preview.
  - Added glow radius and intensity controls.
  - Added shadow preset controls (`soft`, `balanced`, `dramatic`).
  - Shadow preview card now reads from tokenized shadow preset variable.

## Flicker Mitigation

- Reduced excessive DSC rerender/debug churn by removing high-frequency preview debug logging effect.
- Avoided no-op layout width state updates.
- Hardened floating card mouse event handling to reduce backdrop-interaction flicker.
- Added `will-change: transform` to floating card for smoother repaints.

## Files Changed

- `src/core/services/repositories/textbookRepository.ts`
- `src/core/services/syncService.ts`
- `src/webapp/hooks/useRepositories.ts`
- `src/webapp/components/app/TextbookWorkspace.tsx`
- `src/webapp/components/settings/SettingsPage.tsx`
- `src/core/services/designSystemService.ts`
- `src/webapp/components/settings/DesignSystemSettingsCard.tsx`
- `src/webapp/components/settings/FloatingDesignSystemCard.tsx`
- `src/webapp/styles/globals.css`
- `tests/core/textbookRepository.deletePersistence.test.ts`

## Compatibility Notes

- Added new persisted design-token fields with sanitizer defaults:
  - `brandDistance`, `accentDistance`, `glowRadius`, `glowIntensity`, `shadowPreset`.
- Existing local/cloud saved preferences remain compatible due sanitize + fallback strategy.

# OCR Pipeline Audit (2026-03-29)

## Objective

Confirm end-to-end OCR/metadata codepaths and safeguards for Auto Mode ingestion.

## Audited Areas

- OCR provider routing and failover: [src/core/services/autoOcrService.ts](src/core/services/autoOcrService.ts)
- Vision + OCR metadata pipeline: [src/core/services/metadataExtractionPipelineService.ts](src/core/services/metadataExtractionPipelineService.ts)
- Metadata correction learning/sync safeguards: [src/core/services/metadataCorrectionLearningService.ts](src/core/services/metadataCorrectionLearningService.ts), [src/core/services/metadataCorrectionSyncService.ts](src/core/services/metadataCorrectionSyncService.ts)
- UI telemetry/health visibility: [src/webapp/components/settings/SettingsPage.tsx](src/webapp/components/settings/SettingsPage.tsx)

## Verified Outcomes

1. Resume safeguards are present (queued draft snapshots, restore/remove actions).
2. Cover subject misclassification guard exists (science keyword cross-validation path).
3. Correction learning stats persist and surface in settings.
4. Copyright/publication extraction fields flow through metadata models.
5. Secondary-agent telemetry is surfaced in settings.
6. Telemetry is emitted to local debug logs and API diagnostics endpoint.

## Regression Coverage Added/Present

1. Cloud OCR keeps original image data URL input fidelity.
2. Metadata pipeline runtime status persists OCR fallback telemetry.
3. Auto flow integration includes queued draft limit behavior.

## TOC Crop Experiment Notes

1. Broad multi-sample TOC merging was not a win on the spread-view source-of-truth fixture.
2. A single well-chosen crop performed materially better than the greedy 10-crop ensemble on the same image.
3. The chosen default is now the best color crop, with grayscale kept only as a fallback when the color crop looks weaker.
4. Follow-up benchmark on the same gold transcript showed the best color crop at 60.68% CER vs 124.02% for the no-crop baseline.
5. Converting the full image to black and white did not help on this fixture: 125.62% CER vs 124.02% on color baseline.
6. Converting the best crop to black and white also did not help: 61.21% CER vs 60.68% for the color crop.
7. Next heuristic work should focus on deterministic crop boundary selection, not larger sample counts or blanket binarization.

## Follow-up

1. Keep this audit current when OCR provider policy or metadata pipeline stages change.

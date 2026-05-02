# Test Index

Generated: 2026-05-02T00:11:11.070Z

## Summary

- Total test files: 66
- Unit test files: 44
- Integration test files: 20
- Rules test files: 2
- Canonical sample files: 5

## Unit Tests

- tests/core/accessibilityService.test.ts
- tests/core/auth.initialization.test.ts
- tests/core/autoOcrService.test.ts
- tests/core/autoTextbookConflictService.test.ts
- tests/core/autoTextbookPersistence.localization.test.ts
- tests/core/copilot.auditLogger.test.ts
- tests/core/copilot.premiumUsageTracker.test.ts
- tests/core/debugLogService.test.ts
- tests/core/designSystemService.test.ts
- tests/core/designTokenDebugService.test.ts
- tests/core/documentExtraction.guardrails.test.ts
- tests/core/documentIngest.extraction.test.ts
- tests/core/equationFormatService.test.ts
- tests/core/gameTextService.test.ts
- tests/core/glossaryService.test.ts
- tests/core/i18nService.test.ts
- tests/core/installerLifecycle.matrix.test.ts
- tests/core/installerLifecycle.test.ts
- tests/core/masonryLayoutService.test.ts
- tests/core/mempalaceStartupIsolation.test.ts
- tests/core/metadataCorrectionLearningService.test.ts
- tests/core/metadataCorrectionSafeguards.test.ts
- tests/core/metadataExtractionPipelineService.test.ts
- tests/core/pluginService.test.ts
- tests/core/premiumUsage.limits.test.ts
- tests/core/presentationService.conversion.test.ts
- tests/core/programCli.dsc.test.ts
- tests/core/programCli.plugins.test.ts
- tests/core/semanticTokens.test.ts
- tests/core/syncBatchUpload.test.ts
- tests/core/syncNow.safety.test.ts
- tests/core/syncService.hardDeleteTextbookFromCloud.test.ts
- tests/core/syncService.moderationHold.test.ts
- tests/core/textbookAutoExtractionService.test.ts
- tests/core/textbookRepository.crossPortPersistence.test.ts
- tests/core/textbookRepository.deletePersistence.test.ts
- tests/core/tocPreviewPipeline.test.ts
- tests/core/tokenDebugService.test.ts
- tests/core/translationReviewService.test.ts
- tests/core/translationWorkflowService.test.ts
- tests/core/uiStore.preferences.test.ts
- tests/core/xml.escapeXml.test.ts
- tests/core/xml.exportXml.integration.test.ts
- tests/core/xml.formatXml.test.ts

## Integration Tests

- tests/integration/app.integration.test.tsx
- tests/integration/auto-update-launcher.integration.test.ts
- tests/integration/auto-update-portable.integration.test.ts
- tests/integration/autoTextbookFlow.integration.test.tsx
- tests/integration/chromeos.deployment.integration.test.ts
- tests/integration/correctionReviewPanel.integration.test.tsx
- tests/integration/designSystemSettingsCard.integration.test.tsx
- tests/integration/documentIngest.panel.integration.test.tsx
- tests/integration/extension.auth.communication.integration.test.ts
- tests/integration/extension.repositories.integration.test.ts
- tests/integration/firebase.connection.integration.test.ts
- tests/integration/functions.communication.integration.test.ts
- tests/integration/package-integrity.integration.test.ts
- tests/integration/settings.updater.integration.test.tsx
- tests/integration/startupSync.probe.test.tsx
- tests/integration/textbookDeletion.integration.test.tsx
- tests/integration/textbookDeletion.persistence.integration.test.ts
- tests/integration/textbookSyncRetry.integration.test.tsx
- tests/integration/update-status-server.integration.test.ts
- tests/integration/windows.installer.template.integration.test.ts

## Rules Tests

- tests/rules/firestore.rules.contract.static.test.ts
- tests/rules/firestore.rules.test.ts

## Canonical Smoke Samples

- tmp-smoke/samples/input__corrupted-json__expect-parse-failure.json
- tmp-smoke/samples/input__empty-file__expect-error.txt
- tmp-smoke/samples/ocr__copyright-page__expect-metadata-success.png
- tmp-smoke/samples/ocr__toc-spread-view__expect-parse-success.png
- tmp-smoke/samples/ocr__toc-text-capture__expect-parse-success.png

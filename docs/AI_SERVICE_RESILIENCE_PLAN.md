# AI Service Resilience Plan

This plan defines how CourseForge remains usable when an AI service is degraded, unavailable, or rate-limited.

## Completion Status

**Overall: 5/5 Phases Complete ✅**

- Phase 1: Cloud OCR Callable ✅
- Phase 2: Multi-Host Provider Expansion ✅
- Phase 3: Health + Circuit Breaker ✅
- Phase 4: Admin Controls + Fleet Visibility ✅
- Phase 5: Auto Flow Observability ✅

Last updated: March 21, 2026

## Goals

- Keep Auto textbook setup functional when cloud AI is down.
- Allow teachers/admins to select preferred providers.
- Support automatic fallback to backup providers.
- Capture local diagnostics to troubleshoot outages quickly.

## Current Baseline (Implemented)

- OCR provider abstraction in webapp service layer.
- Configurable provider order (primary + fallback) stored locally.
- Local OCR provider: Tesseract (offline-capable).
- Cloud OCR provider slot: OpenAI Vision via Firebase callable (`extractScreenshotText`) with runtime readiness check.
- Settings page controls:
  - primary provider selection
  - fallback provider selection
  - provider health refresh
- Auto Mode OCR uses fallback chain automatically.

## Phase 1: Cloud OCR Callable (Implemented)

- Add Firebase callable function `extractScreenshotText`.
- Input: `imageDataUrl`.
- Output: `{ success, message, data: { text } }`.

Security:

- authenticated users only
- request-size cap and rate limiting
- reject non-image payloads

Model host support:

- OpenAI first
- optional Azure Foundry endpoint parity

## Phase 2: Multi-Host Provider Expansion (Implemented)

- Added provider types:
  - `cloud_azure_foundry_vision` (plumbed, not configured)
  - `cloud_github_models_vision` (plumbed, not configured)
- Provider type definitions updated in:
  - Backend: `functions/src/index.ts` - `AutoOcrProviderId` type
  - Webapp: `src/core/services/autoOcrService.ts` - `AutoOcrProviderId` type
- Provider normalization logic updated to accept and validate new providers
- Settings page dropdowns extended to show all available providers
- Provider status response extended with Azure and GitHub placeholders
- Ready for credential/endpoint configuration as admin sets up providers

## Phase 3: Health + Circuit Breaker (Implemented)

- Health checks:
  - periodic provider ping
  - recent success/failure stats
- Circuit breaker:
  - open provider circuit after repeated failures
  - cooldown before retry
  - route to next provider automatically

## Phase 4: Admin Controls + Fleet Visibility (Implemented)

- Admin panel cards implemented in Settings page (`SettingsPage.tsx`):
  - Provider availability status display
  - Error messaging for unavailable providers
  - Health check refresh button
- Firestore-backed shared provider policy:
  - Policy document path: `config/aiProviderPolicy`
  - Load Shared Policy button for org admins
  - Save As Shared Policy button to define org-wide defaults
- Teachers/admins can:
  - Select primary and fallback OCR providers
  - Refresh provider health status
  - Load/save shared org policies
  - See real-time availability state of each provider

## Phase 5: Auto Flow Observability (Implemented)

- Auto textbook setup now emits trace-tagged lifecycle diagnostics for:
  - capture start/finish
  - upload preview confirmation
  - OCR + metadata extraction begin/result/failure
  - save validation + persistence outcomes
- Metadata extraction now emits trace-tagged diagnostics for:
  - vision extraction attempt status
  - vision failure reason and fallback decision
  - OCR fallback completion + final source summary
- Diagnostics are mirrored to:
  - local OCR debug sink (`/api/ocr-debug-log`)
  - in-app debug history for session-level troubleshooting

## Failure-Mode Expectations

- Cloud provider unavailable: local OCR continues.
- Local OCR unavailable (device/browser issue): cloud provider used when configured.
- All providers unavailable:
  - user sees actionable message
  - manual OCR text entry remains available

## Verification Coverage

Automated OCR resilience coverage is now included in the e2e lane via `npm run test:e2e:ocr`:

- `tests/core/autoOcrService.test.ts`
  - validates provider order normalization
  - validates cloud-provider health status mapping from `getAiProviderStatus`
  - validates availability cache behavior (cache hit and forced refresh)
  - validates fallback path when cloud is unavailable or temporarily unknown
  - validates full-failure behavior when all providers fail
- `tests/core/metadataExtractionPipelineService.test.ts`
  - validates vision-first path
  - validates fallback to OCR when vision throws or is insufficient
- `tests/integration/autoTextbookFlow.integration.test.tsx`
  - validates dropped-cover image processing triggers OCR pipeline
  - validates OCR provider/source status is surfaced in Auto setup UI

Live smoke checks should include:

- local OCR extraction against a representative cover image
- cloud OCR extraction attempt against the same image to validate provider availability and error messaging
- confirmation that trace IDs appear in `ocr-debug.log` across capture, extraction, fallback (if any), and save

## Non-Goals

- Full document OCR archival.
- Storing raw OCR body text in persistent records.

## Data Safety

- Auto Mode stores structured metadata and TOC entities only.
- Cover image may be stored; non-cover page images are not persisted.
- Debug logs are local-first and user-uploaded explicitly.

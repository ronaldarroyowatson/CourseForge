# AI Service Resilience Plan

This plan defines how CourseForge remains usable when an AI service is degraded, unavailable, or rate-limited.

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

## Phase 2: Multi-Host Provider Expansion

- Add providers:
  - `cloud_azure_foundry_vision`
  - `cloud_github_models_vision` (if enabled)
- Provider settings structure:
  - provider id
  - host
  - model id
  - timeout/retry policy
  - enabled/disabled
- Add provider capability matrix in settings.

## Phase 3: Health + Circuit Breaker (Implemented)

- Health checks:
  - periodic provider ping
  - recent success/failure stats
- Circuit breaker:
  - open provider circuit after repeated failures
  - cooldown before retry
  - route to next provider automatically

## Phase 4: Admin Controls + Fleet Visibility (Partially Implemented)

- Admin panel cards for:
  - active provider utilization
  - failure rates
  - outage status
- Firestore-backed shared provider policy so org admins can set defaults.

## Failure-Mode Expectations

- Cloud provider unavailable: local OCR continues.
- Local OCR unavailable (device/browser issue): cloud provider used when configured.
- All providers unavailable:
  - user sees actionable message
  - manual OCR text entry remains available

## Non-Goals

- Full document OCR archival.
- Storing raw OCR body text in persistent records.

## Data Safety

- Auto Mode stores structured metadata and TOC entities only.
- Cover image may be stored; non-cover page images are not persisted.
- Debug logs are local-first and user-uploaded explicitly.

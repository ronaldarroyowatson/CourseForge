# Cloud OCR Diagnostics

This guide covers the cloud OCR diagnostics path, smoke test workflow, and the exact failure signals CourseForge now emits before falling back to a secondary provider or local OCR.

## Provider Order

- Primary cloud provider: configurable in Settings
- Secondary cloud provider: configurable in Settings
- Final fallback: local Tesseract only after both cloud providers fail or return unusable text

Current live cloud providers:

- `cloud_openai_vision`
- `cloud_github_models_vision`

## Callable Diagnostics

The `extractScreenshotText` Firebase callable now returns or throws provider-specific diagnostics with these fields:

- `providerId`
- `providerLabel`
- `traceId`
- `reasonCode`
- `reasonMessage`
- `httpStatus`
- `failureStage`
- `requestAcceptedByFunction`
- `providerRequestPrepared`
- `providerRequestSent`
- `providerResponseReceived`
- `providerExecutionObserved`

Typical failure stages:

- `preflight_credentials`: provider token or API key missing
- `provider_request`: request failed before any provider response
- `provider_timeout`: provider request timed out
- `provider_response`: non-2xx response returned by the provider
- `response_parse`: provider returned non-JSON content
- `response_validate`: provider returned JSON without usable OCR text

## Local Diagnostics

Webapp-side OCR diagnostics continue to mirror events to:

- local debug history
- `/api/ocr-debug-log`

Cloud extraction failures are now emitted with the provider id, trace id, and failure metadata so the fallback path is visible in the local log.

Metadata extraction failures now also emit bounded post-mortem diagnostics when title/copyright-page recovery cannot collect the required fields after retrying:

- OCR metadata completion retries are capped at `3` attempts for completeness recovery
- the best available merged metadata is returned instead of failing indefinitely
- `ocr_max_attempts_reached` includes missing critical fields, missing target fields, and a failure snapshot
- the failure snapshot now carries a bounded image preview artifact so the failed page can be inspected later without uploading the full source image payload

## Smoke Test Command

Run the live smoke test with:

```powershell
npm run test:smoke:ocr:cloud
```

What it does:

- generates a copyright-page sample PNG with strict left/right column boundaries
- checks live OCR-agent reachability by calling OpenAI Vision and GitHub Models Vision
- checks live metadata-agent reachability against the same sample image
- validates OCR completeness for required copyright-page text sections
- validates expected metadata extraction fields (ISBN, publisher location, copyright year, publisher URL, grade band from field or URL, MHID)
- writes a machine-readable JSON report to `tmp-smoke/`

## Required Credentials

- OpenAI: `OPENAI_API_KEY`
- GitHub Models: `COURSEFORGE_GITHUB_TOKEN`, `GITHUB_TOKEN`, or a token returned by `gh auth token`

For deployed Firebase Functions, GitHub Models should be backed by the `COURSEFORGE_GITHUB_TOKEN` function secret.

## How To Read Failures

Examples:

- `reasonCode=auth_failed`: credentials were sent and rejected by the provider
- `reasonCode=rate_limited`: provider is currently unusable due to rate limiting or quota exhaustion
- `reasonCode=request_failed`: request was prepared and sent, but no provider response was received
- `reasonCode=empty_text`: provider responded successfully but returned no usable OCR output
- `reasonCode=unusable_text`: smoke test received text that did not contain the expected textbook keywords

For metadata fallback diagnostics, inspect these additional fields when present:

- `missingCriticalFields`: fields still blocking a complete copyright-page extraction, currently `isbn` and `copyrightYear`
- `missingTargetFields`: broader debug target list used for triage, including `title`, `publisher`, `publisherLocation`, `platformUrl`, and `mhid`
- `failureSnapshot.imageArtifact.previewDataUrl`: truncated inline preview of the page image captured with the failed metadata snapshot

When a cloud provider is marked unavailable, CourseForge keeps that state in the provider-health cache for the TTL window to avoid repeating dead-end calls before trying the next provider.

## Metadata Interpretation Safeguards

OCR text is post-processed before metadata is mapped into CourseForge fields:

- section-heading lines such as `Module 1`, `Unit 2`, `Chapter 3`, or `Lesson 4` are prevented from replacing textbook title/subtitle values
- URL-only lines are excluded from publisher detection
- high-confidence vision subject guesses are cross-checked against the raw OCR/page text so explicit textbook signals like `Physical Science` and `Earth Science` override incidental terms from surrounding copy

This safeguard set is regression-tested against the Inspire Physical Science copyright-page screenshot content, including mixed-column OCR ordering, copyright text, address block, ISBN, MHID, and the `mheducation.com/prek-12` URL.

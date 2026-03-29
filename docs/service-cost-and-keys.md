# Service Cost and Keys

Last updated: 2026-03-29

## Scope

This note documents where CourseForge uses cloud services for OCR/metadata extraction, which keys are required, and practical cost controls.

## Services Used

1. OpenAI Vision (cloud OCR path)
2. GitHub Models Vision (cloud OCR path)
3. Firebase Functions + Firestore (metadata extraction callable + debug/correction telemetry)

## Required Credentials

- OpenAI API key: used when provider `cloud_openai_vision` is selected; missing key is surfaced as `preflight_credentials` in diagnostics.
- GitHub Models token/key: used when provider `cloud_github_models_vision` is selected; missing key is surfaced as `preflight_credentials` in diagnostics.
- Firebase project credentials/config: required for callable functions and cloud sync features; placeholder values are intentionally blocked at runtime by config guards.

## Where Health and Missing-Key State Appears

1. Diagnostics doc: [docs/CLOUD_OCR_DIAGNOSTICS.md](docs/CLOUD_OCR_DIAGNOSTICS.md)
2. Settings UI provider health panel
3. Metadata learning panel runtime status

## Cost Drivers

1. Number of cloud OCR invocations
2. Image payload size per capture
3. Retry/fallback frequency across providers
4. Metadata correction/debug upload volume

## Cost Controls Already in Code

1. Multi-provider policy with local fallback to Tesseract
2. Circuit-breaker style provider health and failover
3. Runtime status and trace visibility for debugging noisy retries
4. Debug upload and payload-size limits via admin policy
5. Metadata correction safeguards (daily caps/queue controls)

## Operator Guidance

1. Prefer local OCR for low-stakes captures where possible.
2. Keep cloud providers enabled for difficult pages and fallback resilience.
3. Monitor provider health in settings before bulk ingestion sessions.
4. Use admin debug policy limits to keep upload and storage spend bounded.
5. Review correction queue regularly to reduce repeated low-confidence retries.

## Key Rotation Checklist

1. Rotate key/token in secure environment store.
2. Verify diagnostics no longer report `preflight_credentials`.
3. Run `npm run test:smoke:ocr:cloud`.
4. Confirm settings health panel reports expected provider availability.

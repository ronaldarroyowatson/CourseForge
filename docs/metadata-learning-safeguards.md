# Metadata Learning Safeguards

This document describes the OCR + Vision metadata correction safeguards and review workflow.

## Client Safeguards

- Daily upload limit: default 25 correction samples per user per day.
- Rate limit: maximum one upload attempt every 5 seconds.
- Queueing: additional samples remain local and are uploaded on future sync attempts.
- Sample size limit: image snippet reference must be <= 200 KB (estimated from data URL payload when present).
- Validation: each sample requires a title, at least one source output, and a valid image reference.
- Poisoning heuristics: random character runs, symbol-heavy metadata, and nonsense publisher rewrites are flagged.
- Low confidence flagging: final confidence below 0.65 is sent to pending review instead of auto-trusted.
- Opt-in requirement: sharing must be explicitly enabled by the user in Settings.

## Extended Correction Record

Each correction record includes review and ranking fields:

- `flagged`
- `reasonFlagged`
- `finalConfidence`
- `errorScore`
- `reviewedByAdmin`
- `reviewStatus` (`pending`, `accepted`, `rejected`)

`errorScore` is computed as `abs(vision_confidence - final_confidence)` and used for review prioritization.

## Cloud APIs

Callable APIs backing the correction workflow:

- `correctionsUpload`
- `correctionsList`
- `correctionsReview`
- `correctionsRules`
- `correctionsRulesUpdate`

REST fallback endpoints expected by local/dev stubs:

- `POST /api/corrections/upload`
- `GET /api/corrections/list`
- `POST /api/corrections/review`
- `GET /api/corrections/rules`
- `POST /api/corrections/rules/update`

## Admin Review Workflow

Admins can:

- Filter by publisher, page type, source, confidence, date range, status, and flagged state.
- Sort by timestamp, final confidence, or error score.
- Preview source outputs, image references, and final metadata.
- Accept, reject, or modify records.
- Run bulk accept/reject actions.
- Export selected rows as JSON.

## Audit Logging

Admin actions are logged in `metadataCorrectionAuditLogs` with actor, action, targets, and before/after snapshots.

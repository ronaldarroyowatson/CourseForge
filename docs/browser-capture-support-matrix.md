# Browser Capture Support Matrix (macOS + Web App)

## Scope

This matrix documents the supported capture path for `AutoTextbookSetupFlow` when running the web app on macOS. It reflects the current implementation in:

- `src/webapp/utils/displayCapture.ts`
- `src/webapp/components/textbooks/AutoTextbookSetupFlow.tsx`

## Summary

| Browser | Support Level | Extension Required | Notes |
|---|---|---|---|
| Chrome (macOS) | Strong | No | Preferred. Full screen/window chooser path via `getDisplayMedia`; optional Chrome tab capture path still available in extension contexts. |
| Edge (macOS) | Strong | No | Preferred parity with Chrome for capture-heavy workflows. |
| Safari (macOS) | Limited | No | Basic capture is supported, but chooser behavior can be stricter and less predictable than Chromium. |
| Firefox (macOS) | Limited | No | Basic capture may work; not primary test target for current UX tuning. |
| Unknown browser | Unknown | No | Users should switch to Chrome/Edge if capture errors persist. |

## Safari Audit (Current Findings)

1. Safari is a no-extension path for baseline capture. There is no Safari-equivalent usage of the Chrome extension tab API in the web runtime.
2. The chooser UX and cancellation semantics can differ from Chromium browsers.
3. Failures should be treated as actionable diagnostics, not generic OCR failures.

## Runtime Diagnostics and Error Mapping

The capture flow now classifies capture faults into specific categories:

- `permission_denied`
- `chooser_cancelled`
- `api_unavailable`
- `device_unavailable`
- `no_video_track`
- `frame_unavailable`
- `unknown`

These are normalized in `normalizeDisplayCaptureError()` and surfaced in UI messages in `AutoTextbookSetupFlow`.

## Debug Emission (Local + Remote)

To ensure traceability even when `/api/ocr-debug-log` is unavailable in local runs:

1. Diagnostics are still attempted to `/api/ocr-debug-log` (best effort).
2. Diagnostics are always emitted locally through `emitClientDebugTrace()`.
3. Local traces are written to:
   - console (`[CourseForge debug][<channel>] ...`)
   - localStorage key: `courseforge.clientDebugTrace.v1`

Channels currently mirrored:

- `auto-flow`
- `ocr`
- `metadata-pipeline`

## Operational Guidance

1. For teacher-facing reliability on macOS, default guidance should recommend Chrome or Edge.
2. Keep `Upload Image` available as the immediate fallback for all capture steps.
3. When users report a flash/close chooser issue, collect:
   - UI error text
   - local trace entries from `courseforge.clientDebugTrace.v1`
   - browser name/version and macOS Screen Recording permission state

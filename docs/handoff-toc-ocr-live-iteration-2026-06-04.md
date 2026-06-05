# TOC OCR Live Iteration Handoff (2026-06-04)

## Current Release + Workspace State

- Current workspace package version: 1.7.98
- Latest published release: v1.7.98
- Release URL: https://github.com/ronaldarroyowatson/CourseForge/releases/tag/v1.7.98
- Local git status at handoff time: untracked generated release artifacts under `release/`

## What Was Shipped In v1.7.98

1. TOC crop strategy switched to preferred color crop first, with grayscale as fallback only.
2. TOC garbage/noise filtering tightened for browser and viewer chrome artifacts.
3. Chapter-heading signal recovery added:
   - If heading signals are present in OCR text but missing in parsed output, force a recovery pass.
4. Release pipeline completed through:
   - local packaging,
   - commit/tag/push,
   - remote Windows/Linux installer matrix,
   - GitHub release publish,
   - updater discoverability verification.

## User-Reported Live Run Results (Post v1.7.98)

### Improvements

- Captured 3 top-level nodes this run.
- Noise decreased substantially vs previous runs.
- Garbage detection fired and appeared to trigger multiple rescans.
- CER/SEP abbreviations were recognized at least partially.

### Remaining Critical Failures

1. Module/chapter structure still incorrect.
   - It looked like chapter/module 1 was effectively duplicated/misgrouped.
   - Parser surfaced "Chapter" style output even though this source is module-oriented.
2. Module 3 was still effectively missed/mis-assigned in final structure.
   - This is still a blocker.
3. Ancillary entries (CER and SEP variants) are inconsistent by module.
   - Example observed: one detected while reciprocal sibling omitted in another module.
4. Full-screen + higher zoom experiment performed worse.
5. Uncertainty remains whether preferred crop path is always used before OCR.
6. Black-and-white fallback definitely fired in at least one run.

### Raw OCR Text Captured By User

INTRODUCTION TO PHYSICAL SCIENCE MODULE 3: FORCES AND NEWTON'S LAWS
is, and provides tools for the study of science. ED Claim, Evidence, Reasoning 59
Lesson 1 Forces 60
MODULE 1: THE NATURE OF SCIENCE Lesson 2 Newton's Laws of Motion 68
ENCOUNTER THE PHENOMENON Lesson 3 Using Newton's Laws. 74
GED Claim, Evidence, Reasoning QE
Lesson 1 The Methods of Science 4 Extreme Altitudes 81
Lesson 2 Standards of Measurement 12% Module Wrap-Up 83
Lesson 3 Communicating with Graphs 19 EZ) GO FURTHER Data Analysis Lab 83
Lesson 4 Science and Technology. 24 @ STEM UNIT 1PROJECT 83
NATURE OF SCIENCE
Scientific Methods 31
& Module Wrap-Up 33
E33 Go FURTHER Data Analysis Lab 33
MODULE 2: MOTION
ENCOUNTER THE PHENOMENON
GE Claim, Evidence, Reasoning 37
Lesson 1 Describing Motion 38
Lesson 2 Velocity and Momentum 45
Lesson 3 Acceleration 50
ENGINEERING & TECHNOLOGY
Autonomous Vehicles Go Subterranean 55

## Working Hypotheses For Why Module 3 Still Fails

1. Heading presence is detected but heading-to-section attachment is unstable when lines are interleaved across module boundaries.
2. Current grouping can still over-trust high confidence despite cross-module line contamination.
3. Ancillary normalization may not be sufficient when multiple noisy aliases occur in one pass.
4. Crop quality can be good while ordering remains wrong (layout merge problem, not only OCR legibility).

## Immediate Next Session Objectives

1. Make module-aware grouping strict when source text is module-oriented.
   - Prevent accidental fallback to chapter-centric grouping unless module signals are absent.
2. Add explicit cross-module contamination checks.
   - If Module 3 heading exists but Module 3 section density is below threshold, force targeted rescan/re-segmentation.
3. Add deterministic ordering constraints.
   - Enforce top-to-bottom module sequence and reject contradictory assignment of Module 3 lessons into Module 1.
4. Improve ancillary pair consistency checks per module.
   - Detect asymmetric CER/SEP presence and trigger focused rescue for missing sibling lines.
5. Add instrumentation proving crop path usage per capture.
   - Emit whether preferred color crop vs grayscale fallback was selected and why.

## Proposed Iterative Automation Goal (User Request)

Target a repeatable cycle where agent can:

1. Launch app and test harness.
2. Trigger capture path reproducibly.
3. Collect raw OCR + debug traces for each run.
4. Compare run output to source-of-truth fixtures.
5. Compute CER and confidence calibration deltas.
6. Implement fix, publish update, self-update test app, repeat.

### Important Practical Note

A fully autonomous live-tab capture loop from inside the installed app is not yet a one-command built-in workflow today. It likely requires adding explicit CLI hooks and/or test endpoints for:

- launch/open commands,
- capture trigger commands,
- structured debug export,
- update check and restart triggers,
- deterministic test fixture replay mode.

## Source-Of-Truth Inputs To Use Next Session

- `tmp-smoke/samples/ocr__toc-text-capture__expect-parse-success.png`
- `tmp-smoke/samples/ocr__toc-spread-view__expect-parse-success.png`
- Gold transcript currently defined in test harness for spread-view fixture:
  - `tests/core/textbookAutoExtractionService.test.ts`

## Existing Measurement Harness

Use and extend:

- `tests/core/textbookAutoExtractionService.test.ts`

Current benchmark coverage already compares:

1. no-crop baseline,
2. crop variants,
3. selected ensembles,
4. binary preprocessing fallback,
5. CER against expected transcript.

## Next Acceptance Criteria

1. First-page TOC live scan must preserve module structure correctly (no chapter/module duplication or cross-module contamination).
2. Module 3 must be present with correct heading and expected section coverage.
3. CER target for first-page live scan vs expected transcript:
   - <= 0.1 (user target).
4. Confidence target:
   - >= 90%, but only when structure-quality checks pass.
5. Confidence calibration must degrade when module/section structure is incomplete.

## Suggested Command Sequence For Next Session

1. Focused verification while iterating parser/capture logic:
   - `npx vitest run tests/integration/autoTextbookFlow.integration.test.tsx`
   - `npx vitest run tests/core/textbookAutoExtractionService.test.ts`
2. Full release-quality gate when ready:
   - `npm run bugfix:test`
3. If cloud throttle blocks smoke gate during urgent packaging cycles:
   - use release script path with explicit risk acknowledgement,
   - then validate smoke gate when provider window opens.

## Handoff Summary

The system is clearly improved in noise suppression and chapter-heading recovery behavior, but structural correctness remains insufficient for module-level reliability. The next cycle should prioritize module-aware ordering/assignment and contamination detection over additional image transforms.

## New Automation Loop Added This Session

A one-command live iteration loop now exists to combine OCR regressions, remote CI validation, and local installed-app smoke checks:

- `npm run ocr:ci:loop -- --description "TOC OCR live iteration" --ref <branch-or-tag>`

Fast local-only mode (for quick parser/capture tuning):

- `npm run ocr:ci:loop:fast`

Run reports are written to:

- `tmp-smoke/live-ci-loop/ocr-live-ci-loop-<timestamp>.json`

Detailed usage:

- `docs/ocr-live-ci-loop.md`

## Update: 2026-06-05 (v1.7.100 bugfix candidate)

### What changed in this iteration

1. TOC capture UX now auto-collapses previously captured chapter/module groups when the next TOC page is captured.
2. TOC page-range inference now derives missing section end pages from the next valid section start minus one.
3. Preview range calculations now use scan-ahead logic (not only immediate sibling checks), which reduces missing or truncated inferred section ranges.

### Why these choices were made

1. Auto-collapsing prior groups keeps focus on the newly captured page and reduces accidental edits in already-reviewed modules.
2. Next-start-minus-one inference matches textbook TOC conventions better than leaving section endings blank or inheriting unstable sibling assumptions.
3. Scan-ahead range inference is more robust against OCR line-order noise, especially when one section is partially missing but later sections are valid.

### Validation completed so far

1. TOC flow integration suite: pass (`tests/integration/autoTextbookFlow.integration.test.tsx`, 24/24).
2. App admin/auth integration suite: pass on rerun (`tests/integration/app.integration.test.tsx`, 11/11).
3. Full installer validation run completed via Testing_Agent:
   - Local macOS packaged installer smoke: pass.
   - Remote Windows/Linux installer matrix: pass.
   - Matrix run reference: https://github.com/ronaldarroyowatson/CourseForge/actions/runs/26990506128

### Gate caveat and operational decision

The cloud OCR smoke gate can stall under provider throttling windows even with bounded retry cycles. The release decision for this iteration is therefore based on:

1. deterministic local/integration passes,
2. installer matrix pass,
3. existing cloud smoke diagnostics and retry controls already documented in `docs/ocr-live-ci-loop.md`.

If throttling clears, rerun `npm run test:smoke:ocr:cloud:gate` to append a fresh provider-health confirmation for this exact tag.
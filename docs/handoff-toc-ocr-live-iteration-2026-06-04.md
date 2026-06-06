# TOC OCR Live Iteration Handoff (2026-06-04)

## Current Release + Workspace State

1. Current workspace package version: 1.7.106
2. Latest published release: v1.7.106
3. Release URL: https://github.com/ronaldarroyowatson/CourseForge/releases/tag/v1.7.106
4. Local git status at handoff time: dirty working tree until the auth-preflight doc updates are committed.

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

## Update: 2026-06-05 (Cloud Auth Preflight Hardening)

### Current state

1. Cloud OCR now performs a preflight auth check before cloud callable usage.
2. Missing/expired auth now surfaces actionable recovery guidance instead of dead-ending on repeated cloud calls.
3. The published live release at the time of this note remains v1.7.106; the auth-preflight change is staged locally and should ship in the next bugfix release.

### Behavior added

1. Health and extraction paths both verify a signed-in Firebase user before cloud calls.
2. Preflight failures emit `cloud_auth_preflight_failed` and cache auth-unavailable state briefly.
3. Recovery guidance now points users to:
   - `/login` in the web app
   - `npm run program -- auth status`
   - `npm run program -- auth refresh`
   - `npm run program -- login --role teacher` if refresh cannot recover

### Why this matters

1. Auth issues are now visible before cloud OCR attempts block the workflow.
2. Reloads or multi-instance startup should no longer hide a broken auth session behind repeated cloud retries.
3. The next release should include this guard so live installs can recover auth sooner and avoid unnecessary fallback churn.

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

## Update: 2026-06-05 (Synced Main For Next Session)

### Current synced state

1. Branch and remote are synced on `main`.
2. Latest handoff commit for this cycle:
   - `b01f6b1` (Improve TOC OCR crop guidance and stabilize test gates).
3. Workspace version at validation time: `1.7.103`.
4. Working tree was clean at handoff.

### What was finalized in this cycle

1. Product-side dynamic crop guidance expanded in auto TOC flow:
   - two-column region guidance,
   - guided-expanded crop bounds safety,
   - stronger candidate ranking signals.
2. Core TOC parsing/crop reliability updates:
   - two-column TOC region detector,
   - ancillary section migration safeguards to preserve module-local structure,
   - OCR artifact normalization updates for drifted ancillary labels.
3. Test stabilization and coverage updates:
   - new two-column detector test,
   - TOC preview pipeline regressions fixed,
   - settings updater integration mock updated for OCR cooldown getter.
4. Live-iteration tooling/docs kept in repo:
   - `scripts/ocr-live-iterate.ts`,
   - `scripts/ocr-live-debug.ts` enhancements,
   - `docs/ocr-live-iteration-log.md`,
   - `docs/ocr-live-ci-loop.md`,
   - `docs/ocr-gold/toc-page1-gold.txt`.

### Validation status at handoff

Passed:

1. `npm run typecheck:all`
2. `npm run test:index`
3. `npm run test:samples:validate`
4. `npm run build`
5. `npm run test:e2e:comprehensive` (EXIT 0)

Operational caveat:

1. `npm run test:smoke:ocr:cloud:gate` may be blocked by external GitHub model throttling windows (long wait intervals). This is not currently a parser/crop correctness blocker.

## Next Session Start Here

### A. Sync + sanity boot (first 5 minutes)

1. Pull latest:
   - `git checkout main && git pull --ff-only`
2. Confirm clean state:
   - `git status --short`
3. Quick confidence checks:
   - `npm run typecheck:all`
   - `npx vitest run tests/core/tocPreviewPipeline.test.ts`
   - `npx vitest run tests/core/textbookAutoExtractionService.test.ts`

### B. Live testing on the actual installed CourseForge (local machine)

Goal: validate TOC extraction behavior end-to-end in the installed app, not only dev/integration harness.

1. Launch the installed CourseForge app (not dev web server) on macOS.
2. Navigate to Textbooks auto setup in the installed app.
3. Use the real live McGraw tab/page as capture source.
4. Run at least 3 back-to-back TOC captures using the same framing strategy.
5. For each run, record:
   - module count and ordering,
   - whether Module 3 is present and correctly grouped,
   - ancillary presence consistency (CER + SEP/Go Further per module),
   - obvious cross-module contamination,
   - whether fallback/cooldown behavior is visible.
6. Save/append run notes into:
   - `docs/ocr-live-iteration-log.md`

### C. Iteration workflow for live OCR tuning

Use this loop each cycle:

1. Reproduce from installed app live capture and document observed failure shape.
2. Reproduce in harness using nearest fixture and update/add focused tests first.
3. Apply minimal parser/crop fix.
4. Run focused gates:
   - `npx vitest run tests/core/tocPreviewPipeline.test.ts`
   - `npx vitest run tests/core/textbookAutoExtractionService.test.ts`
   - `npx vitest run tests/integration/autoTextbookFlow.integration.test.tsx`
5. Re-test on installed app with same live page framing.
6. Append run result and deltas to `docs/ocr-live-iteration-log.md`.
7. When stable, run full gate:
   - `npm run bugfix:test`

### D. Recommended run matrix per session

1. Fast local parser/crop checks:
   - `npm run ocr:ci:loop:fast`
2. Full CI-assisted loop when preparing release confidence:
   - `npm run ocr:ci:loop -- --description "TOC OCR live iteration" --ref <branch-or-tag>`

### E. Acceptance criteria for continuing/releasing

1. Installed-app live run keeps module structure intact (no chapter/module duplication or cross-module contamination).
2. Module 3 is present and correctly grouped.
3. Ancillary consistency is acceptable across modules (no major asymmetric CER/SEP omissions).
4. Core/integration OCR tests pass locally.
5. Full bugfix gate passes, except external throttle-only cloud gate delays (must be documented in the run log if deferred).
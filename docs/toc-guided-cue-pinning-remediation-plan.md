# TOC Guided Cue Pinning Remediation Plan

## Status

- Created: 2026-06-02
- Scope: Auto textbook TOC guided cue pinning in `AutoTextbookSetupFlow`
- Mode: Active staged execution

## Phase Outcomes

- Phase 1 result: Not viable in live manual validation.
   - Outcome summary: "window-inside-window" effect did not increase practical visible source area for hidden left-edge controls.
- Phase 2 status: In implementation and validation cycle.
   - Current implementation focus: stitched cue pinning canvas from multiple TOC captures, including edge recapture stitching.

## Problem Statement

Teachers still cannot reliably pin left-edge browser controls (for example back/TOC menu) during guided cue setup. The current fullscreen mode increases preview area, but it can still magnify or scroll within a constrained screenshot experience rather than guaranteeing practical access to all needed controls.

## User-Observed Failure

- Left edge controls remain invisible or difficult to pin.
- Fullscreen mode enlarges the same limited area instead of behaving like full-screen exploratory guidance.
- Guided setup confidence drops because cues cannot be pinned with certainty.

## Confirmed Technical Findings

- TOC capture path preserves raw TOC frame (`cropped = rawImage`) to avoid recrop loss.
- Fullscreen pinning currently renders a static image in a scrollable viewport.
- Pin coordinates are computed from click position against the rendered image rectangle.
- Existing TOC two-shot flow merges OCR text, but cue pinning still uses the first captured image.

## Candidate Solution Set

1. Fullscreen fit mode plus native pan mode toggle.
2. Automatic left-edge focus on fullscreen open.
3. Directional edge recapture actions (left/right/up/down) with explicit user guidance.
4. Multi-shot stitched cue canvas (image stitching for pinning, not only OCR merge).
5. Live pass-through capture/overlay mode for interactive pinning against current screen state.

## Phased Plan

### Phase 1 (Immediate, low-risk)

Goal: Increase chance of successful cue pinning without architecture rewrite.

Planned implementation:

1. Add fullscreen fit/native view toggle.
2. Add automatic left-edge focus behavior when opening fullscreen (for native mode).
3. Add directional TOC recapture controls from the fullscreen pinning experience.
4. Add targeted UX copy clarifying how to include missing edges before recapture.

Expected outcome:

- Better visibility and usability for edge cue pinning.
- Faster recovery path when controls are out-of-frame.

### Phase 2 (Fallback if Phase 1 is not viable)

Goal: Eliminate dependence on a single frame.

Planned implementation:

1. Build stitched multi-shot TOC cue image canvas.
2. Persist and reuse stitched cue canvas for pinning.
3. Preserve coordinate mapping consistency for automation playback.

Expected outcome:

- Hidden edges recoverable through composed panoramic capture.

### Phase 3 (Long-term architecture)

Goal: Highest-confidence interactive cue targeting.

Planned implementation:

1. Evaluate live pass-through capture/overlay mode.
2. Support full-screen guidance anchored to live content rather than static image.

Expected outcome:

- Maximum cue pinning reliability across varied textbook viewers.

## Execution and Decision Cycle

Each phase is tested with the same gate:

1. Implement phase patch.
2. Run regular workflow and tests.
3. Publish patch release.
4. Perform manual live-install validation.
5. Decide:
   - If working or near-working: continue iterative debugging in same phase.
   - If non-viable: abandon that phase and advance to next phase.

## Standard Validation Gate

Use the standard CourseForge bugfix workflow for each phase iteration:

1. `npm run bugfix:test`
2. `npm run orchestrate:installers:wait -- --description "..." --ref <ref>`
3. `npm run bugfix:release -- -Description "..."`
4. Verify latest release discoverability via `gh api repos/ronaldarroyowatson/CourseForge/releases/latest`

## Progress Checkpoint Policy

Before any new phase implementation begins:

1. Commit documentation and planning state.
2. Ensure clean git baseline.
3. Start implementation from that checkpoint so rollback is trivial.

## Current Next Step

Run the Phase 2 workflow cycle: quality gate, release publish, and live-install manual validation.
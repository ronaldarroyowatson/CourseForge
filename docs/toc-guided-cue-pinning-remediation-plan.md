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
- Phase 3 status: Activated after Phase 2 live failure report.
   - Current implementation focus: live pass-through guided pinning overlay with explicit self-capture guardrails.
- Phase 4 status: Activated after Phase 3 partial failure report.
   - Current implementation focus: teach/replay macro path with recorded click steps, anchor regions, extension-tab replay automation, and live-overlay mount reliability fixes.
   - Active hotfix focus: attach live stream only after fullscreen video mount and allow teach-step recording even when no cue is currently selected.
- Phase 5 status: Proposed from live validation of v1.7.71.
   - Planning focus: dynamic tree-menu navigation that re-detects actionable targets after each expand/collapse state change instead of replaying stale coordinates.
   - Pre-implementation cleanup: reduce Phase 1-4 UI clutter so cue workflow is linear and obvious before adding dynamic mapping controls.
   - Experiment A implementation status: In-flight baseline shipped for manual validation.
   - New capability: fullscreen `Scan TOC Map` action (extension runtime) that captures state-aware clickable TOC candidates from the active tab DOM and lists them top-to-bottom for operator verification.

## UI Simplification Baseline (Before Phase 5 Build)

Goals:

1. Keep only controls that are actionable in the current workflow.
2. Hide optional/non-critical cue controls by default.
3. Replace multi-button edge/pan recovery controls with one clear recapture action.

Applied cleanup direction:

1. Fullscreen controls now prioritize core cues (`openToc`, `openGlossary`, `nextPage`) as the default visible set.
2. Optional cues (`openChapter`, `openSection`) are behind a single "Show Optional Cues" toggle.
3. Legacy clutter controls removed from default workflow:
   - Fullscreen pan controls.
   - Directional edge recapture controls.
   - Teach replay trigger from fullscreen panel.
4. Recovery action simplified to one explicit `Recapture TOC Frame` control.

Expected UX result:

- Fewer simultaneous decisions while pinning.
- Clear sequence for operators: choose core cue -> click pin target -> recapture frame if layout changed.
- Cleaner foundation for introducing Phase 5 dynamic tree-map controls.

## Problem Statement

Teachers still cannot reliably pin left-edge browser controls (for example back/TOC menu) during guided cue setup. The current fullscreen mode increases preview area, but it can still magnify or scroll within a constrained screenshot experience rather than guaranteeing practical access to all needed controls.

## User-Observed Failure

- Left edge controls remain invisible or difficult to pin.
- Fullscreen mode enlarges the same limited area instead of behaving like full-screen exploratory guidance.
- Guided setup confidence drops because cues cannot be pinned with certainty.
- Coordinate drift after click: opening TOC or expanding tree nodes changes vertical layout, so previously pinned click locations no longer match the intended control.
- Contextual tree interactions: first-level nodes (for example Unit/Module) expose child nodes on click, and this structural expansion shifts all downstream controls.

## Confirmed Technical Findings

- TOC capture path preserves raw TOC frame (`cropped = rawImage`) to avoid recrop loss.
- Fullscreen pinning currently renders a static image in a scrollable viewport.
- Pin coordinates are computed from click position against the rendered image rectangle.
- Existing TOC two-shot flow merges OCR text, but cue pinning still uses the first captured image.
- Teach/replay currently records and replays viewport ratios; it does not re-acquire targets by semantic identity after the page layout mutates.
- Extension replay currently injects synthetic mouse events by point only; it does not evaluate whether the click changed the expected tree state.

## New Findings From Live Validation (v1.7.71)

1. Full-frame live overlay can now show the textbook tab reliably enough for accurate first-click pinning.
2. Static point pinning remains non-viable for tree UIs because each expansion mutates subsequent target positions.
3. A single global map is insufficient; the system needs state-by-state remapping after each interaction.

## Most Viable Plan Going Forward

Move from static coordinate automation to state-aware semantic navigation.

1. Keep point pinning only for bootstrap controls.
   - Example: initial TOC opener in collapsed state.
2. After every click, re-capture and re-map before the next click.
   - Build a fresh interaction map from current frame each step.
3. Represent tree targets by identity, not fixed position.
   - Node identity should include normalized label text, inferred depth (indentation), sibling order, and parent chain when available.
4. Add action verification after each click.
   - Confirm expected state delta (for example child rows appeared, node marked expanded, or row count increased) before advancing.
5. Add bounded recovery logic.
   - If verification fails: re-map, retry with nearest matching candidate, then stop with actionable diagnostics.

## Phase 5 Proposed Architecture (Dynamic Tree Mapper)

### Objective

Navigate expanding/collapsing textbook TOC trees where click targets shift after each interaction.

### Core loop per step

1. Capture current frame from live overlay/source tab.
2. OCR and segment candidate rows/buttons in the TOC region.
3. Build a transient tree map with node identities and candidate click boxes.
4. Select the next semantic target (for example "Module 6" -> "Glossary").
5. Execute click in extension runtime.
6. Re-capture and verify expected UI transition.

### Candidate matching layers (in order)

1. Text match layer (exact/fuzzy normalized labels).
2. Structure layer (depth, parent label, sibling order).
3. Icon/shape hints for known controls (TOC opener, expand chevron).
4. Last-known proximity fallback inside current state only (never cross-state reuse).

### Runtime strategy

1. Prefer extension-tab execution for click/verify loop.
2. Persist step traces: screenshot hash, OCR text excerpt, selected target identity, click coords, verification result.
3. Expose trace in Auto flow diagnostics for manual correction.

## Phase 5 Experiment Plan

1. Experiment A: Tree map extraction baseline
   - Input: current TOC frame.
   - Output: candidate rows with labels + depth + click box.
   - Pass criteria: stable extraction on collapsed and expanded examples from live session screenshots.
2. Experiment B: Expand-verify loop
   - Action: click one module, verify child rows appear.
   - Pass criteria: >=95% correct verification across repeated runs on same textbook.
3. Experiment C: Semantic path traversal
   - Action: navigate root -> unit/module -> subsection target by label chain.
   - Pass criteria: reaches requested subsection without manual re-pin.
4. Experiment D: Glossary reachability
   - Action: traverse to last major heading and glossary subsection.
   - Pass criteria: glossary opener target acquired and activated with verification.

## Go/No-Go Criteria For Additional AI Layer

Add a heavier AI decision layer only if deterministic OCR+structure matching fails the pass criteria above. The first implementation should remain deterministic and debuggable to avoid opaque replay failures.

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

Start Phase 5 implementation planning from a docs checkpoint:

1. Define the tree-node identity schema and step verification contract.
2. Implement read-only prototype mapping from captured frames.
3. Validate extraction and expand-verify loop against the current McGraw Hill TOC flow.

## Immediate Manual Validation Script (After Current Build)

1. Open textbook TOC panel in the active shared tab and launch fullscreen pinning.
2. Click `Scan TOC Map`.
3. Verify detected target list updates and includes visible Unit/Module/Subsection labels in top-to-bottom order.
4. Expand one node in the textbook TOC, then scan again.
5. Verify mapping list changes to reflect the new expanded state (additional child nodes and shifted ordering).
6. Confirm core cue pinning workflow remains usable with simplified controls.
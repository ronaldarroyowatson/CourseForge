import { describe, expect, it } from "vitest";

import {
  clearGuidedCue,
  createEmptyGuidedCaptureCuePlan,
  getGuidedCueCompletion,
  getGuidedCueLabel,
  getMissingGuidedCues,
  getMissingGuidedCuesForAutomation,
  isGuidedCuePlanReady,
  isGuidedCuePlanReadyForAutomation,
  markGuidedCue,
} from "../../src/core/services/guidedCaptureCueService";

describe("guidedCaptureCueService", () => {
  it("starts with required cues missing", () => {
    const plan = createEmptyGuidedCaptureCuePlan("example.com");
    expect(getMissingGuidedCues(plan)).toEqual(["openToc", "openGlossary", "nextPage"]);
    expect(isGuidedCuePlanReady(plan)).toBe(false);
  });

  it("becomes ready when required cues are acknowledged", () => {
    let plan = createEmptyGuidedCaptureCuePlan();
    plan = markGuidedCue(plan, "openToc");
    plan = markGuidedCue(plan, "openGlossary");
    plan = markGuidedCue(plan, "nextPage", { xRatio: 0.88, yRatio: 0.55, label: "Next" });

    expect(getMissingGuidedCues(plan)).toEqual([]);
    expect(isGuidedCuePlanReady(plan)).toBe(true);
  });

  it("tracks completion percentage across all cue types", () => {
    let plan = createEmptyGuidedCaptureCuePlan();
    plan = markGuidedCue(plan, "openToc");
    plan = markGuidedCue(plan, "openGlossary");

    const completion = getGuidedCueCompletion(plan);
    expect(completion.total).toBe(5);
    expect(completion.completed).toBe(2);
    expect(completion.percent).toBe(40);
  });

  it("can clear a previously captured cue", () => {
    let plan = createEmptyGuidedCaptureCuePlan();
    plan = markGuidedCue(plan, "openToc");
    plan = clearGuidedCue(plan, "openToc");

    expect(plan.cues.openToc).toBeUndefined();
    expect(getMissingGuidedCues(plan)).toContain("openToc");
  });

  it("provides stable cue labels", () => {
    expect(getGuidedCueLabel("openToc")).toBe("TOC opener");
    expect(getGuidedCueLabel("openGlossary")).toBe("Glossary opener");
    expect(getGuidedCueLabel("nextPage")).toBe("Next page control");
  });

  it("requires coordinates for automation readiness", () => {
    let plan = createEmptyGuidedCaptureCuePlan();
    plan = markGuidedCue(plan, "openToc");
    plan = markGuidedCue(plan, "openGlossary");
    plan = markGuidedCue(plan, "nextPage");

    expect(isGuidedCuePlanReady(plan)).toBe(true);
    expect(isGuidedCuePlanReadyForAutomation(plan)).toBe(false);
    expect(getMissingGuidedCuesForAutomation(plan)).toEqual(["openToc", "openGlossary", "nextPage"]);

    plan = markGuidedCue(plan, "openToc", { xRatio: 0.2, yRatio: 0.3 });
    plan = markGuidedCue(plan, "openGlossary", { xRatio: 0.5, yRatio: 0.4 });
    plan = markGuidedCue(plan, "nextPage", { xRatio: 0.85, yRatio: 0.52 });

    expect(isGuidedCuePlanReadyForAutomation(plan)).toBe(true);
    expect(getMissingGuidedCuesForAutomation(plan)).toEqual([]);
  });
});

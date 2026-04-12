import { describe, expect, it } from "vitest";

import {
  getMotionEasing,
  getChoreographyConfig,
} from "../../src/core/services/motionChoreographyService";

describe("motionChoreographyService — easing per role", () => {
  it("returns ease-in for enter role", () => {
    expect(getMotionEasing("enter")).toBe("ease-in");
  });

  it("returns ease-in-out for move role", () => {
    expect(getMotionEasing("move")).toBe("ease-in-out");
  });

  it("returns ease-out for exit role", () => {
    expect(getMotionEasing("exit")).toBe("ease-out");
  });
});

describe("motionChoreographyService — transition string", () => {
  it("builds correct transition for enter at 300ms", () => {
    const config = getChoreographyConfig("enter", 300, "left-to-right");
    expect(config.transition).toBe("all 300ms ease-in");
    expect(config.easing).toBe("ease-in");
  });

  it("builds correct transition for move at 500ms", () => {
    const config = getChoreographyConfig("move", 500, "left-to-right");
    expect(config.transition).toBe("all 500ms ease-in-out");
    expect(config.easing).toBe("ease-in-out");
  });

  it("builds correct transition for exit at 100ms", () => {
    const config = getChoreographyConfig("exit", 100, "right-to-left");
    expect(config.transition).toBe("all 100ms ease-out");
    expect(config.easing).toBe("ease-out");
  });
});

describe("motionChoreographyService — directional flow transforms", () => {
  it("enter LTR: moves toward the right (positive X)", () => {
    const config = getChoreographyConfig("enter", 300, "left-to-right");
    expect(config.hoverTransform).toContain("translateX(16px)");
  });

  it("enter RTL: moves toward the left (negative X)", () => {
    const config = getChoreographyConfig("enter", 300, "right-to-left");
    expect(config.hoverTransform).toContain("translateX(-16px)");
  });

  it("exit LTR: moves opposite to enter — toward the left (negative X)", () => {
    const config = getChoreographyConfig("exit", 300, "left-to-right");
    expect(config.hoverTransform).toContain("translateX(-16px)");
  });

  it("exit RTL: moves opposite to enter — toward the right (positive X)", () => {
    const config = getChoreographyConfig("exit", 300, "right-to-left");
    expect(config.hoverTransform).toContain("translateX(16px)");
  });

  it("move uses vertical axis regardless of directional flow", () => {
    const ltr = getChoreographyConfig("move", 300, "left-to-right");
    const rtl = getChoreographyConfig("move", 300, "right-to-left");
    expect(ltr.hoverTransform).toBe("translateY(-8px)");
    expect(rtl.hoverTransform).toBe("translateY(-8px)");
    expect(ltr.hoverTransform).toBe(rtl.hoverTransform);
  });

  it("enter and exit have opposite X directions for LTR", () => {
    const enterLtr = getChoreographyConfig("enter", 300, "left-to-right");
    const exitLtr = getChoreographyConfig("exit", 300, "left-to-right");
    expect(enterLtr.hoverTransform).toContain("16px");
    expect(exitLtr.hoverTransform).toContain("-16px");
  });

  it("exit scale is less than 1 (element shrinks when exiting)", () => {
    const config = getChoreographyConfig("exit", 300, "left-to-right");
    expect(config.hoverTransform).toContain("scale(0.95)");
  });

  it("enter scale is greater than 1 (element grows when entering)", () => {
    const config = getChoreographyConfig("enter", 300, "left-to-right");
    expect(config.hoverTransform).toContain("scale(1.05)");
  });
});

describe("motionChoreographyService — timing propagation", () => {
  it("uses provided timingMs in all transition strings", () => {
    for (const timing of [100, 200, 300, 500]) {
      const config = getChoreographyConfig("move", timing, "left-to-right");
      expect(config.transition).toContain(`${timing}ms`);
    }
  });
});

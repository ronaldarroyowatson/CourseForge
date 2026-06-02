import { describe, expect, it } from "vitest";

import { isLikelyCourseForgeSelfCapture } from "../../src/webapp/utils/liveCueCapture";

describe("liveCueCapture", () => {
  it("returns true for obvious CourseForge tab labels", () => {
    expect(isLikelyCourseForgeSelfCapture("CourseForge - localhost:3000/textbooks")).toBe(true);
    expect(isLikelyCourseForgeSelfCapture("localhost:3000 - CourseForge")).toBe(true);
  });

  it("returns false for textbook or external viewer labels", () => {
    expect(isLikelyCourseForgeSelfCapture("Course | PhySci - Physical Science")).toBe(false);
    expect(isLikelyCourseForgeSelfCapture("OpenStax Textbook Viewer")).toBe(false);
  });

  it("handles empty labels safely", () => {
    expect(isLikelyCourseForgeSelfCapture("")).toBe(false);
    expect(isLikelyCourseForgeSelfCapture("   ")).toBe(false);
  });
});

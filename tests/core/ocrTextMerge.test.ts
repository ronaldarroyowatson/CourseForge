import { describe, expect, it } from "vitest";

import { mergeOcrTextWithOverlap } from "../../src/webapp/utils/ocrTextMerge";

describe("mergeOcrTextWithOverlap", () => {
  it("returns incoming text when existing text is empty", () => {
    const result = mergeOcrTextWithOverlap("", "Line A\nLine B\nLine C");
    expect(result).toBe("Line A\nLine B\nLine C");
  });

  it("returns existing text when incoming text is empty", () => {
    const result = mergeOcrTextWithOverlap("Line A\nLine B", "");
    expect(result).toBe("Line A\nLine B");
  });

  it("trims overlapping lines from the incoming shot", () => {
    const existing = [
      "ISBN 978-0-00-000000-0",
      "Copyright 2026",
      "All rights reserved",
      "Printed in USA",
    ].join("\n");

    const incoming = [
      "All rights reserved",
      "Printed in USA",
      "Publisher: Example Press",
      "www.example.com",
    ].join("\n");

    const result = mergeOcrTextWithOverlap(existing, incoming);
    expect(result).toBe([
      "ISBN 978-0-00-000000-0",
      "Copyright 2026",
      "All rights reserved",
      "Printed in USA",
      "Publisher: Example Press",
      "www.example.com",
    ].join("\n"));
  });

  it("handles whitespace and case differences in overlap", () => {
    const existing = "McGraw Hill\nSTEM Learning Solutions Center\nColumbus, OH";
    const incoming = "  stem learning solutions center\ncolumbus, oh\nUnited States";

    const result = mergeOcrTextWithOverlap(existing, incoming);
    expect(result).toBe("McGraw Hill\nSTEM Learning Solutions Center\nColumbus, OH\nUnited States");
  });
});

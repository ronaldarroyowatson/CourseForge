import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyOcrCorrectionLearning,
  recordOcrCorrectionLearning,
} from "../../src/core/services/ocrCorrectionLearningService";

const STORAGE_KEY = "courseforge.ocrCorrectionRules.v1";

describe("ocrCorrectionLearningService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns original text when stored rule payload is corrupted", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not-json");

    expect(applyOcrCorrectionLearning("Line A")).toBe("Line A");
  });

  it("records and applies learned correction for matching context", () => {
    recordOcrCorrectionLearning(
      "Mogrw-Hill Education\nChapter 1",
      "McGraw-Hill Education\nChapter 1",
      { step: "title", publisherHint: "McGraw-Hill Education" }
    );

    const corrected = applyOcrCorrectionLearning(
      "Mogrw-Hill Education\nChapter 1",
      { step: "title", publisherHint: "McGraw-Hill Education" }
    );

    expect(corrected).toContain("McGraw-Hill Education");
  });

  it("does not apply context-specific rules to unrelated context", () => {
    recordOcrCorrectionLearning("Publsher", "Publisher", { step: "cover", publisherHint: "A" });

    const unchanged = applyOcrCorrectionLearning("Publsher", { step: "toc", publisherHint: "B" });
    expect(unchanged).toBe("Publsher");
  });

  it("ignores short or non-alpha corrected lines during learning", () => {
    recordOcrCorrectionLearning(
      "A\n0000\nLong line",
      "B\n1111\nLong fixed line",
      { step: "title", publisherHint: "Publisher" }
    );

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as Array<{ correctedLine: string }>;

    expect(stored).toHaveLength(1);
    expect(stored[0].correctedLine).toBe("Long fixed line");
  });

  it("caps persisted rules to 250 most recent entries", () => {
    for (let index = 0; index < 320; index += 1) {
      recordOcrCorrectionLearning(
        `Noisy line ${index} with text`,
        `Corrected line ${index} with letters`,
        { step: "title", publisherHint: "Publisher" }
      );
    }

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as Array<{ id: string }>;

    expect(stored.length).toBeLessThanOrEqual(250);
    expect(stored.at(-1)?.id).toContain("noisy line");
  });

  it("increments application counters when rules are applied", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    recordOcrCorrectionLearning("Wrng Line", "Wrong Line", { step: "cover" });
    applyOcrCorrectionLearning("Wrng Line", { step: "cover" });

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as Array<{ appliedCount: number; updatedAtMs: number }>;
    expect(stored[0].appliedCount).toBe(1);
    expect(stored[0].updatedAtMs).toBe(1_700_000_000_000);

    nowSpy.mockRestore();
  });
});

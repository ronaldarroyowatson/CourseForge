import { beforeEach, describe, expect, it } from "vitest";

import {
  applyCorrectionRulesToText,
  createEmptyCorrectionRules,
  deriveCorrectionRulesFromRecords,
  readLocalCorrectionRecords,
  saveCorrectionRecord,
  type MetadataResult,
} from "../../src/core/services/metadataCorrectionLearning";

function createMetadataResult(overrides: Partial<MetadataResult> = {}): MetadataResult {
  return {
    title: null,
    subtitle: null,
    edition: null,
    publisher: null,
    series: null,
    gradeLevel: null,
    subject: null,
    confidence: 0.5,
    rawText: "",
    source: "vision",
    ...overrides,
  };
}

describe("metadataCorrectionLearningService", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores correction records and derives local rules", () => {
    saveCorrectionRecord({
      pageType: "cover",
      publisher: "McGraw Hill",
      series: null,
      subject: "Math",
      originalVisionOutput: createMetadataResult({
        title: "Math In Focus",
        publisher: "Mc Graw Hill",
      }),
      originalOcrOutput: {
        rawText: "math in focus",
      },
      finalMetadata: createMetadataResult({
        title: "Math in Focus",
        publisher: "McGraw Hill",
        source: "vision+ocr",
      }),
      imageReference: "hash://cover-1",
    });

    const records = readLocalCorrectionRecords();
    expect(records).toHaveLength(1);

    const rules = deriveCorrectionRulesFromRecords(records);
    expect(rules.globalReplacements.some((entry: { from: string; to: string }) => entry.from === "Mc Graw Hill" && entry.to === "McGraw Hill")).toBe(true);
    expect(Object.keys(rules.publisherSpecific)).toContain("mcgraw hill");
  });

  it("applies global and publisher-specific replacements", () => {
    const rules = createEmptyCorrectionRules("test");
    rules.globalReplacements.push({ from: "Mc Graw Hill", to: "McGraw Hill" });
    rules.publisherSpecific["mcgraw hill"] = {
      replacements: [{ from: "Teacher S Edition", to: "Teacher's Edition" }],
    };

    const corrected = applyCorrectionRulesToText(
      "Mc Graw Hill\nTeacher S Edition",
      rules,
      { publisher: "McGraw Hill" }
    );

    expect(corrected).toContain("McGraw Hill");
    expect(corrected).toContain("Teacher's Edition");
  });
});

import { describe, expect, it } from "vitest";

import {
  detectEquationInputFormat,
  normalizeEquationInput,
} from "../../src/core/services/equationFormatService";

describe("equationFormatService", () => {
  it("converts Word OMML fractions and superscripts to LaTeX", () => {
    const omml = `
<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <m:f>
    <m:num><m:r><m:t>a+b</m:t></m:r></m:num>
    <m:den><m:r><m:t>c</m:t></m:r></m:den>
  </m:f>
</m:oMath>`;

    const result = normalizeEquationInput({ raw: omml });

    expect(result.detectedFormat).toBe("word-omml");
    expect(result.latex).toContain("\\frac{a+b}{c}");
  });

  it("detects likely corruption and offers a context-based repair suggestion", () => {
    const result = normalizeEquationInput({
      raw: "x = ? ? ?",
      context: {
        textbookSubject: "Math",
        conceptName: "quadratic formula",
      },
    });

    expect(result.isLikelyCorrupted).toBe(true);
    expect(result.repairSuggestion?.latex).toContain("x = ");
    expect((result.repairSuggestion?.confidence ?? 0)).toBeGreaterThan(0.5);
  });

  it("avoids false positive corruption flags for normal equations", () => {
    const result = normalizeEquationInput({
      raw: "F = ma",
      context: {
        textbookSubject: "Science",
      },
    });

    expect(result.isLikelyCorrupted).toBe(false);
    expect(result.repairSuggestion).toBeUndefined();
  });

  it("handles plain-text non-equations without forcing repair suggestions", () => {
    const result = normalizeEquationInput({
      raw: "photosynthesis converts light energy",
      format: "plain",
      context: {
        textbookSubject: "Science",
      },
    });

    expect(result.isLikelyCorrupted).toBe(false);
    expect(result.repairSuggestion).toBeUndefined();
    expect(result.latex).toBe("photosynthesis converts light energy");
  });

  it("detects supported input formats", () => {
    expect(detectEquationInputFormat("\\frac{a}{b}")).toBe("latex");
    expect(detectEquationInputFormat("x^2 + y^2 = z^2")).toBe("latex");
    expect(detectEquationInputFormat("<math><mi>x</mi></math>")).toBe("mathml");
    expect(detectEquationInputFormat("<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>")).toBe("word-omml");
  });
});

export type EquationInputFormat = "latex" | "word-linear" | "word-omml" | "mathml" | "plain";

export interface EquationContext {
  textbookSubject?: string;
  textbookTitle?: string;
  conceptName?: string;
  gradeLevel?: string;
}

export interface NormalizedEquationResult {
  detectedFormat: EquationInputFormat;
  latex: string;
  wordLinearPreview: string;
  warnings: string[];
  isLikelyCorrupted: boolean;
  repairSuggestion?: {
    latex: string;
    confidence: number;
    reason: string;
  };
}

const SUBJECT_EQUATION_TEMPLATES: Record<string, string[]> = {
  science: [
    "F = ma",
    "v = d/t",
    "PV = nRT",
    "E = mc^2",
    "Q = mc\\Delta T",
  ],
  math: [
    "y = mx + b",
    "a^2 + b^2 = c^2",
    "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
    "A = \\pi r^2",
    "C = 2\\pi r",
  ],
  physics: [
    "F = ma",
    "W = Fd",
    "P = W/t",
    "v = d/t",
  ],
  chemistry: [
    "PV = nRT",
    "pH = -\\log[H^+]",
    "M = \\frac{n}{V}",
  ],
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

function stripXmlTags(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function sanitizeLatex(value: string): string {
  return value
    .replace(/\u2212/g, "-")
    .replace(/\u00D7/g, "\\times")
    .replace(/\u00F7/g, "\\div")
    .replace(/\s+/g, " ")
    .trim();
}

function convertMathMlToLatex(mathml: string): string {
  let result = mathml;

  result = result.replace(/<msqrt[^>]*>([\s\S]*?)<\/msqrt>/gi, (_match, inner) => {
    return `\\sqrt{${stripXmlTags(inner)}}`;
  });

  result = result.replace(/<mfrac[^>]*>([\s\S]*?)<\/mfrac>/gi, (match) => {
    const segments = [...match.matchAll(/<(?:mi|mn|mo|mrow)[^>]*>([\s\S]*?)<\/(?:mi|mn|mo|mrow)>/gi)]
      .map((entry) => stripXmlTags(entry[1] ?? ""))
      .filter(Boolean);
    if (segments.length >= 2) {
      return `\\frac{${segments[0]}}{${segments[1]}}`;
    }
    return stripXmlTags(match);
  });

  result = result.replace(/<msup[^>]*>([\s\S]*?)<\/msup>/gi, (match) => {
    const segments = [...match.matchAll(/<(?:mi|mn|mo|mrow)[^>]*>([\s\S]*?)<\/(?:mi|mn|mo|mrow)>/gi)]
      .map((entry) => stripXmlTags(entry[1] ?? ""))
      .filter(Boolean);
    if (segments.length >= 2) {
      return `${segments[0]}^{${segments[1]}}`;
    }
    return stripXmlTags(match);
  });

  result = result.replace(/<msub[^>]*>([\s\S]*?)<\/msub>/gi, (match) => {
    const segments = [...match.matchAll(/<(?:mi|mn|mo|mrow)[^>]*>([\s\S]*?)<\/(?:mi|mn|mo|mrow)>/gi)]
      .map((entry) => stripXmlTags(entry[1] ?? ""))
      .filter(Boolean);
    if (segments.length >= 2) {
      return `${segments[0]}_{${segments[1]}}`;
    }
    return stripXmlTags(match);
  });

  result = stripXmlTags(result)
    .replace(/\s*\+\s*/g, " + ")
    .replace(/\s*=\s*/g, " = ");

  return sanitizeLatex(result);
}

function convertOmmlToLatex(omml: string): string {
  let result = omml;

  result = result.replace(/<m:rad[^>]*>[\s\S]*?<m:e>([\s\S]*?)<\/m:e>[\s\S]*?<\/m:rad>/gi, (_match, inner) => {
    return `\\sqrt{${stripXmlTags(inner)}}`;
  });

  result = result.replace(/<m:f[^>]*>[\s\S]*?<m:num>([\s\S]*?)<\/m:num>[\s\S]*?<m:den>([\s\S]*?)<\/m:den>[\s\S]*?<\/m:f>/gi, (_match, numerator, denominator) => {
    return `\\frac{${stripXmlTags(numerator)}}{${stripXmlTags(denominator)}}`;
  });

  result = result.replace(/<m:sSup[^>]*>[\s\S]*?<m:e>([\s\S]*?)<\/m:e>[\s\S]*?<m:sup>([\s\S]*?)<\/m:sup>[\s\S]*?<\/m:sSup>/gi, (_match, base, exponent) => {
    return `${stripXmlTags(base)}^{${stripXmlTags(exponent)}}`;
  });

  result = result.replace(/<m:sSub[^>]*>[\s\S]*?<m:e>([\s\S]*?)<\/m:e>[\s\S]*?<m:sub>([\s\S]*?)<\/m:sub>[\s\S]*?<\/m:sSub>/gi, (_match, base, subscript) => {
    return `${stripXmlTags(base)}_{${stripXmlTags(subscript)}}`;
  });

  result = result.replace(/<m:t[^>]*>([\s\S]*?)<\/m:t>/gi, (_match, text) => stripXmlTags(text));

  return sanitizeLatex(stripXmlTags(result));
}

export function detectEquationInputFormat(input: string): EquationInputFormat {
  const value = input.trim();
  if (!value) {
    return "plain";
  }

  if (/<m:oMath|<m:oMathPara|<m:f|<m:rad|<m:sSup/i.test(value)) {
    return "word-omml";
  }

  if (/<math|<mrow|<mfrac|<msup|<msqrt/i.test(value)) {
    return "mathml";
  }

  if (/\\frac|\\sqrt|\\sum|\\int|\^|_\{?|\\left|\\right|\\cdot|\\times/.test(value)) {
    return "latex";
  }

  if (/^[A-Za-z0-9\s()+\-*/=.,^]+$/.test(value) && /[=^/*]/.test(value)) {
    return "word-linear";
  }

  return "plain";
}

function toLatexFromWordLinear(value: string): string {
  return sanitizeLatex(
    value
      .replace(/sqrt\(([^)]+)\)/gi, "\\sqrt{$1}")
      .replace(/([A-Za-z0-9]+)\/([A-Za-z0-9]+)/g, "\\frac{$1}{$2}")
      .replace(/\*/g, " \\cdot ")
  );
}

function toWordLinearFromLatex(latex: string): string {
  return latex
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\times/g, "x")
    .replace(/\\cdot/g, "*")
    .replace(/\\Delta/g, "Delta")
    .replace(/\\pi/g, "pi")
    .replace(/\s+/g, " ")
    .trim();
}

function looksCorruptedEquation(value: string): boolean {
  if (!value) {
    return false;
  }

  if (/\uFFFD/.test(value)) {
    return true;
  }

  if (/\?{2,}/.test(value)) {
    return true;
  }

  const symbolSlots = (value.match(/[=+\-*/^_{}\\]/g) ?? []).length;
  const questionMarks = (value.match(/\?/g) ?? []).length;
  return questionMarks > 0 && symbolSlots > 0 && questionMarks >= Math.max(1, Math.floor(symbolSlots / 3));
}

function similarityScore(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let overlap = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) {
      overlap += 1;
    }
  });

  return overlap / Math.max(tokensA.size, tokensB.size);
}

function suggestClosestTemplate(inputLatex: string, context?: EquationContext): { latex: string; confidence: number; reason: string } | undefined {
  const subject = context?.textbookSubject?.toLowerCase() ?? "";
  const concept = context?.conceptName?.toLowerCase() ?? "";
  const title = context?.textbookTitle?.toLowerCase() ?? "";

  const subjectKey = Object.keys(SUBJECT_EQUATION_TEMPLATES).find((key) => subject.includes(key)) ?? "";
  const templates = SUBJECT_EQUATION_TEMPLATES[subjectKey] ?? [];
  if (templates.length === 0) {
    return undefined;
  }

  const conceptOverrides: Array<{ token: string; template: string }> = [
    { token: "quadratic", template: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
    { token: "pythagorean", template: "a^2 + b^2 = c^2" },
    { token: "circle", template: "A = \\pi r^2" },
    { token: "force", template: "F = ma" },
  ];

  const conceptOverride = conceptOverrides.find((entry) => concept.includes(entry.token));
  if (conceptOverride) {
    return {
      latex: conceptOverride.template,
      confidence: 0.82,
      reason: `Matched concept hint "${conceptOverride.token}" to a common classroom equation template.`,
    };
  }

  let bestTemplate = "";
  let bestScore = 0;
  templates.forEach((candidate) => {
    const score = similarityScore(inputLatex, candidate) + similarityScore(`${concept} ${title}`, candidate) * 0.35;
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = candidate;
    }
  });

  if (!bestTemplate || bestScore < 0.2) {
    return undefined;
  }

  return {
    latex: bestTemplate,
    confidence: Math.min(0.95, Number((0.55 + bestScore / 2).toFixed(2))),
    reason: `Closest subject-context template match for ${subjectKey || "course context"}.`,
  };
}

export function normalizeEquationInput(input: {
  raw: string;
  format?: EquationInputFormat;
  context?: EquationContext;
}): NormalizedEquationResult {
  const raw = input.raw.trim();
  const detectedFormat = input.format ?? detectEquationInputFormat(raw);
  const warnings: string[] = [];

  let latex = raw;

  switch (detectedFormat) {
    case "word-omml":
      latex = convertOmmlToLatex(raw);
      warnings.push("Converted from Microsoft Word OMML format to LaTeX.");
      break;
    case "mathml":
      latex = convertMathMlToLatex(raw);
      warnings.push("Converted from MathML format to LaTeX.");
      break;
    case "word-linear":
      latex = toLatexFromWordLinear(raw);
      warnings.push("Converted from Word linear equation text to LaTeX.");
      break;
    case "plain":
      latex = sanitizeLatex(raw);
      if (!/[=^_\\]/.test(latex)) {
        warnings.push("Input appears to be plain text; verify symbols before saving.");
      }
      break;
    case "latex":
    default:
      latex = sanitizeLatex(raw);
      break;
  }

  const isLikelyCorrupted = looksCorruptedEquation(raw) || looksCorruptedEquation(latex);
  let repairSuggestion: NormalizedEquationResult["repairSuggestion"];

  if (isLikelyCorrupted) {
    const template = suggestClosestTemplate(latex, input.context);
    if (template) {
      repairSuggestion = template;
      warnings.push("Potential symbol corruption detected. A context-based repair suggestion is available.");
    } else {
      warnings.push("Potential symbol corruption detected. Please verify this equation manually.");
    }
  }

  return {
    detectedFormat,
    latex,
    wordLinearPreview: toWordLinearFromLatex(latex),
    warnings,
    isLikelyCorrupted,
    repairSuggestion,
  };
}

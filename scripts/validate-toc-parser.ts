import fs from "node:fs";
import path from "node:path";

import { parseTocFromOcrText } from "../src/core/services/textbookAutoExtractionService";

interface CheckResult {
  name: string;
  passed: boolean;
  actual?: string | number | boolean;
  expected?: string | number | boolean;
}

function deriveEndFromSibling(currentStart: number | undefined, nextStart: number | undefined): number | undefined {
  if (typeof currentStart === "number" && typeof nextStart === "number" && nextStart > currentStart) {
    return nextStart - 1;
  }

  return undefined;
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }

  return process.argv[index + 1];
}

const ocrFile = getArg("--ocr-file");
if (!ocrFile) {
  console.error("Missing --ocr-file argument.");
  process.exit(1);
}

const resolved = path.resolve(ocrFile);
if (!fs.existsSync(resolved)) {
  console.error(`OCR file not found: ${resolved}`);
  process.exit(1);
}

const text = fs.readFileSync(resolved, "utf8");
const parsed = parseTocFromOcrText(text);

const chapterOne = parsed.chapters[0];
const chapterTwo = parsed.chapters[1];
const chapterThree = parsed.chapters[2];

const checks: CheckResult[] = [
  {
    name: "minimum_module_count",
    passed: parsed.chapters.length >= 3,
    actual: parsed.chapters.length,
    expected: ">=3",
  },
  {
    name: "module_1_title_detected",
    passed: Boolean(chapterOne?.title?.toLowerCase().includes("nature of science")),
  },
  {
    name: "module_2_title_detected",
    passed: Boolean(chapterTwo?.title?.toLowerCase().includes("motion")),
  },
  {
    name: "module_3_title_detected",
    passed: Boolean(chapterThree?.title?.toLowerCase().includes("forces")),
  },
  {
    name: "module_1_start_page",
    passed: chapterOne?.pageStart === 3,
    actual: chapterOne?.pageStart,
    expected: 3,
  },
  {
    name: "module_2_start_page",
    passed: chapterTwo?.pageStart === 37,
    actual: chapterTwo?.pageStart,
    expected: 37,
  },
  {
    name: "module_1_has_methods_lesson",
    passed: Boolean(chapterOne?.sections?.some((section) => section.title.toLowerCase().includes("methods of science"))),
  },
  {
    name: "module_1_has_standards_lesson",
    passed: Boolean(chapterOne?.sections?.some((section) => section.title.toLowerCase().includes("standards of measurement"))),
  },
  {
    name: "module_2_has_acceleration_lesson",
    passed: Boolean(chapterTwo?.sections?.some((section) => section.title.toLowerCase().includes("acceleration"))),
  },
  {
    name: "module_1_range_derived",
    passed: deriveEndFromSibling(chapterOne?.pageStart, chapterTwo?.pageStart) === 36,
    actual: deriveEndFromSibling(chapterOne?.pageStart, chapterTwo?.pageStart),
    expected: 36,
  },
  {
    name: "module_2_range_derived",
    passed: deriveEndFromSibling(chapterTwo?.pageStart, chapterThree?.pageStart) === 58,
    actual: deriveEndFromSibling(chapterTwo?.pageStart, chapterThree?.pageStart),
    expected: 58,
  },
];

const passed = checks.every((check) => check.passed);

const report = {
  passed,
  chapterCount: parsed.chapters.length,
  confidence: parsed.confidence,
  checks,
  parsed,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(passed ? 0 : 1);

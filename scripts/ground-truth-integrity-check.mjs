import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "toc-ground-truth");
const ocrCrossDir = path.join(repoRoot, "tmp-smoke", "ocr-crosscheck");
const outDir = path.join(repoRoot, "tmp-smoke", "ground-truth-integrity");

function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim();
}

function lineHasPageNumber(line) {
  return /\b\d{1,4}\s*$/.test(line);
}

function structural(line) {
  const lower = line.toLowerCase();
  return {
    isModule: /^module\s+\d+/i.test(line),
    isLesson: /^lesson\s+\d+/i.test(line),
    isCer: lower.includes("claim, evidence, reasoning"),
    isWrap: /module\s+wrap-?up/i.test(line),
    isFurther: /(?:^|\s)(?:sep\s+)?go\s+further\b/i.test(line),
    isProject: /stem\s+unit\s+\d+\s+project/i.test(line),
  };
}

function extractModuleNumber(line) {
  const m = line.match(/^module\s+(\d+)/i);
  return m ? Number(m[1]) : undefined;
}

function extractLessonInfo(line) {
  const m = line.match(/^lesson\s+(\d+)/i);
  if (!m) {
    return undefined;
  }
  const n = Number(m[1]);
  const page = line.match(/\b(\d{1,4})\s*$/);
  return {
    lessonNumber: n,
    pageStart: page ? Number(page[1]) : undefined,
  };
}

function scorePotentialOmission(line) {
  const lower = line.toLowerCase();
  let score = 0;
  if (/^module\s+\d+/.test(lower)) score += 3;
  if (/^lesson\s+\d+/.test(lower)) score += 3;
  if (lower.includes("claim, evidence, reasoning")) score += 2;
  if (lower.includes("module wrap")) score += 2;
  if (lower.includes("go further")) score += 2;
  if (lower.includes("stem unit") && lower.includes("project")) score += 2;
  if (/\b\d{2,4}\s*$/.test(lower)) score += 1;
  if (line.length > 120) score -= 2;
  if (/[^a-zA-Z0-9\s'",.:&?!\-()]/.test(line)) score -= 1;
  return score;
}

async function maybeRead(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  const manifest = JSON.parse(
    await fs.readFile(path.join(fixtureDir, "manifest.json"), "utf8")
  );

  const allFindings = [];

  for (const entry of manifest) {
    const textPath = path.join(fixtureDir, entry.text);
    const text = await fs.readFile(textPath, "utf8");
    const lines = text
      .split(/\r?\n/)
      .map(normalizeLine)
      .filter(Boolean);

    const gtLineSet = new Set(lines.map((line) => line.toLowerCase()));

    const findings = [];
    const moduleNumbers = [];
    let currentModule;
    const lessonByModule = new Map();

    for (const line of lines) {
      const s = structural(line);
      if (s.isModule) {
        const moduleNumber = extractModuleNumber(line);
        if (moduleNumber !== undefined) {
          moduleNumbers.push(moduleNumber);
          currentModule = moduleNumber;
          if (!lessonByModule.has(moduleNumber)) {
            lessonByModule.set(moduleNumber, []);
          }
        }

        if (/^module\s+\d+\s*:?\s*$/i.test(line)) {
          findings.push(`Module line missing title: "${line}"`);
        }
      }

      if ((s.isLesson || s.isCer || s.isWrap || s.isFurther || s.isProject) && !lineHasPageNumber(line)) {
        findings.push(`Missing page number on structural line: "${line}"`);
      }

      if (s.isLesson && currentModule !== undefined) {
        const info = extractLessonInfo(line);
        if (info) {
          lessonByModule.get(currentModule).push(info);
        }
      }
    }

    for (const [moduleNumber, lessons] of lessonByModule.entries()) {
      const numbers = lessons.map((l) => l.lessonNumber);
      if (numbers.length > 0) {
        const maxLesson = Math.max(...numbers);
        for (let expected = 1; expected <= maxLesson; expected += 1) {
          if (!numbers.includes(expected)) {
            findings.push(`Module ${moduleNumber} missing Lesson ${expected} line.`);
          }
        }
      }

      const withPages = lessons.filter((l) => typeof l.pageStart === "number");
      for (let i = 1; i < withPages.length; i += 1) {
        const prev = withPages[i - 1];
        const curr = withPages[i];
        if (curr.pageStart < prev.pageStart) {
          findings.push(
            `Module ${moduleNumber} lesson page regression: Lesson ${curr.lessonNumber} (${curr.pageStart}) after Lesson ${prev.lessonNumber} (${prev.pageStart}).`
          );
        } else if (curr.pageStart === prev.pageStart) {
          findings.push(
            `Module ${moduleNumber} duplicate lesson start page: Lesson ${prev.lessonNumber} and Lesson ${curr.lessonNumber} both start at ${curr.pageStart}.`
          );
        }
      }
    }

    // Reverse OCR comparison: candidate structural lines present in OCR but absent in ground truth.
    const ocrNormPath = path.join(
      ocrCrossDir,
      entry.text.replace(/\.txt$/i, ".ocr.norm.txt")
    );
    const ocrNorm = await maybeRead(ocrNormPath);
    const omissionCandidates = [];
    if (ocrNorm) {
      const ocrLines = ocrNorm
        .split(/\r?\n/)
        .map(normalizeLine)
        .filter(Boolean);

      for (const ocrLine of ocrLines) {
        const lower = ocrLine.toLowerCase();
        if (gtLineSet.has(lower)) {
          continue;
        }

        const s = structural(ocrLine);
        const isStructural = s.isModule || s.isLesson || s.isCer || s.isWrap || s.isFurther || s.isProject;
        if (!isStructural) {
          continue;
        }

        const score = scorePotentialOmission(ocrLine);
        if (score >= 4) {
          omissionCandidates.push({ line: ocrLine, score });
        }
      }
    }

    omissionCandidates.sort((a, b) => b.score - a.score || a.line.localeCompare(b.line));

    allFindings.push({
      entry,
      moduleNumbers,
      findings,
      omissionCandidates: omissionCandidates.slice(0, 12),
    });
  }

  let report = "# Ground Truth Integrity Check\n\n";
  report += `Generated: ${new Date().toISOString()}\n\n`;

  let totalIssues = 0;
  for (const item of allFindings) {
    totalIssues += item.findings.length;
  }

  report += `Fixtures scanned: ${allFindings.length}\n`;
  report += `Detected structural issues: ${totalIssues}\n\n`;

  report += "## Summary\n\n";
  report += "| # | Fixture | Modules Found | Structural Issues | OCR Omission Candidates |\n";
  report += "|---|---|---|---:|---:|\n";
  for (const item of allFindings) {
    report += `| ${item.entry.index} | ${item.entry.text} | ${item.moduleNumbers.join(", ") || "(none)"} | ${item.findings.length} | ${item.omissionCandidates.length} |\n`;
  }

  report += "\n## Detailed Findings\n\n";
  for (const item of allFindings) {
    report += `### ${item.entry.index}. ${item.entry.text}\n\n`;

    if (!item.findings.length) {
      report += "Structural issues: none detected.\n\n";
    } else {
      report += "Structural issues:\n";
      for (const finding of item.findings) {
        report += `- ${finding}\n`;
      }
      report += "\n";
    }

    if (!item.omissionCandidates.length) {
      report += "OCR reverse-check candidates: none\n\n";
    } else {
      report += "OCR reverse-check candidates (possible omitted structural lines):\n";
      for (const candidate of item.omissionCandidates) {
        report += `- [score ${candidate.score}] ${candidate.line}\n`;
      }
      report += "\n";
    }
  }

  const reportPath = path.join(outDir, "report.md");
  await fs.writeFile(reportPath, report, "utf8");

  console.log(`Integrity report: ${reportPath}`);
  console.log(`Structural issues: ${totalIssues}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export type QuestionAnswerLayout = "split-pages" | "interleaved" | "inline-bold-answer";
export type ExtractionIssueCode =
  | "empty_document"
  | "unsupported_file_type"
  | "code_like_content"
  | "unsupported_language"
  | "subject_mismatch"
  | "multi_chapter_content"
  | "extraction_unavailable";
export type ExtractionSeverity = "warning" | "error";
export type ExtractionDocumentType = "lesson" | "worksheet" | "assessment" | "reference" | "code" | "unknown";
export type ExtractionLanguage = "english" | "unknown";

const SUPPORTED_TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/html",
  "application/xhtml+xml",
  "text/markdown",
  "text/x-markdown",
  "text/rtf",
  "application/rtf",
]);

const SUPPORTED_FILE_EXTENSIONS = [".txt", ".pdf", ".docx", ".html", ".htm", ".md", ".markdown", ".rtf"];

export interface DocumentExtractionContext {
  textbookTitle?: string;
  textbookSubject?: string;
  gradeLevel?: string;
  chapterTitle?: string;
  sectionTitle?: string;
}

export interface ExtractionIssue {
  code: ExtractionIssueCode;
  severity: ExtractionSeverity;
  message: string;
}

export interface ExtractionQualityReport {
  accepted: boolean;
  documentType: ExtractionDocumentType;
  detectedLanguage: ExtractionLanguage;
  questionAnswerLayouts: QuestionAnswerLayout[];
  issues: ExtractionIssue[];
}

export interface ExtractedDocumentData {
  vocab: string[];
  concepts: string[];
  equations: string[];
  namesAndDates: Array<{ name: string; date?: string }>;
  keyIdeas: string[];
  vocabWithDefinitions?: Array<{ word: string; definition?: string }>;
  conceptsWithExplanations?: Array<{ name: string; explanation?: string }>;
  inferredChapterTitle?: string;
  inferredSectionTitle?: string;
  quality: ExtractionQualityReport;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, value) => String.fromCharCode(Number(value)));
}

export function normalizeTextLikeDocument(rawText: string, mimeType: string, fileName: string): string {
  const lowerName = fileName.toLowerCase();
  const isHtml = mimeType === "text/html" || mimeType === "application/xhtml+xml" || lowerName.endsWith(".html") || lowerName.endsWith(".htm");
  const isMarkdown = mimeType === "text/markdown" || mimeType === "text/x-markdown" || lowerName.endsWith(".md") || lowerName.endsWith(".markdown");
  const isRtf = mimeType === "text/rtf" || mimeType === "application/rtf" || lowerName.endsWith(".rtf");

  if (isHtml) {
    return decodeHtmlEntities(
      rawText
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|section|article|li|h\d|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (isMarkdown) {
    return rawText
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~>#-]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (isRtf) {
    return rawText
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\'[0-9a-fA-F]{2}/g, " ")
      .replace(/\\[a-z]+-?\d* ?/g, " ")
      .replace(/[{}]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return rawText.trim();
}

export async function extractReadableDocumentText(input: {
  fileName: string;
  mimeType: string;
  rawText: string | null;
  base64Data: string | null;
}): Promise<string> {
  const lowerName = input.fileName.toLowerCase();
  const isPdf = input.mimeType === "application/pdf" || lowerName.endsWith(".pdf");
  const isDocx = input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lowerName.endsWith(".docx");

  if (typeof input.rawText === "string") {
    return normalizeTextLikeDocument(input.rawText, input.mimeType, input.fileName);
  }

  if (!input.base64Data) {
    return "";
  }

  const buffer = Buffer.from(input.base64Data, "base64");

  if (isPdf) {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule.default ?? pdfParseModule) as unknown as (pdfBuffer: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(buffer);
    return parsed.text.trim();
  }

  if (isDocx) {
    const mammothModule = await import("mammoth");
    const parsed = await mammothModule.extractRawText({ buffer });
    return parsed.value.trim();
  }

  const fallback = buffer.toString("utf8").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ");
  const fallbackMimeType = SUPPORTED_TEXT_MIME_TYPES.has(input.mimeType) ? input.mimeType : "text/plain";
  return normalizeTextLikeDocument(fallback, fallbackMimeType, input.fileName);
}

const ENGLISH_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "where", "what", "which", "how", "why",
  "is", "are", "was", "were", "be", "to", "of", "in", "on", "by", "an", "a", "as", "at", "it",
]);

const CODE_PATTERNS = [
  /\bfunction\b/gi,
  /\bconst\b/gi,
  /\blet\b/gi,
  /\bimport\s+.+from\b/gi,
  /\bclass\s+[A-Z_]/g,
  /=>/g,
  /<html|<script|<div|<body/gi,
  /#include\s+</g,
  /public\s+static\s+void/g,
  /\bdef\s+\w+\(/g,
];

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  science: ["experiment", "evidence", "hypothesis", "matter", "energy", "force", "earth", "weather", "climate", "rock"],
  "physical science": ["matter", "energy", "force", "motion", "atom", "molecule", "earth", "weather", "erosion", "mineral"],
  "earth science": ["rock", "mineral", "erosion", "weathering", "plate", "tectonic", "climate", "atmosphere", "geology"],
  math: ["equation", "solve", "number", "fraction", "ratio", "graph", "variable", "geometry"],
  history: ["empire", "revolution", "war", "government", "trade", "civilization", "timeline", "century"],
  "social studies": ["government", "economy", "citizen", "culture", "society", "region", "trade"],
  ela: ["theme", "character", "narrative", "passage", "author", "poem", "sentence", "grammar"],
  "foreign language": ["translation", "vocabulary", "verb", "phrase", "pronunciation", "grammar"],
};

const OFF_TOPIC_KEYWORDS = [
  "razor", "shaving", "shave", "blade", "beard", "rusty", "coupon", "checkout", "password", "login", "subscribe",
  "grooming", "skin", "npm", "javascript", "typescript", "debug", "compile",
];

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(Boolean);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function countMatches(words: string[], keywords: string[]): number {
  const wordSet = new Set(words);
  return keywords.reduce((count, keyword) => count + (wordSet.has(keyword.toLowerCase()) ? 1 : 0), 0);
}

function detectLanguage(text: string): ExtractionLanguage {
  const words = tokenize(text);
  if (words.length === 0) {
    return "unknown";
  }

  const englishMatches = words.reduce((count, word) => count + (ENGLISH_STOPWORDS.has(word) ? 1 : 0), 0);
  const asciiLetters = (text.match(/[A-Za-z]/g) ?? []).length;
  const nonAsciiLetters = (text.match(/[^\x00-\x7F]/g) ?? []).length;

  if (englishMatches >= 4 || (asciiLetters > 50 && nonAsciiLetters < asciiLetters * 0.15)) {
    return "english";
  }

  return "unknown";
}

function isCodeLike(text: string): boolean {
  const patternMatches = CODE_PATTERNS.reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0);
  const punctuationHeavyLines = text
    .split(/\r?\n/)
    .filter((line) => /[{}();<>]/.test(line) && line.replace(/[{}();<>\s]/g, "").length > 12).length;

  return patternMatches >= 3 || punctuationHeavyLines >= 3;
}

export function extractQuestionAnswerPairs(text: string): Array<{ question: string; answer: string; layout: QuestionAnswerLayout }> {
  const pairs: Array<{ question: string; answer: string; layout: QuestionAnswerLayout }> = [];

  const splitMatch = text.match(/questions?[:\s\S]*?(?:\n|\r)+answers?(?:\s+key)?[:\s\S]*/i);
  if (splitMatch) {
    const questionSection = text.split(/answers?(?:\s+key)?/i)[0] ?? "";
    const answerSection = text.split(/answers?(?:\s+key)?/i)[1] ?? "";
    const questions = [...questionSection.matchAll(/(?:^|\n)\s*(\d+)[.)]\s+(.+?)(?=\n\s*\d+[.)]|$)/gs)];
    const answers = [...answerSection.matchAll(/(?:^|\n)\s*(\d+)[.)]\s+(.+?)(?=\n\s*\d+[.)]|$)/gs)];
    const answersByNumber = new Map(answers.map((match) => [match[1], match[2].trim()]));

    questions.forEach((match) => {
      const answer = answersByNumber.get(match[1]);
      if (answer) {
        pairs.push({ question: match[2].trim(), answer, layout: "split-pages" });
      }
    });
  }

  [...text.matchAll(/(?:^|\n)\s*(?:\d+[.)]\s+)?(.+?\?)\s*(?:\n|\r\n?)\s*(?:Answer:\s*)?(.+?)(?=\n\s*(?:\d+[.)]\s+.+?\?|$))/gs)].forEach((match) => {
    const question = match[1].trim();
    const answer = match[2].trim();
    if (question && answer && answer.length < 220) {
      pairs.push({ question, answer, layout: "interleaved" });
    }
  });

  [...text.matchAll(/(.+?)(\*\*|__)([^*_\n]{1,120})(\*\*|__)/g)].forEach((match) => {
    const question = match[1].trim();
    const answer = match[3].trim();
    if (question && answer) {
      pairs.push({ question, answer, layout: "inline-bold-answer" });
    }
  });

  return unique(pairs.map((pair) => JSON.stringify(pair))).map((value) => JSON.parse(value) as { question: string; answer: string; layout: QuestionAnswerLayout });
}

export function analyzeDocumentQuality(input: {
  text: string;
  fileName: string;
  mimeType: string;
  context?: DocumentExtractionContext;
}): ExtractionQualityReport {
  const text = input.text.trim();
  const issues: ExtractionIssue[] = [];
  const layouts = unique(extractQuestionAnswerPairs(text).map((pair) => pair.layout));
  const detectedLanguage = detectLanguage(text);
  const fileExtension = input.fileName.toLowerCase();

  if (!text) {
    issues.push({ code: "empty_document", severity: "error", message: "The file did not contain readable text." });
  }

  if (!(
    input.mimeType === "application/pdf" ||
    input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    SUPPORTED_TEXT_MIME_TYPES.has(input.mimeType) ||
    SUPPORTED_FILE_EXTENSIONS.some((extension) => fileExtension.endsWith(extension))
  )) {
    issues.push({ code: "unsupported_file_type", severity: "error", message: "This file type is not supported for document extraction." });
  }

  if (isCodeLike(text)) {
    issues.push({ code: "code_like_content", severity: "error", message: "The uploaded file appears to contain source code rather than textbook content." });
  }

  if (detectedLanguage === "unknown") {
    issues.push({ code: "unsupported_language", severity: "warning", message: "The document language could not be confirmed as readable instructional English. Review before saving." });
  }

  const words = tokenize(text);
  const subject = input.context?.textbookSubject?.trim().toLowerCase() ?? "";
  const subjectKeywords = SUBJECT_KEYWORDS[subject] ?? SUBJECT_KEYWORDS[subject.replace(/\s+/g, " ")] ?? [];
  const subjectHits = countMatches(words, subjectKeywords);
  const offTopicHits = countMatches(words, OFF_TOPIC_KEYWORDS);
  const contextWords = tokenize(`${input.context?.textbookTitle ?? ""} ${input.context?.chapterTitle ?? ""} ${input.context?.sectionTitle ?? ""}`).filter((word) => !ENGLISH_STOPWORDS.has(word));
  const contextHits = countMatches(words, contextWords);

  if ((subjectKeywords.length > 0 && subjectHits === 0 && offTopicHits >= 2) || (contextWords.length > 0 && contextHits === 0 && offTopicHits >= 2)) {
    issues.push({ code: "subject_mismatch", severity: "error", message: "The uploaded content appears unrelated to the selected textbook or chapter context." });
  }

  const chapterHeadings = [...text.matchAll(/(?:^|\n)\s*(?:chapter|unit|lesson)\s+\d+[:.\- ]+(.+?)(?=\n|$)/gi)]
    .map((match) => match[1].trim().toLowerCase())
    .filter(Boolean);
  const distinctHeadings = unique(chapterHeadings);
  const chapterTitle = input.context?.chapterTitle?.trim().toLowerCase();
  const conflictingHeadings = chapterTitle
    ? distinctHeadings.filter((heading) => heading !== chapterTitle && !heading.includes(chapterTitle) && !chapterTitle.includes(heading))
    : distinctHeadings;

  if (conflictingHeadings.length > 1 || (chapterTitle && conflictingHeadings.length > 0)) {
    issues.push({ code: "multi_chapter_content", severity: "warning", message: "The document appears to include content from more than one chapter or lesson." });
  }

  let documentType: ExtractionDocumentType = "unknown";
  if (issues.some((issue) => issue.code === "code_like_content")) {
    documentType = "code";
  } else if (layouts.length > 0) {
    documentType = text.includes("answer key") || text.includes("multiple choice") ? "assessment" : "worksheet";
  } else if (text.includes("chapter") || text.includes("section") || text.includes("lesson")) {
    documentType = "lesson";
  } else if (text.length > 0) {
    documentType = "reference";
  }

  return {
    accepted: !issues.some((issue) => issue.severity === "error"),
    documentType,
    detectedLanguage,
    questionAnswerLayouts: layouts,
    issues,
  };
}

export function createEmptyExtractionData(issue?: ExtractionIssue): ExtractedDocumentData {
  const issues = issue ? [issue] : [];
  return {
    vocab: [],
    concepts: [],
    equations: [],
    namesAndDates: [],
    keyIdeas: [],
    vocabWithDefinitions: [],
    conceptsWithExplanations: [],
    quality: {
      accepted: issues.every((entry) => entry.severity !== "error"),
      documentType: "unknown",
      detectedLanguage: "unknown",
      questionAnswerLayouts: [],
      issues,
    },
  };
}

export function buildExtractionPrompts(input: {
  fileName: string;
  truncatedText: string;
  context?: DocumentExtractionContext;
  quality: ExtractionQualityReport;
}): { systemPrompt: string; userPrompt: string } {
  const contextLines = [
    input.context?.textbookTitle ? `Textbook: ${input.context.textbookTitle}` : null,
    input.context?.textbookSubject ? `Subject: ${input.context.textbookSubject}` : null,
    input.context?.chapterTitle ? `Chapter: ${input.context.chapterTitle}` : null,
    input.context?.sectionTitle ? `Section: ${input.context.sectionTitle}` : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = `You are an expert educational content extractor.
Return ONLY valid JSON matching this exact shape:
{
  "vocab": ["term1", "term2"],
  "vocabWithDefinitions": [{ "word": "term1", "definition": "..." }],
  "concepts": ["concept1"],
  "conceptsWithExplanations": [{ "name": "concept1", "explanation": "..." }],
  "equations": ["LaTeX or plain equation string"],
  "namesAndDates": [{ "name": "...", "date": "..." }],
  "keyIdeas": ["key idea sentence"],
  "inferredChapterTitle": "...",
  "inferredSectionTitle": "...",
  "quality": {
    "documentType": "lesson|worksheet|assessment|reference|code|unknown",
    "detectedLanguage": "english|unknown",
    "issues": [{ "code": "subject_mismatch", "severity": "warning|error", "message": "..." }]
  }
}
Handle common worksheet layouts:
- questions on one page and answers on a later page
- a question with the answer directly below it
- a question where the answer is already filled in inside the question in bold
Also infer likely chapter/section names from headings when possible.
For vocabulary, include definition text whenever it is available in the source.
For concepts, include the essential/focus question and attach explanation text when present.
Notice and report problems such as unreadable or unsupported content, source code instead of curriculum, wrong-subject uploads, and mixed next-chapter content.
If the document looks unsafe or irrelevant, return empty arrays and explain the issue in quality.issues.
Be concise. Omit nothing from the required object.`;

  const userPrompt = [
    `File: ${input.fileName}`,
    contextLines,
    `Heuristic quality snapshot: ${JSON.stringify(input.quality)}`,
    input.truncatedText,
  ].filter(Boolean).join("\n\n");

  return { systemPrompt, userPrompt };
}

export function mergeQualityReports(
  heuristic: ExtractionQualityReport,
  aiQuality: Partial<ExtractionQualityReport> | undefined
): ExtractionQualityReport {
  const aiIssues = Array.isArray(aiQuality?.issues)
    ? aiQuality.issues.filter(
        (issue): issue is ExtractionIssue =>
          !!issue &&
          typeof issue.code === "string" &&
          (issue.severity === "warning" || issue.severity === "error") &&
          typeof issue.message === "string"
      )
    : [];

  const issues = unique(
    [...heuristic.issues, ...aiIssues].map((issue) => `${issue.code}:${issue.severity}:${issue.message}`)
  ).map((value) => {
    const [code, severity, ...messageParts] = value.split(":");
    return {
      code: code as ExtractionIssueCode,
      severity: severity as ExtractionSeverity,
      message: messageParts.join(":"),
    };
  });

  const questionAnswerLayouts = unique([
    ...heuristic.questionAnswerLayouts,
    ...(Array.isArray(aiQuality?.questionAnswerLayouts) ? aiQuality.questionAnswerLayouts.filter((layout): layout is QuestionAnswerLayout => typeof layout === "string") : []),
  ]);

  return {
    accepted: !issues.some((issue) => issue.severity === "error"),
    documentType: aiQuality?.documentType && aiQuality.documentType !== "unknown" ? aiQuality.documentType : heuristic.documentType,
    detectedLanguage: aiQuality?.detectedLanguage && aiQuality.detectedLanguage !== "unknown"
      ? aiQuality.detectedLanguage
      : heuristic.detectedLanguage,
    questionAnswerLayouts,
    issues,
  };
}
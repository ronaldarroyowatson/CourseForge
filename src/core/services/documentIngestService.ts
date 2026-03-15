/**
 * Document Ingestion Service
 *
 * Accepts a PDF, TXT, or DOCX file, extracts its text content
 * in the browser (TXT natively; PDF/DOCX via Cloud Function),
 * then calls the `extractDocumentContent` Cloud Function to run
 * AI-powered extraction and return structured educational data.
 */
import { httpsCallable } from "firebase/functions";

import type { DifficultyLevel, DocumentIngestFingerprint, SourceMetadata } from "../models";
import { getAll, save, STORE_NAMES } from "./db";
import { functionsClient } from "../../firebase/functions";

export type QuestionAnswerLayout = "split-pages" | "interleaved" | "inline-bold-answer";
export type ExtractionIssueCode =
  | "empty_document"
  | "unsupported_file_type"
  | "code_like_content"
  | "unsupported_language"
  | "subject_mismatch"
  | "multi_chapter_content"
  | "extraction_unavailable"
  | "duplicate_file";
export type ExtractionSeverity = "warning" | "error";
export type ExtractionDocumentType = "lesson" | "worksheet" | "assessment" | "reference" | "code" | "unknown";
export type ExtractionLanguage = "english" | "unknown";

export interface DocumentExtractionContext {
  textbookTitle?: string;
  textbookSubject?: string;
  gradeLevel?: string;
  chapterTitle?: string;
  sectionTitle?: string;
  sectionId?: string;
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

/** Structured data returned by the AI extraction step. */
export interface ExtractedDocumentData {
  vocab: string[];
  concepts: string[];
  equations: string[];
  namesAndDates: Array<{ name: string; date?: string }>;
  keyIdeas: string[];
  vocabWithDefinitions?: Array<{ word: string; definition?: string }>;
  conceptsWithExplanations?: Array<{ name: string; explanation?: string }>;
  tieredQuestionBank?: TieredQuestionBank;
  inferredChapterTitle?: string;
  inferredSectionTitle?: string;
  quality: ExtractionQualityReport;
}

export interface TieredQuestionItem {
  id: string;
  baseItemId: string;
  contentType: "vocab" | "concept";
  question: string;
  correctAnswer: string;
  distractors: string[];
  difficultyLevel: DifficultyLevel;
  isOriginal: boolean;
  variationOf: string | null;
  sourceMetadata: SourceMetadata;
}

export interface TieredQuestionBank {
  level1: TieredQuestionItem[];
  level2: TieredQuestionItem[];
  level3: TieredQuestionItem[];
  all: TieredQuestionItem[];
}

export interface TieredQuestionVariationRequestItem {
  id: string;
  contentType: "vocab" | "concept";
  question: string;
  correctAnswer: string;
  sourceMetadata: SourceMetadata;
}

export interface TieredVariationGenerationContext {
  textbookTitle?: string;
  textbookSubject?: string;
  gradeLevel?: number;
  level2TargetReadingGrade?: number;
  level3TargetReadingGrade?: number;
}

interface TieredQuestionVariationResponseItem extends TieredQuestionItem {}

interface TieredQuestionVariationResponse {
  success: boolean;
  message: string;
  data: {
    items: TieredQuestionVariationResponseItem[];
  };
}

interface ExtractionResponse {
  success: boolean;
  message: string;
  data: ExtractedDocumentData;
}

const SUPPORTED_MIME_TYPES = new Set([
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
  "application/xhtml+xml",
  "text/markdown",
  "text/x-markdown",
  "text/rtf",
  "application/rtf",
]);

const SUPPORTED_EXTENSIONS = [".txt", ".pdf", ".docx", ".html", ".htm", ".md", ".markdown", ".rtf"];

export function isSupportedDocumentType(file: File): boolean {
  return (
    SUPPORTED_MIME_TYPES.has(file.type) ||
    SUPPORTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
  );
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dedupeNamesAndDates(values: Array<{ name: string; date?: string }>): Array<{ name: string; date?: string }> {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.name.trim()}::${value.date?.trim() ?? ""}`;
    if (!value.name.trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mergeIssues(
  results: Array<{ fileName: string; data: ExtractedDocumentData }>
): ExtractionQualityReport["issues"] {
  const seen = new Set<string>();
  const issues: ExtractionQualityReport["issues"] = [];

  results.forEach(({ fileName, data }) => {
    data.quality.issues.forEach((issue) => {
      const message = results.length > 1 ? `${fileName}: ${issue.message}` : issue.message;
      const key = `${issue.code}:${issue.severity}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({ ...issue, message });
      }
    });
  });

  return issues;
}

export function mergeExtractedDocuments(
  results: Array<{ fileName: string; data: ExtractedDocumentData }>
): ExtractedDocumentData {
  const issues = mergeIssues(results);
  const layouts = [...new Set(results.flatMap(({ data }) => data.quality.questionAnswerLayouts))];
  const documentTypes = results.map(({ data }) => data.quality.documentType).filter((value) => value !== "unknown");
  const detectedLanguage = results.every(({ data }) => data.quality.detectedLanguage === "english")
    ? "english"
    : "unknown";

  const vocabWithDefinitionsMap = new Map<string, { word: string; definition?: string }>();
  const conceptsWithExplanationsMap = new Map<string, { name: string; explanation?: string }>();

  results.forEach(({ data }) => {
    data.vocabWithDefinitions?.forEach((entry) => {
      const word = entry.word?.trim();
      if (!word) {
        return;
      }

      const key = normalizeForSignature(word);
      const existing = vocabWithDefinitionsMap.get(key);
      if (!existing || (!existing.definition && entry.definition)) {
        vocabWithDefinitionsMap.set(key, {
          word,
          definition: entry.definition?.trim() || undefined,
        });
      }
    });

    data.conceptsWithExplanations?.forEach((entry) => {
      const name = entry.name?.trim();
      if (!name) {
        return;
      }

      const key = normalizeForSignature(name);
      const existing = conceptsWithExplanationsMap.get(key);
      if (!existing || (!existing.explanation && entry.explanation)) {
        conceptsWithExplanationsMap.set(key, {
          name,
          explanation: entry.explanation?.trim() || undefined,
        });
      }
    });
  });

  const inferredSectionTitle = results.find(({ data }) => data.inferredSectionTitle?.trim())?.data.inferredSectionTitle?.trim();
  const inferredChapterTitle = results.find(({ data }) => data.inferredChapterTitle?.trim())?.data.inferredChapterTitle?.trim();

  const fallbackVocabWithDefinitions = dedupeStrings(results.flatMap(({ data }) => data.vocab)).map((word) => ({ word }));
  const fallbackConceptsWithExplanations = dedupeStrings(results.flatMap(({ data }) => data.concepts)).map((name) => ({ name }));

  const mergedVocabWithDefinitions = [...vocabWithDefinitionsMap.values()];
  const mergedConceptsWithExplanations = [...conceptsWithExplanationsMap.values()];

  const vocabList = mergedVocabWithDefinitions.length > 0
    ? mergedVocabWithDefinitions.map((entry) => entry.word)
    : dedupeStrings(results.flatMap(({ data }) => data.vocab));

  const conceptList = mergedConceptsWithExplanations.length > 0
    ? mergedConceptsWithExplanations.map((entry) => entry.name)
    : dedupeStrings(results.flatMap(({ data }) => data.concepts));

  return {
    vocab: vocabList,
    concepts: conceptList,
    equations: dedupeStrings(results.flatMap(({ data }) => data.equations)),
    namesAndDates: dedupeNamesAndDates(results.flatMap(({ data }) => data.namesAndDates)),
    keyIdeas: dedupeStrings(results.flatMap(({ data }) => data.keyIdeas)),
    vocabWithDefinitions: mergedVocabWithDefinitions.length > 0 ? mergedVocabWithDefinitions : fallbackVocabWithDefinitions,
    conceptsWithExplanations: mergedConceptsWithExplanations.length > 0 ? mergedConceptsWithExplanations : fallbackConceptsWithExplanations,
    inferredChapterTitle,
    inferredSectionTitle,
    quality: {
      accepted: !issues.some((issue) => issue.severity === "error"),
      documentType: documentTypes[0] ?? "unknown",
      detectedLanguage,
      questionAnswerLayouts: layouts,
      issues,
    },
  };
}

function inferNumericLocation(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferGradeLevel(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/\d+/);
  if (!match) {
    return undefined;
  }

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(1, Math.min(16, parsed));
}

function buildSourceMetadata(input: {
  fileName: string;
  inferredChapterTitle?: string;
  inferredSectionTitle?: string;
  context?: DocumentExtractionContext;
}): SourceMetadata {
  const gradeLevel = inferGradeLevel(input.context?.gradeLevel);
  const textbookTitle = input.context?.textbookTitle?.trim() || undefined;
  const textbookSubject = input.context?.textbookSubject?.trim() || undefined;
  const educationalContext = (textbookTitle || textbookSubject || gradeLevel)
    ? {
        textbookTitle,
        textbookSubject,
        gradeLevel,
      }
    : undefined;

  return {
    sourceType: "document-ingest",
    originalFilename: input.fileName,
    variationAllowed: true,
    educationalContext,
    inferredLocation: {
      chapter: inferNumericLocation(input.inferredChapterTitle),
      section: inferNumericLocation(input.inferredSectionTitle),
    },
  };
}

function buildLevelOneSeedItems(input: {
  data: ExtractedDocumentData;
  sourceMetadata: SourceMetadata;
}): TieredQuestionVariationRequestItem[] {
  const vocabItems = (input.data.vocabWithDefinitions ?? [])
    .filter((entry) => entry.word.trim().length > 0 && (entry.definition?.trim().length ?? 0) > 0)
    .map((entry) => ({
      id: `vocab:${normalizeForSignature(entry.word)}`,
      contentType: "vocab" as const,
      question: entry.word.trim(),
      correctAnswer: entry.definition!.trim(),
      sourceMetadata: input.sourceMetadata,
    }));

  const conceptItems = (input.data.conceptsWithExplanations ?? [])
    .filter((entry) => entry.name.trim().length > 0 && (entry.explanation?.trim().length ?? 0) > 0)
    .map((entry) => ({
      id: `concept:${normalizeForSignature(entry.name)}`,
      contentType: "concept" as const,
      question: entry.name.trim(),
      correctAnswer: entry.explanation!.trim(),
      sourceMetadata: input.sourceMetadata,
    }));

  return [...vocabItems, ...conceptItems];
}

function pickFallbackDistractors(seed: string[], answer: string): string[] {
  const normalizedAnswer = normalizeForSignature(answer);
  const alternatives = seed
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && normalizeForSignature(value) !== normalizedAnswer)
    .slice(0, 5);

  if (alternatives.length >= 3) {
    return alternatives.slice(0, 3);
  }

  const answerTokens = answer.split(/\s+/).filter(Boolean);
  const baseline = answerTokens.length > 0 ? answerTokens : [answer];
  const padded = [
    `A closely related idea to ${baseline[0]}`,
    `A common confusion with ${baseline[0]}`,
    `A partial description of ${baseline[0]}`,
  ];

  return [...alternatives, ...padded].slice(0, 3);
}

function buildFallbackTieredQuestionBank(
  items: TieredQuestionVariationRequestItem[],
  chapterTerms: string[],
  generationContext?: TieredVariationGenerationContext
): TieredQuestionBank {
  const subjectHint = generationContext?.textbookSubject?.trim();
  const level2Grade = generationContext?.level2TargetReadingGrade;
  const level3Grade = generationContext?.level3TargetReadingGrade;

  const level1 = items.map((item) => ({
    id: `${item.id}:l1`,
    baseItemId: item.id,
    contentType: item.contentType,
    question: item.question,
    correctAnswer: item.correctAnswer,
    distractors: pickFallbackDistractors(chapterTerms, item.correctAnswer),
    difficultyLevel: 1 as DifficultyLevel,
    isOriginal: true,
    variationOf: null,
    sourceMetadata: item.sourceMetadata,
  }));

  const level2 = level1.flatMap((item) => [1, 2].map((idx) => ({
    ...item,
    id: `${item.baseItemId}:l2:${idx}`,
    difficultyLevel: 2 as DifficultyLevel,
    isOriginal: false,
    variationOf: `${item.baseItemId}:l1`,
    question: `Which statement best matches ${item.question}${subjectHint ? ` in ${subjectHint}` : ""}?`,
    correctAnswer: level2Grade
      ? `A clearer explanation of ${item.correctAnswer} written at about grade ${level2Grade} reading level.`
      : `A clearer explanation of ${item.correctAnswer}.`,
  })));

  const level3 = level1.flatMap((item) => [1, 2].map((idx) => ({
    ...item,
    id: `${item.baseItemId}:l3:${idx}`,
    difficultyLevel: 3 as DifficultyLevel,
    isOriginal: false,
    variationOf: `${item.baseItemId}:l1`,
    question: `Which option is NOT an accurate description of ${item.question}${subjectHint ? ` in ${subjectHint}` : ""}?`,
    correctAnswer: level3Grade
      ? `The strongest reasoning-based explanation of ${item.correctAnswer} at about grade ${level3Grade} reading level.`
      : `The strongest reasoning-based explanation of ${item.correctAnswer}.`,
  })));

  return {
    level1,
    level2,
    level3,
    all: [...level1, ...level2, ...level3],
  };
}

function toTieredBank(items: TieredQuestionVariationResponseItem[]): TieredQuestionBank {
  const level1 = items.filter((item) => item.difficultyLevel === 1);
  const level2 = items.filter((item) => item.difficultyLevel === 2);
  const level3 = items.filter((item) => item.difficultyLevel === 3);
  return { level1, level2, level3, all: items };
}

function buildTieredGenerationContext(context?: DocumentExtractionContext): TieredVariationGenerationContext {
  const gradeLevel = inferGradeLevel(context?.gradeLevel);
  return {
    textbookTitle: context?.textbookTitle?.trim() || undefined,
    textbookSubject: context?.textbookSubject?.trim() || undefined,
    gradeLevel,
    level2TargetReadingGrade: gradeLevel ? Math.min(16, gradeLevel + 1) : undefined,
    level3TargetReadingGrade: gradeLevel ? Math.min(16, gradeLevel + 2) : undefined,
  };
}

export async function generateTieredQuestionBankFromSeedItems(input: {
  seedItems: TieredQuestionVariationRequestItem[];
  chapterTerms: string[];
  context?: DocumentExtractionContext;
}): Promise<TieredQuestionBank> {
  if (input.seedItems.length === 0) {
    return { level1: [], level2: [], level3: [], all: [] };
  }

  const generationContext = buildTieredGenerationContext(input.context);
  const fallback = buildFallbackTieredQuestionBank(input.seedItems, input.chapterTerms, generationContext);

  try {
    const callable = httpsCallable<
      { items: TieredQuestionVariationRequestItem[]; chapterTerms: string[]; generationContext?: TieredVariationGenerationContext },
      TieredQuestionVariationResponse
    >(functionsClient, "generateTieredQuestionVariations");

    const response = await callable({
      items: input.seedItems,
      chapterTerms: input.chapterTerms,
      generationContext,
    });

    if (!response.data.success || !Array.isArray(response.data.data?.items)) {
      return fallback;
    }

    const validItems = response.data.data.items.filter((item) =>
      typeof item.id === "string" &&
      (item.difficultyLevel === 1 || item.difficultyLevel === 2 || item.difficultyLevel === 3) &&
      typeof item.question === "string" &&
      typeof item.correctAnswer === "string" &&
      Array.isArray(item.distractors)
    );

    if (validItems.length === 0) {
      return fallback;
    }

    return toTieredBank(validItems);
  } catch {
    return fallback;
  }
}

async function generateTieredQuestionBank(input: {
  data: ExtractedDocumentData;
  fileName: string;
  context?: DocumentExtractionContext;
}): Promise<TieredQuestionBank> {
  const sourceMetadata = buildSourceMetadata({
    fileName: input.fileName,
    inferredChapterTitle: input.data.inferredChapterTitle,
    inferredSectionTitle: input.data.inferredSectionTitle,
    context: input.context,
  });

  const seedItems = buildLevelOneSeedItems({
    data: input.data,
    sourceMetadata,
  });

  if (seedItems.length === 0) {
    return { level1: [], level2: [], level3: [], all: [] };
  }

  const chapterTerms = dedupeStrings([
    ...input.data.vocab,
    ...input.data.concepts,
    ...(input.data.vocabWithDefinitions ?? []).map((entry) => entry.word),
    ...(input.data.conceptsWithExplanations ?? []).map((entry) => entry.name),
  ]);

  return generateTieredQuestionBankFromSeedItems({
    seedItems,
    chapterTerms,
    context: input.context,
  });
}

function createEmptyExtractionData(): ExtractedDocumentData {
  return {
    vocab: [],
    concepts: [],
    equations: [],
    namesAndDates: [],
    keyIdeas: [],
    vocabWithDefinitions: [],
    conceptsWithExplanations: [],
    tieredQuestionBank: {
      level1: [],
      level2: [],
      level3: [],
      all: [],
    },
    quality: {
      accepted: true,
      documentType: "unknown",
      detectedLanguage: "unknown",
      questionAnswerLayouts: [],
      issues: [],
    },
  };
}

function normalizeForSignature(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildExtractedSignature(data: ExtractedDocumentData): string {
  const vocab = dedupeStrings(data.vocab.map(normalizeForSignature));
  const concepts = dedupeStrings(data.concepts.map(normalizeForSignature));
  const equations = dedupeStrings(data.equations.map(normalizeForSignature));
  const keyIdeas = dedupeStrings(data.keyIdeas.map(normalizeForSignature));
  const vocabWithDefinitions = (data.vocabWithDefinitions ?? []).map((entry) => ({
    word: normalizeForSignature(entry.word),
    definition: entry.definition ? normalizeForSignature(entry.definition) : undefined,
  }));
  const conceptsWithExplanations = (data.conceptsWithExplanations ?? []).map((entry) => ({
    name: normalizeForSignature(entry.name),
    explanation: entry.explanation ? normalizeForSignature(entry.explanation) : undefined,
  }));
  const namesAndDates = dedupeNamesAndDates(
    data.namesAndDates.map((value) => ({
      name: normalizeForSignature(value.name),
      date: value.date ? normalizeForSignature(value.date) : undefined,
    }))
  );

  return JSON.stringify({
    vocab,
    concepts,
    equations,
    keyIdeas,
    vocabWithDefinitions,
    conceptsWithExplanations,
    namesAndDates,
  });
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listFingerprintsBySection(sectionId: string): Promise<DocumentIngestFingerprint[]> {
  const rows = await getAll(STORE_NAMES.ingestFingerprints);
  return rows.filter((row) => row.sectionId === sectionId);
}

async function saveIngestFingerprint(input: {
  sectionId: string;
  fileName: string;
  fileHash: string;
  extractedSignature: string;
}): Promise<void> {
  const timestamp = new Date().toISOString();
  const record: DocumentIngestFingerprint = {
    id: `${input.sectionId}:${input.fileHash}`,
    sectionId: input.sectionId,
    fileName: input.fileName,
    fileHash: input.fileHash,
    extractedSignature: input.extractedSignature,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await save(STORE_NAMES.ingestFingerprints, record);
}

/**
 * Read plain-text file content from a File object.
 * Rejects if the file cannot be read as UTF-8 text.
 */
function readTextFile(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("File could not be read as text."));
      }
    };
    reader.onerror = () => reject(new Error("File read error."));
    reader.readAsText(file, "utf-8");
  });
}

/**
 * Read a File as a Base64-encoded string for sending to Cloud Functions.
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data-URL header ("data:<mime>;base64,")
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("File read error."));
    reader.readAsDataURL(file);
  });
}

/**
 * Extract educational content from a document file using AI.
 *
 * - TXT files are read locally, then sent as plain text to the Cloud Function.
 * - PDF and DOCX files are sent as Base64 to the Cloud Function where
 *   text extraction and AI processing both occur server-side.
 *
 * Throws if the file type is unsupported or the Cloud Function returns an error.
 */
export async function extractFromDocument(
  file: File,
  context?: DocumentExtractionContext
): Promise<ExtractedDocumentData> {
  if (!isSupportedDocumentType(file)) {
    throw new Error(
      `Unsupported file type "${file.type || file.name}". Only PDF, TXT, and DOCX are accepted.`
    );
  }

  const callable = httpsCallable<
    { fileName: string; mimeType: string; text?: string; base64?: string; context?: DocumentExtractionContext },
    ExtractionResponse
  >(functionsClient, "extractDocumentContent");

  const isTxt = file.type === "text/plain" || file.name.endsWith(".txt");

  let payload: { fileName: string; mimeType: string; text?: string; base64?: string; context?: DocumentExtractionContext };

  if (isTxt) {
    const text = await readTextFile(file);
    payload = { fileName: file.name, mimeType: file.type || "text/plain", text, context };
  } else {
    const base64 = await readFileAsBase64(file);
    payload = { fileName: file.name, mimeType: file.type, base64, context };
  }

  const result = await callable(payload);

  if (!result.data.success) {
    throw new Error(result.data.message ?? "Document extraction failed.");
  }

  return result.data.data;
}

export async function extractFromDocuments(
  files: File[],
  context?: DocumentExtractionContext
): Promise<ExtractedDocumentData> {
  const selectedFiles = files.filter(Boolean);

  if (selectedFiles.length === 0) {
    throw new Error("Choose at least one file to import.");
  }

  const supportedFiles = selectedFiles.filter(isSupportedDocumentType);
  if (supportedFiles.length === 0) {
    throw new Error("No supported files were found. Use PDF, DOCX, TXT, HTML, Markdown, or RTF.");
  }

  const skippedFiles = selectedFiles.filter((file) => !isSupportedDocumentType(file));
  const duplicateFileNames: string[] = [];
  const extractionRows: Array<{ fileName: string; fileHash: string; data: ExtractedDocumentData }> = [];

  const existingFingerprintByHash = new Map<string, DocumentIngestFingerprint>();
  if (context?.sectionId) {
    const existing = await listFingerprintsBySection(context.sectionId);
    existing.forEach((row) => existingFingerprintByHash.set(row.fileHash, row));
  }

  for (const file of supportedFiles) {
    const fileHash = await computeFileHash(file);
    if (existingFingerprintByHash.has(fileHash)) {
      duplicateFileNames.push(file.name);
      continue;
    }

    const data = await extractFromDocument(file, context);
    extractionRows.push({ fileName: file.name, fileHash, data });
  }

  const merged = extractionRows.length > 0
    ? mergeExtractedDocuments(extractionRows.map((row) => ({ fileName: row.fileName, data: row.data })))
    : createEmptyExtractionData();

  if (skippedFiles.length > 0) {
    merged.quality.issues.push({
      code: "unsupported_file_type",
      severity: extractionRows.length > 0 ? "warning" : "error",
      message: `Skipped unsupported files: ${skippedFiles.map((file) => file.name).join(", ")}.`,
    });
  }

  if (duplicateFileNames.length > 0) {
    merged.quality.issues.push({
      code: "duplicate_file",
      severity: "warning",
      message: `Skipped duplicate files already imported for this section: ${duplicateFileNames.join(", ")}.`,
    });
  }

  if (context?.sectionId && extractionRows.length > 0) {
    await Promise.all(
      extractionRows.map((row) =>
        saveIngestFingerprint({
          sectionId: context.sectionId as string,
          fileName: row.fileName,
          fileHash: row.fileHash,
          extractedSignature: buildExtractedSignature(row.data),
        })
      )
    );
  }

  const sourceFileName = extractionRows.length === 1
    ? extractionRows[0].fileName
    : selectedFiles.length > 1
      ? "multiple-files"
      : selectedFiles[0]?.name ?? "document";

  merged.tieredQuestionBank = await generateTieredQuestionBank({
    data: merged,
    fileName: sourceFileName,
    context,
  });

  merged.quality.accepted = !merged.quality.issues.some((issue) => issue.severity === "error");
  return merged;
}

/**
 * Document Ingestion Service
 *
 * Accepts a PDF, TXT, or DOCX file, extracts its text content
 * in the browser (TXT natively; PDF/DOCX via Cloud Function),
 * then calls the `extractDocumentContent` Cloud Function to run
 * AI-powered extraction and return structured educational data.
 */
import { httpsCallable } from "firebase/functions";

import type { DocumentIngestFingerprint } from "../models";
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
  quality: ExtractionQualityReport;
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

  return {
    vocab: dedupeStrings(results.flatMap(({ data }) => data.vocab)),
    concepts: dedupeStrings(results.flatMap(({ data }) => data.concepts)),
    equations: dedupeStrings(results.flatMap(({ data }) => data.equations)),
    namesAndDates: dedupeNamesAndDates(results.flatMap(({ data }) => data.namesAndDates)),
    keyIdeas: dedupeStrings(results.flatMap(({ data }) => data.keyIdeas)),
    quality: {
      accepted: !issues.some((issue) => issue.severity === "error"),
      documentType: documentTypes[0] ?? "unknown",
      detectedLanguage,
      questionAnswerLayouts: layouts,
      issues,
    },
  };
}

function createEmptyExtractionData(): ExtractedDocumentData {
  return {
    vocab: [],
    concepts: [],
    equations: [],
    namesAndDates: [],
    keyIdeas: [],
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
  const namesAndDates = dedupeNamesAndDates(
    data.namesAndDates.map((value) => ({
      name: normalizeForSignature(value.name),
      date: value.date ? normalizeForSignature(value.date) : undefined,
    }))
  );

  return JSON.stringify({ vocab, concepts, equations, keyIdeas, namesAndDates });
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

  merged.quality.accepted = !merged.quality.issues.some((issue) => issue.severity === "error");
  return merged;
}

import { httpsCallable } from "firebase/functions";
import { doc, setDoc } from "firebase/firestore";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

import type {
  DesignSuggestions,
  ExtractedConceptEntry,
  ExtractedPresentation,
  ExtractedVocabEntry,
  PresentationSlide,
  SlideContentType,
  Textbook,
  Chapter,
  Section,
} from "../models";
import { getCurrentUser } from "../../firebase/auth";
import { firestoreDb } from "../../firebase/firestore";
import { functionsClient } from "../../firebase/functions";
import { saveExtractedPresentation } from "./repositories";

export interface PresentationExtractionContext {
  textbook?: Textbook | null;
  chapter?: Chapter | null;
  section?: Section | null;
}

export interface QuizRebuildOptions {
  kahootStyle: boolean;
  enableTimer: boolean;
  timerSeconds: number;
}

export interface RebuiltQuizItem {
  id: string;
  question: string;
  answer: string;
  choices: string[];
  timerSeconds?: number;
  style: "standard" | "kahoot";
}

interface GenerateDesignSuggestionsResult {
  success: boolean;
  message: string;
  data: DesignSuggestions;
}

interface ConvertPresentationResult {
  success: boolean;
  message: string;
  data: {
    fileName: string;
    mimeType: string;
    base64: string;
  };
}

export type VisualAssetDecision = "keep" | "review" | "discard";

const PRESENTATION_EXTENSIONS = [".ppt", ".pptx"];

export function isSupportedPresentationType(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return PRESENTATION_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read presentation file."));
    reader.readAsDataURL(file);
  });
}

function base64ToPptxFile(base64: string, originalFileName: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  const normalizedName = originalFileName.replace(/\.ppt$/i, ".pptx");
  return new File(
    [bytes],
    normalizedName,
    { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }
  );
}

async function convertLegacyPptToPptx(file: File): Promise<File> {
  const callable = httpsCallable<
    { fileName: string; base64: string },
    ConvertPresentationResult
  >(functionsClient, "convertPresentationFile");

  const base64 = await fileToBase64(file);
  const result = await callable({ fileName: file.name, base64 });

  if (!result.data.success || !result.data.data?.base64) {
    throw new Error(
      result.data.message ||
      "Automatic .ppt conversion is unavailable right now. Please convert this file to .pptx and retry."
    );
  }

  return base64ToPptxFile(result.data.data.base64, result.data.data.fileName || file.name);
}

export function classifySlideVisualAsset(input: {
  assetPath: string;
  slideType: SlideContentType;
  slideText: string[];
  formulas: string[];
}): VisualAssetDecision {
  const asset = input.assetPath.toLowerCase();
  const text = input.slideText.join(" ").toLowerCase();

  const clearDecorative = ["border", "frame", "ornament", "clipart", "background", "logo", "watermark"];
  if (clearDecorative.some((token) => asset.includes(token))) {
    return "discard";
  }

  const clearInstructional = ["diagram", "chart", "graph", "figure", "table", "equation", "formula"];
  if (
    input.slideType === "diagram" ||
    clearInstructional.some((token) => asset.includes(token)) ||
    /diagram|graph|chart|equation|model|process/.test(text) ||
    input.formulas.length > 0
  ) {
    return "keep";
  }

  const ambiguous = ["icon", "symbol", "shape", "illustration", "image"];
  if (ambiguous.some((token) => asset.includes(token))) {
    return "review";
  }

  return "review";
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTextLine(line: string): string {
  return decodeXmlEntities(line.replace(/\s+/g, " ")).trim();
}

function isDecorativeText(line: string): boolean {
  const normalized = line.toLowerCase();
  if (!normalized || normalized.length < 2) {
    return true;
  }

  if (["click to add title", "click to add text", "slide", "copyright"].some((token) => normalized.includes(token))) {
    return true;
  }

  if (/^[^a-z0-9]+$/i.test(normalized)) {
    return true;
  }

  return false;
}

function extractTextFromSlideXml(xml: string): string[] {
  const matches = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)];
  const lines = matches
    .map((match) => normalizeTextLine(match[1] ?? ""))
    .filter((line) => !isDecorativeText(line));

  return [...new Set(lines)];
}

function extractFormulas(lines: string[]): string[] {
  return lines.filter((line) => /\$[^$]+\$|\\frac|\\sum|\\int|=/.test(line));
}

function inferSlideType(lines: string[], index: number, hasImages: boolean): SlideContentType {
  const text = lines.join(" ").toLowerCase();

  if (index === 0) {
    return "title";
  }

  if (/\?|quiz|question|true or false|multiple choice/.test(text)) {
    return "quizQuestion";
  }

  if (/^answer[:\s]|correct answer|because\b/.test(text)) {
    return "quizAnswer";
  }

  if (hasImages && lines.length <= 3) {
    return "diagram";
  }

  if (/vocabulary|term|definition|word bank/.test(text)) {
    return "vocab";
  }

  return "content";
}

function normalizeEntityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanSlideLine(value: string): string {
  return value
    .replace(/^[\u2022\u25E6\-*\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeVocabularyHeading(value: string): boolean {
  return /review\s+vocab|vocabulary|key\s+terms?|word\s+bank|terms\s+to\s+know/i.test(value);
}

function looksLikeTerm(value: string): boolean {
  if (!value || value.length > 70) {
    return false;
  }

  const wordCount = value.split(/\s+/).length;
  if (wordCount > 6) {
    return false;
  }

  return /[a-z]/i.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseTermDefinitionLine(line: string): { word: string; definition: string } | null {
  const cleaned = cleanSlideLine(line);
  const direct = cleaned.match(/^([A-Za-z][A-Za-z0-9 ()'\-/]{1,80})\s*[:\-]\s*(.{4,})$/);
  if (direct) {
    const word = direct[1].trim();
    const definition = direct[2].trim();
    if (looksLikeTerm(word)) {
      return { word, definition };
    }
  }

  const narrative = cleaned.match(/^([A-Za-z][A-Za-z0-9 ()'\-/]{1,80})\s+(?:is|means|refers to|defined as)\s+(.{4,})$/i);
  if (narrative) {
    const word = narrative[1].trim();
    const definition = narrative[2].trim();
    if (looksLikeTerm(word)) {
      return { word, definition };
    }
  }

  return null;
}

function inferHeadingMetadata(
  slides: PresentationSlide[],
  fallbackTitle: string
): { inferredChapterTitle?: string; inferredSectionTitle?: string } {
  const titleSlide = slides.find((slide) => slide.type === "title") ?? slides[0];
  const lines: string[] = titleSlide?.rawText
    ?.map((line: string) => cleanSlideLine(line))
    .filter(isNonEmptyString) ?? [];

  const chapterLine = lines.find((line) => /\bchapter\b|\bunit\b|\blesson\b/i.test(line));
  const sectionLine = lines.find((line) => /\bsection\b|\bfocus\b|\btopic\b|\bessential\b/i.test(line));

  const inferredChapterTitle = chapterLine
    ? chapterLine.replace(/^.*?[:\-]\s*/, "").trim() || chapterLine
    : undefined;

  const inferredSectionTitle = sectionLine
    ? sectionLine.replace(/^.*?[:\-]\s*/, "").trim() || sectionLine
    : lines[0] ?? fallbackTitle;

  return {
    inferredChapterTitle,
    inferredSectionTitle,
  };
}

function extractStructuredSlideContent(
  slides: PresentationSlide[]
): { vocab: ExtractedVocabEntry[]; concepts: ExtractedConceptEntry[] } {
  const vocabByWord = new Map<string, ExtractedVocabEntry>();
  const conceptsByName = new Map<string, ExtractedConceptEntry>();

  const allLines = slides.flatMap((slide) =>
    slide.rawText
      .map((line: string) => cleanSlideLine(line))
      .filter(isNonEmptyString)
  );

  for (const slide of slides) {
    const lines = slide.rawText
      .map((line: string) => cleanSlideLine(line))
      .filter(isNonEmptyString);
    if (lines.length === 0) {
      continue;
    }

    const heading = lines[0];
    const vocabularySlide = slide.type === "vocab" || looksLikeVocabularyHeading(heading);

    if (vocabularySlide) {
      for (const line of lines.slice(1)) {
        const pair = parseTermDefinitionLine(line);
        if (pair) {
          const key = normalizeEntityKey(pair.word);
          const existing = vocabByWord.get(key);
          if (!existing || (!existing.definition && pair.definition)) {
            vocabByWord.set(key, { word: pair.word, definition: pair.definition });
          }
          continue;
        }

        line
          .split(/[;,]/)
          .map((token: string) => cleanSlideLine(token))
          .filter(looksLikeTerm)
          .forEach((term: string) => {
            const key = normalizeEntityKey(term);
            if (!vocabByWord.has(key)) {
              vocabByWord.set(key, { word: term });
            }
          });
      }
    }

    for (const line of lines) {
      const essentialQuestion = line.match(/^(?:essential|focus)\s+question[:\-]?\s*(.+)$/i);
      if (essentialQuestion?.[1]?.trim()) {
        const name = essentialQuestion[1].trim();
        conceptsByName.set(normalizeEntityKey(name), {
          name,
          explanation: "Essential question for this section.",
        });
      }

      if (/steps?\s+in\s+the\s+scientific\s+method/i.test(line)) {
        conceptsByName.set("scientific method", {
          name: "Scientific method",
          explanation: "Process steps students should use for evidence-based investigation.",
        });
      }

      const labeledConcept = line.match(/^([A-Za-z][A-Za-z0-9 ()'\-/]{2,80})\s*[:\-]\s*(.{8,})$/);
      if (labeledConcept) {
        const name = labeledConcept[1].trim();
        const explanation = labeledConcept[2].trim();
        if (/question|method|process|cycle|system|concept/i.test(name)) {
          conceptsByName.set(normalizeEntityKey(name), { name, explanation });
        }
      }
    }
  }

  for (const line of allLines) {
    const pair = parseTermDefinitionLine(line);
    if (!pair) {
      continue;
    }

    const key = normalizeEntityKey(pair.word);
    const existing = vocabByWord.get(key);
    if (!existing || (!existing.definition && pair.definition)) {
      vocabByWord.set(key, { word: pair.word, definition: pair.definition });
    }
  }

  return {
    vocab: [...vocabByWord.values()],
    concepts: [...conceptsByName.values()],
  };
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) {
    return "";
  }
  return file.async("text");
}

function inferTopicFromSlides(title: string, slides: PresentationSlide[]): string {
  const bag = `${title} ${slides.flatMap((slide) => slide.rawText).join(" ")}`.toLowerCase();
  if (/photosynthesis|cell|biology|ecosystem|atom|molecule/.test(bag)) {
    return "science";
  }
  if (/equation|algebra|geometry|fraction|derivative/.test(bag)) {
    return "math";
  }
  if (/civilization|revolution|government|empire/.test(bag)) {
    return "history";
  }
  return "general education";
}

function buildHeuristicDesignSuggestions(topic: string): DesignSuggestions {
  if (topic === "science") {
    return {
      themeName: "Crisp Lab",
      backgroundAssets: [
        "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69",
        "https://images.unsplash.com/photo-1576086213369-97a306d36557",
      ],
      fontChoices: ["Aptos", "Bahnschrift"],
      animationStyle: "fade-in",
      iconSuggestions: {
        experiment: "flask",
        data: "chart-line",
      },
      videoBackgroundSuggestions: ["https://cdn.pixabay.com/video/2020/06/11/41609-429295692_large.mp4"],
    };
  }

  if (topic === "math") {
    return {
      themeName: "Modern Chalkboard",
      backgroundAssets: [
        "https://images.unsplash.com/photo-1509228627152-72ae9ae6848d",
        "https://images.unsplash.com/photo-1596495578065-6e0763fa1178",
      ],
      fontChoices: ["Century Gothic", "Segoe UI"],
      animationStyle: "grow-in",
      iconSuggestions: {
        formula: "square-root-alt",
        graph: "chart-area",
      },
      videoBackgroundSuggestions: ["https://cdn.pixabay.com/video/2022/10/31/137284-765677105_large.mp4"],
    };
  }

  return {
    themeName: "Clear Professional",
    backgroundAssets: [
      "https://images.unsplash.com/photo-1557683316-973673baf926",
      "https://images.unsplash.com/photo-1526498460520-4c246339dccb",
    ],
    fontChoices: ["Calibri", "Trebuchet MS"],
    animationStyle: "fade-in",
    iconSuggestions: {
      vocabulary: "book-open",
      quiz: "lightbulb",
    },
    videoBackgroundSuggestions: ["https://cdn.pixabay.com/video/2021/08/15/85138-587284861_large.mp4"],
  };
}

export async function generateDesignSuggestions(input: {
  presentationTitle: string;
  slides: PresentationSlide[];
}): Promise<DesignSuggestions> {
  const topic = inferTopicFromSlides(input.presentationTitle, input.slides);
  const fallback = buildHeuristicDesignSuggestions(topic);

  try {
    const callable = httpsCallable<
      { presentationTitle: string; topic: string; slideTexts: string[] },
      GenerateDesignSuggestionsResult
    >(functionsClient, "generatePresentationDesignSuggestions");

    const response = await callable({
      presentationTitle: input.presentationTitle,
      topic,
      slideTexts: input.slides.flatMap((slide) => slide.rawText).slice(0, 50),
    });

    if (!response.data.success) {
      return fallback;
    }

    return response.data.data;
  } catch {
    return fallback;
  }
}

export async function extractPresentationFromFile(
  file: File,
  context: PresentationExtractionContext
): Promise<ExtractedPresentation> {
  if (!isSupportedPresentationType(file)) {
    throw new Error("Unsupported file type. Please use .ppt or .pptx.");
  }

  const sourceFile = file.name.toLowerCase().endsWith(".ppt")
    ? await convertLegacyPptToPptx(file)
    : file;

  const buffer = await sourceFile.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((left, right) => {
      const leftNum = Number(left.match(/slide(\d+)\.xml$/)?.[1] ?? "0");
      const rightNum = Number(right.match(/slide(\d+)\.xml$/)?.[1] ?? "0");
      return leftNum - rightNum;
    });

  if (slideFiles.length === 0) {
    throw new Error("Could not read slide content from this file.");
  }

  const slides: PresentationSlide[] = [];

  for (let index = 0; index < slideFiles.length; index += 1) {
    const slidePath = slideFiles[index];
    const xml = await readZipText(zip, slidePath);
    const rawText = extractTextFromSlideXml(xml);

    const relPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relXml = await readZipText(zip, relPath);
    const imageMatches = [...relXml.matchAll(/Target="\.\.\/media\/([^"]+)"/g)];
    const extractedImages = imageMatches.map((match) => `ppt/media/${match[1]}`);

    const notesPath = `ppt/notesSlides/notesSlide${index + 1}.xml`;
    const notesXml = await readZipText(zip, notesPath);
    const notesLines = notesXml ? extractTextFromSlideXml(notesXml) : [];

    const extractedFormulas = extractFormulas(rawText);
    const visualAssessments = extractedImages.map((assetPath) => ({
      assetPath,
      decision: classifySlideVisualAsset({
        assetPath,
        slideType: inferSlideType(rawText, index, extractedImages.length > 0),
        slideText: rawText,
        formulas: extractedFormulas,
      }),
    }));

    const keptVisuals = visualAssessments
      .filter((asset) => asset.decision !== "discard")
      .map((asset) => asset.assetPath);

    const reviewVisuals = visualAssessments
      .filter((asset) => asset.decision === "review")
      .map((asset) => asset.assetPath);

    const reviewNote = reviewVisuals.length > 0
      ? `Review visual relevance: ${reviewVisuals.join(", ")}`
      : "";

    const slideType = inferSlideType(rawText, index, keptVisuals.length > 0);

    slides.push({
      id: crypto.randomUUID(),
      index: index + 1,
      type: slideType,
      rawText,
      extractedFormulas,
      extractedImages: keptVisuals.length > 0 ? keptVisuals : undefined,
      notes: [notesLines.join(" "), reviewNote].filter(Boolean).join(" ") || undefined,
    });
  }

  // Ensure question -> answer pair typing when adjacent slides match the pattern.
  for (let i = 0; i < slides.length - 1; i += 1) {
    if (slides[i].type === "quizQuestion" && slides[i + 1].type !== "quizAnswer") {
      const joined = slides[i + 1].rawText.join(" ").toLowerCase();
      if (/answer|correct|because|option/.test(joined)) {
        slides[i + 1] = { ...slides[i + 1], type: "quizAnswer" };
      }
    }
  }

  const presentationTitle = slides.find((slide) => slide.type === "title")?.rawText[0] ?? sourceFile.name.replace(/\.(ppt|pptx)$/i, "");
  const inferredHeading = inferHeadingMetadata(slides, presentationTitle);
  const structured = extractStructuredSlideContent(slides);
  const designSuggestions = await generateDesignSuggestions({ presentationTitle, slides });

  const timestamp = new Date().toISOString();
  const presentation: ExtractedPresentation = {
    id: crypto.randomUUID(),
    userId: getCurrentUser()?.uid,
    textbookId: context.textbook?.id,
    chapterId: context.chapter?.id,
    sectionId: context.section?.id,
    inferredChapterTitle: inferredHeading.inferredChapterTitle,
    inferredSectionTitle: inferredHeading.inferredSectionTitle,
    presentationTitle,
    fileName: sourceFile.name,
    slides,
    extractedVocab: structured.vocab,
    extractedConcepts: structured.concepts,
    designSuggestions,
    createdAt: timestamp,
    updatedAt: timestamp,
    pendingSync: true,
    source: "local",
  };

  return presentation;
}

export function rebuildQuizSlides(
  slides: PresentationSlide[],
  options: QuizRebuildOptions
): RebuiltQuizItem[] {
  const rebuilt: RebuiltQuizItem[] = [];

  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    if (slide.type !== "quizQuestion") {
      continue;
    }

    const answerSlide = slides[index + 1]?.type === "quizAnswer" ? slides[index + 1] : undefined;
    const question = slide.rawText.join(" ");
    const answer = answerSlide?.rawText.join(" ") || "Teacher will provide answer.";

    const distractors = [
      "Discuss with your partner.",
      "Review slide notes.",
      "Re-check vocabulary terms.",
    ];

    const choices = options.kahootStyle
      ? [answer, ...distractors].sort(() => Math.random() - 0.5)
      : [answer];

    rebuilt.push({
      id: slide.id,
      question,
      answer,
      choices,
      timerSeconds: options.enableTimer ? options.timerSeconds : undefined,
      style: options.kahootStyle ? "kahoot" : "standard",
    });
  }

  return rebuilt;
}

export async function savePresentationToLocalAndFirestore(presentation: ExtractedPresentation): Promise<void> {
  await saveExtractedPresentation({
    ...presentation,
    pendingSync: false,
    source: "cloud",
    updatedAt: new Date().toISOString(),
  });

  if (!presentation.textbookId || !presentation.chapterId || !presentation.sectionId) {
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in to save presentation data.");
  }

  const ref = doc(
    firestoreDb,
    `textbooks/${presentation.textbookId}/chapters/${presentation.chapterId}/sections/${presentation.sectionId}/presentations/${presentation.id}`
  );

  await setDoc(
    ref,
    {
      ...presentation,
      userId: user.uid,
      pendingSync: false,
      source: "cloud",
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function exportRedesignedPresentation(input: {
  presentation: ExtractedPresentation;
  quizItems: RebuiltQuizItem[];
  designSuggestions: DesignSuggestions;
}): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "CourseForge";
  pptx.subject = "Redesigned classroom presentation";
  pptx.title = `${input.presentation.presentationTitle} - Redesigned`;

  const titleFont = input.designSuggestions.fontChoices[0] ?? "Calibri";
  const bodyFont = input.designSuggestions.fontChoices[1] ?? titleFont;

  input.presentation.slides.forEach((slide: PresentationSlide) => {
    const pptSlide = pptx.addSlide();
    const bgAsset = input.designSuggestions.backgroundAssets[slide.index % input.designSuggestions.backgroundAssets.length] ?? "";

    pptSlide.background = { color: "F7FAFC" };
    if (bgAsset) {
      pptSlide.addNotes(`Suggested background asset: ${bgAsset}`);
    }

    const titleText = slide.rawText[0] ?? `Slide ${slide.index}`;
    pptSlide.addText(titleText, {
      x: 0.5,
      y: 0.3,
      w: 12,
      h: 0.7,
      bold: true,
      fontSize: 28,
      fontFace: titleFont,
      color: "113355",
    });

    const bodyText = slide.rawText.slice(1).join("\n") || slide.notes || "";
    pptSlide.addText(bodyText, {
      x: 0.8,
      y: 1.2,
      w: 11.6,
      h: 4.5,
      fontSize: 18,
      fontFace: bodyFont,
      color: "22384F",
      bullet: { indent: 18 },
    });

    if (slide.type === "quizQuestion") {
      const quiz = input.quizItems.find((item) => item.id === slide.id);
      if (quiz) {
        quiz.choices.forEach((choice, idx) => {
          pptSlide.addShape(pptx.ShapeType.roundRect, {
            x: 0.8 + (idx % 2) * 5.8,
            y: 5.9 + Math.floor(idx / 2) * 0.9,
            w: 5.4,
            h: 0.65,
            line: { color: quiz.style === "kahoot" ? "FFFFFF" : "2C5A80", pt: 1 },
            fill: { color: quiz.style === "kahoot" ? ["E63946", "457B9D", "2A9D8F", "F4A261"][idx % 4] : "EAF2FB" },
          });
          pptSlide.addText(choice, {
            x: 1 + (idx % 2) * 5.8,
            y: 6.05 + Math.floor(idx / 2) * 0.9,
            w: 5,
            h: 0.35,
            fontFace: bodyFont,
            fontSize: 14,
            color: quiz.style === "kahoot" ? "FFFFFF" : "15304A",
            bold: true,
          });
        });

        if (quiz.timerSeconds) {
          pptSlide.addText(`Timer: ${quiz.timerSeconds}s`, {
            x: 10.6,
            y: 0.35,
            w: 2,
            h: 0.4,
            fontFace: bodyFont,
            fontSize: 12,
            color: "A23C00",
            bold: true,
          });
        }

        pptSlide.addNotes(`Correct answer (click-to-reveal in class): ${quiz.answer}`);
      }
    }
  });

  await pptx.writeFile({ fileName: `${input.presentation.presentationTitle.replace(/[^a-z0-9]+/gi, "_")}_redesigned.pptx` });
}

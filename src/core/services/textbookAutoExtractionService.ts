export type AutoCaptureStep = "cover" | "title" | "toc";

export interface AutoCaptureLimits {
  maxCoverCaptures: number;
  maxTitleCaptures: number;
  maxTocCaptures: number;
}

export interface AutoCaptureUsage {
  cover: number;
  title: number;
  toc: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutoTextbookMetadata {
  title?: string;
  subtitle?: string;
  edition?: string;
  authors?: string[];
  publisher?: string;
  publisherLocation?: string;
  subject?: string;
  gradeBand?: string;
  isbn?: string;
  additionalIsbns?: string[];
  seriesName?: string;
  copyrightYear?: number;
}

export interface MetadataField<T> {
  value: T;
  confidence: number;
  sourceType: "auto" | "manual";
}

export type AutoMetadataFieldKey = keyof AutoTextbookMetadata;

export type AutoMetadataConfidenceMap = Partial<Record<AutoMetadataFieldKey, MetadataField<unknown>>>;

export interface TocSection {
  sectionNumber: string;
  title: string;
  pageStart?: number;
  pageEnd?: number;
}

export interface TocChapter {
  chapterNumber: string;
  title: string;
  pageStart?: number;
  pageEnd?: number;
  unitName?: string;
  sections: TocSection[];
}

export interface ParsedTocResult {
  chapters: TocChapter[];
  confidence: number;
}

export interface TocPage {
  pageIndex: number;
  chapters: TocChapter[];
  confidence?: number;
}

export interface TocStructure {
  chapters: TocChapter[];
  stitchingConfidence: number;
}

export interface ExtractionLimitsResult {
  allowed: boolean;
  message?: string;
  nextUsage: AutoCaptureUsage;
}

export interface AutoContentSafetyResult {
  allowed: boolean;
  message?: string;
  reason?: "profanity" | "adult" | "non-book";
}

export interface ImageModerationSignal {
  skinToneRatio: number;
  contextText?: string;
}

export interface ImageModerationAssessment {
  decision: "allow" | "review" | "block";
  confidence: number;
  reason: string;
  educationalContextDetected: boolean;
  skinToneRatio: number;
}

export const AUTO_MODE_SCOPE_MESSAGE = "This tool only extracts metadata and table of contents. For vocab or concept extraction, use the dedicated capture tool.";

const METADATA_PRIORITY_TERMS = [
  "edition",
  "teacher",
  "student",
  "publisher",
  "press",
  "copyright",
  "mcgraw",
  "pearson",
  "savvas",
  "houghton",
  "isbn",
  "grade",
  "science",
  "math",
  "history",
  "english",
  "language arts",
];

const DECORATIVE_TEXT_PATTERNS: RegExp[] = [
  /all rights reserved/i,
  /printed in/i,
  /scan(ned|ning)? by/i,
  /watermark/i,
  /www\./i,
  /http(s)?:\/\//i,
  /^page\s+\d+$/i,
  /^\d+\s*$/,
  /^[^a-zA-Z]{3,}$/,
];
const PROFANITY_TERMS = [
  "f***",
  "f**k",
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "motherfucker",
];

const ADULT_TERMS = [
  "porn",
  "pornography",
  "xxx",
  "nude",
  "nudity",
  "sex",
  "sexual",
  "explicit",
  "onlyfans",
  "hentai",
];

const EDUCATIONAL_EXCEPTION_TERMS = [
  "anatomy",
  "grey's anatomy",
  "grays anatomy",
  "medical",
  "medicine",
  "biology",
  "health science",
  "nursing",
  "physiology",
  "surgical",
  "textbook",
];

export const DEFAULT_AUTO_CAPTURE_LIMITS: AutoCaptureLimits = {
  maxCoverCaptures: 1,
  maxTitleCaptures: 2,
  maxTocCaptures: 10,
};

export function createInitialAutoCaptureUsage(): AutoCaptureUsage {
  return { cover: 0, title: 0, toc: 0 };
}

export function enforceAutoCaptureLimit(
  usage: AutoCaptureUsage,
  step: AutoCaptureStep,
  limits: AutoCaptureLimits = DEFAULT_AUTO_CAPTURE_LIMITS
): ExtractionLimitsResult {
  const next = { ...usage };

  if (step === "cover") {
    if (next.cover >= limits.maxCoverCaptures) {
      return {
        allowed: false,
        message: AUTO_MODE_SCOPE_MESSAGE,
        nextUsage: next,
      };
    }
    next.cover += 1;
    return { allowed: true, nextUsage: next };
  }

  if (step === "title") {
    if (next.title >= limits.maxTitleCaptures) {
      return {
        allowed: false,
        message: AUTO_MODE_SCOPE_MESSAGE,
        nextUsage: next,
      };
    }
    next.title += 1;
    return { allowed: true, nextUsage: next };
  }

  if (next.toc >= limits.maxTocCaptures) {
    return {
      allowed: false,
      message: AUTO_MODE_SCOPE_MESSAGE,
      nextUsage: next,
    };
  }

  next.toc += 1;
  return { allowed: true, nextUsage: next };
}

export function detectPageBoundaryFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 28
): CropRect {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return { x: 0, y: 0, width: Math.max(width, 1), height: Math.max(height, 1) };
  }

  const cornerSize = Math.max(3, Math.floor(Math.min(width, height) * 0.04));

  function pixelBrightness(x: number, y: number): number {
    const index = (y * width + x) * 4;
    return (rgba[index] + rgba[index + 1] + rgba[index + 2]) / 3;
  }

  function averageCorner(startX: number, startY: number): number {
    let total = 0;
    let count = 0;
    for (let y = 0; y < cornerSize; y++) {
      for (let x = 0; x < cornerSize; x++) {
        total += pixelBrightness(startX + x, startY + y);
        count += 1;
      }
    }
    return count > 0 ? total / count : 255;
  }

  const background = (
    averageCorner(0, 0) +
    averageCorner(width - cornerSize, 0) +
    averageCorner(0, height - cornerSize) +
    averageCorner(width - cornerSize, height - cornerSize)
  ) / 4;

  function rowHasPage(y: number): boolean {
    let diffCount = 0;
    for (let x = 0; x < width; x++) {
      if (Math.abs(pixelBrightness(x, y) - background) > threshold) {
        diffCount += 1;
      }
    }
    return diffCount / width > 0.08;
  }

  function colHasPage(x: number): boolean {
    let diffCount = 0;
    for (let y = 0; y < height; y++) {
      if (Math.abs(pixelBrightness(x, y) - background) > threshold) {
        diffCount += 1;
      }
    }
    return diffCount / height > 0.08;
  }

  let top = 0;
  while (top < height - 1 && !rowHasPage(top)) {
    top += 1;
  }

  let bottom = height - 1;
  while (bottom > top && !rowHasPage(bottom)) {
    bottom -= 1;
  }

  let left = 0;
  while (left < width - 1 && !colHasPage(left)) {
    left += 1;
  }

  let right = width - 1;
  while (right > left && !colHasPage(right)) {
    right -= 1;
  }

  const minSide = Math.max(24, Math.floor(Math.min(width, height) * 0.2));
  const detectedWidth = right - left + 1;
  const detectedHeight = bottom - top + 1;

  if (detectedWidth < minSide || detectedHeight < minSide) {
    return { x: 0, y: 0, width, height };
  }

  return {
    x: left,
    y: top,
    width: detectedWidth,
    height: detectedHeight,
  };
}

export function extractMetadataFromOcrText(rawText: string): AutoTextbookMetadata {
  const text = preprocessMetadataOcrText(rawText);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  const metadata: AutoTextbookMetadata = {};

  const candidateTitle = lines.find(
    (line) => !/^isbn\b/i.test(line) && !/copyright/i.test(line) && !/edition/i.test(line) && line.length > 4
  );
  if (candidateTitle) {
    metadata.title = toTitleCase(candidateTitle);
  }

  if (lines.length > 1) {
    const subtitleLine = lines.find((line) => line !== candidateTitle && line.length > 8 && !/^by\b/i.test(line));
    if (subtitleLine) {
      metadata.subtitle = subtitleLine;
    }
  }

  const editionMatch = text.match(/(\d{1,2}(?:st|nd|rd|th)\s+edition|edition\s*[:\-]?\s*\d{1,2})/i);
  if (editionMatch) {
    metadata.edition = editionMatch[1];
  }

  const copyrightMatch = text.match(/copyright[^\d]{0,8}((?:19|20)\d{2})/i) || text.match(/\b((?:19|20)\d{2})\b/);
  if (copyrightMatch) {
    metadata.copyrightYear = Number(copyrightMatch[1]);
  }

  const gradeMatch = text.match(/grades?\s*([kK0-9][kK0-9\-\s]*)/i) || text.match(/grade\s*([kK0-9\-\s]+)/i);
  if (gradeMatch) {
    metadata.gradeBand = gradeMatch[1].replace(/\s+/g, " ").trim();
  }

  const byLine = lines.find((line) => /^by\s+/i.test(line));
  if (byLine) {
    metadata.authors = byLine
      .replace(/^by\s+/i, "")
      .split(/,|&| and /i)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const publisherLine = lines.find((line) => /publisher|press|publications?/i.test(line));
  if (publisherLine) {
    metadata.publisher = publisherLine;
  }

  const locationMatch = text.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s+\d{5}/);
  if (locationMatch) {
    metadata.publisherLocation = `${locationMatch[1].trim()}, ${locationMatch[2]}`;
  }

  const seriesMatch = text.match(/series\s*[:\-]?\s*(.+)/i);
  if (seriesMatch) {
    metadata.seriesName = seriesMatch[1].trim();
  }

  const allIsbns = Array.from(new Set((text.match(/(?:97[89][\d\-\s]{10,20}|\b\d{9}[\dXx]\b)/g) ?? [])
    .map((value) => normalizeIsbnLike(value))
    .filter((value) => value.length >= 10)));
  if (allIsbns.length > 0) {
    metadata.isbn = allIsbns[0];
    if (allIsbns.length > 1) {
      metadata.additionalIsbns = allIsbns.slice(1);
    }
  }

  // Subject is intentionally not inferred — left blank for the user to fill in.

  return metadata;
}

export function mergeAutoMetadata(
  base: AutoTextbookMetadata,
  incoming: AutoTextbookMetadata
): AutoTextbookMetadata {
  const merged: AutoTextbookMetadata = {
    ...base,
    ...incoming,
  };

  if (base.authors || incoming.authors) {
    merged.authors = Array.from(new Set([...(base.authors ?? []), ...(incoming.authors ?? [])]));
  }

  if (base.additionalIsbns || incoming.additionalIsbns) {
    merged.additionalIsbns = Array.from(
      new Set([...(base.additionalIsbns ?? []), ...(incoming.additionalIsbns ?? [])])
    );
  }

  return merged;
}

export function parseTocFromOcrText(rawText: string): ParsedTocResult {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chapters: TocChapter[] = [];
  let currentChapter: TocChapter | null = null;
  let activeUnitName: string | undefined;
  let lineHits = 0;

  for (const line of lines) {
    const unitMatch = line.match(/^unit\s+([A-Za-z0-9]+)\s*[:\-]?\s*(.*)$/i);
    if (unitMatch) {
      activeUnitName = ["Unit", unitMatch[1], unitMatch[2]].filter(Boolean).join(" ").trim();
      lineHits += 1;
      continue;
    }

    const chapterMatch = line.match(/^(?:chapter|ch\.?|lesson)\s*([0-9IVXivx]+)\s*[:.\-]?\s*(.+?)(?:\s+(\d+)(?:\s*[-–]\s*(\d+))?)?$/i);
    if (chapterMatch) {
      currentChapter = {
        chapterNumber: chapterMatch[1],
        title: chapterMatch[2].trim(),
        pageStart: chapterMatch[3] ? Number(chapterMatch[3]) : undefined,
        pageEnd: chapterMatch[4] ? Number(chapterMatch[4]) : undefined,
        unitName: activeUnitName,
        sections: [],
      };
      chapters.push(currentChapter);
      lineHits += 1;
      continue;
    }

    const numericChapterMatch = line.match(/^([0-9]{1,2})\s+(.+?)\s+(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (numericChapterMatch && !/^\d+\.\d+/.test(line)) {
      currentChapter = {
        chapterNumber: numericChapterMatch[1],
        title: numericChapterMatch[2].trim(),
        pageStart: Number(numericChapterMatch[3]),
        pageEnd: numericChapterMatch[4] ? Number(numericChapterMatch[4]) : undefined,
        unitName: activeUnitName,
        sections: [],
      };
      chapters.push(currentChapter);
      lineHits += 1;
      continue;
    }

    const sectionMatch = line.match(/^([0-9]+(?:\.[0-9]+)+)\s+(.+?)(?:\s+(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
    if (sectionMatch) {
      if (!currentChapter) {
        currentChapter = {
          chapterNumber: sectionMatch[1].split(".")[0],
          title: `Chapter ${sectionMatch[1].split(".")[0]}`,
          unitName: activeUnitName,
          sections: [],
        };
        chapters.push(currentChapter);
      }

      currentChapter.sections.push({
        sectionNumber: sectionMatch[1],
        title: sectionMatch[2].trim(),
        pageStart: sectionMatch[3] ? Number(sectionMatch[3]) : undefined,
        pageEnd: sectionMatch[4] ? Number(sectionMatch[4]) : undefined,
      });
      lineHits += 1;
    }
  }

  const confidence = lines.length > 0 ? Math.min(1, lineHits / lines.length + (chapters.length > 0 ? 0.2 : 0)) : 0;

  return { chapters, confidence };
}

export function mergeParsedToc(base: ParsedTocResult, incoming: ParsedTocResult): ParsedTocResult {
  const chapterMap = new Map<string, TocChapter>();

  function chapterKey(chapter: TocChapter): string {
    return `${chapter.chapterNumber}|${chapter.title.toLowerCase()}`;
  }

  function sectionKey(section: TocSection): string {
    return `${section.sectionNumber}|${section.title.toLowerCase()}`;
  }

  for (const chapter of base.chapters) {
    chapterMap.set(chapterKey(chapter), {
      ...chapter,
      sections: [...chapter.sections],
    });
  }

  for (const chapter of incoming.chapters) {
    const key = chapterKey(chapter);
    const existing = chapterMap.get(key);
    if (!existing) {
      chapterMap.set(key, {
        ...chapter,
        sections: [...chapter.sections],
      });
      continue;
    }

    const sectionMap = new Map(existing.sections.map((section) => [sectionKey(section), section]));
    for (const section of chapter.sections) {
      sectionMap.set(sectionKey(section), section);
    }

    chapterMap.set(key, {
      ...existing,
      unitName: existing.unitName ?? chapter.unitName,
      pageStart: existing.pageStart ?? chapter.pageStart,
      pageEnd: existing.pageEnd ?? chapter.pageEnd,
      sections: Array.from(sectionMap.values()),
    });
  }

  return {
    chapters: Array.from(chapterMap.values()),
    confidence: Math.max(base.confidence, incoming.confidence),
  };
}

export function stitchTocPages(pages: TocPage[]): TocStructure {
  if (!pages.length) {
    return {
      chapters: [],
      stitchingConfidence: 0,
    };
  }

  const sortedPages = [...pages].sort((left, right) => left.pageIndex - right.pageIndex);
  const chapterOrder: string[] = [];
  const chapterMap = new Map<string, TocChapter>();
  let duplicateHits = 0;
  let conflictHits = 0;
  let totalSections = 0;

  for (const page of sortedPages) {
    for (const chapter of page.chapters) {
      const normalizedChapterNumber = normalizeChapterNumber(chapter.chapterNumber);
      const normalizedChapterTitle = normalizeToken(chapter.title);
      const key = `${normalizedChapterNumber}|${normalizedChapterTitle}`;

      if (!chapterMap.has(key)) {
        chapterOrder.push(key);
        chapterMap.set(key, {
          ...chapter,
          chapterNumber: normalizedChapterNumber,
          sections: chapter.sections.map((section) => ({
            ...section,
            sectionNumber: normalizeSectionNumber(section.sectionNumber),
          })),
        });
        totalSections += chapter.sections.length;
        continue;
      }

      const existing = chapterMap.get(key)!;
      const sectionMap = new Map<string, TocSection>();

      for (const section of existing.sections) {
        sectionMap.set(sectionMergeKey(section), section);
      }

      for (const section of chapter.sections) {
        const normalizedSection: TocSection = {
          ...section,
          sectionNumber: normalizeSectionNumber(section.sectionNumber),
        };
        totalSections += 1;
        const sectionKey = sectionMergeKey(normalizedSection);
        const prior = sectionMap.get(sectionKey);

        if (!prior) {
          sectionMap.set(sectionKey, normalizedSection);
          continue;
        }

        duplicateHits += 1;

        if (
          prior.pageStart !== normalizedSection.pageStart
          || prior.pageEnd !== normalizedSection.pageEnd
        ) {
          conflictHits += 1;
        }

        sectionMap.set(sectionKey, {
          ...prior,
          pageStart: prior.pageStart ?? normalizedSection.pageStart,
          pageEnd: prior.pageEnd ?? normalizedSection.pageEnd,
        });
      }

      chapterMap.set(key, {
        ...existing,
        unitName: existing.unitName ?? chapter.unitName,
        pageStart: existing.pageStart ?? chapter.pageStart,
        pageEnd: existing.pageEnd ?? chapter.pageEnd,
        sections: Array.from(sectionMap.values()),
      });
    }
  }

  const chapters = chapterOrder
    .map((key) => chapterMap.get(key))
    .filter((chapter): chapter is TocChapter => Boolean(chapter))
    .sort((left, right) => {
      const leftNum = Number.parseFloat(left.chapterNumber);
      const rightNum = Number.parseFloat(right.chapterNumber);
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
        return leftNum - rightNum;
      }
      return left.chapterNumber.localeCompare(right.chapterNumber, undefined, { numeric: true, sensitivity: "base" });
    })
    .map((chapter) => ({
      ...chapter,
      sections: [...chapter.sections].sort((left, right) => {
        const leftNum = parseSectionOrder(left.sectionNumber);
        const rightNum = parseSectionOrder(right.sectionNumber);
        if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
          return leftNum - rightNum;
        }
        return left.sectionNumber.localeCompare(right.sectionNumber, undefined, { numeric: true, sensitivity: "base" });
      }),
    }));

  const averagePageConfidence = sortedPages.reduce((sum, page) => sum + clamp01(page.confidence ?? 0.55), 0) / sortedPages.length;
  const duplicatePenalty = totalSections > 0 ? (duplicateHits / totalSections) * 0.2 : 0;
  const conflictPenalty = totalSections > 0 ? (conflictHits / totalSections) * 0.3 : 0;
  const chapterBonus = chapters.length > 0 ? 0.08 : 0;
  const stitchingConfidence = clamp01(averagePageConfidence + chapterBonus - duplicatePenalty - conflictPenalty);

  return {
    chapters,
    stitchingConfidence,
  };
}

export function scoreMetadataConfidence(rawText: string, metadata: AutoTextbookMetadata): AutoMetadataConfidenceMap {
  const normalizedText = rawText.trim();
  const ocrSignalScore = computeOcrSignalScore(normalizedText);
  const fieldMap: AutoMetadataConfidenceMap = {};

  const setField = <K extends AutoMetadataFieldKey>(
    key: K,
    value: AutoTextbookMetadata[K],
    confidence: number
  ): void => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    fieldMap[key] = {
      value,
      confidence: clamp01(confidence),
      sourceType: "auto",
    };
  };

  const editionConfidence = confidenceFromSignals({
    ocrSignalScore,
    classifierScore: /edition/i.test(normalizedText) ? 0.9 : 0.6,
    consistencyScore: metadata.edition ? 0.75 : 0.45,
    ambiguityPenalty: metadata.edition && /revised|special/i.test(metadata.edition) ? 0.08 : 0,
  });

  const isbnConfidence = confidenceFromSignals({
    ocrSignalScore,
    classifierScore: /isbn/i.test(normalizedText) ? 0.95 : 0.45,
    consistencyScore: isValidIsbn(metadata.isbn) ? 0.98 : 0.35,
    ambiguityPenalty: metadata.additionalIsbns && metadata.additionalIsbns.length > 4 ? 0.12 : 0,
  });

  const authorAmbiguityPenalty = metadata.authors && metadata.authors.some((author) => author.length < 3) ? 0.1 : 0;
  const authorConfidence = confidenceFromSignals({
    ocrSignalScore,
    classifierScore: /^by\b/im.test(normalizedText) ? 0.87 : 0.58,
    consistencyScore: metadata.authors && metadata.authors.length > 0 ? 0.83 : 0.4,
    ambiguityPenalty: authorAmbiguityPenalty,
  });

  const subjectConfidence = confidenceFromSignals({
    ocrSignalScore,
    classifierScore: metadata.subject && metadata.subject !== "Other" ? 0.88 : 0.52,
    consistencyScore: hasSubjectSignal(normalizedText, metadata.subject) ? 0.86 : 0.5,
    ambiguityPenalty: metadata.subject === "Other" ? 0.12 : 0,
  });

  const seriesConfidence = confidenceFromSignals({
    ocrSignalScore,
    classifierScore: /series/i.test(normalizedText) ? 0.86 : 0.48,
    consistencyScore: metadata.seriesName ? 0.78 : 0.4,
    ambiguityPenalty: metadata.seriesName && metadata.seriesName.toLowerCase().includes("unknown") ? 0.12 : 0,
  });

  setField("title", metadata.title, confidenceFromSignals({
    ocrSignalScore,
    classifierScore: metadata.title && metadata.title.length > 4 ? 0.9 : 0.45,
    consistencyScore: metadata.title && !/^chapter\s+\d+/i.test(metadata.title) ? 0.85 : 0.5,
    ambiguityPenalty: metadata.title && metadata.title.length < 5 ? 0.12 : 0,
  }));
  setField("subtitle", metadata.subtitle, confidenceFromSignals({
    ocrSignalScore,
    classifierScore: metadata.subtitle ? 0.8 : 0.4,
    consistencyScore: metadata.subtitle && metadata.subtitle.length >= 8 ? 0.75 : 0.5,
    ambiguityPenalty: metadata.subtitle && metadata.subtitle.length < 8 ? 0.1 : 0,
  }));
  setField("edition", metadata.edition, editionConfidence);
  setField("authors", metadata.authors, authorConfidence);
  setField("publisher", metadata.publisher, confidenceFromSignals({
    ocrSignalScore,
    classifierScore: /publisher|press|publications?/i.test(normalizedText) ? 0.84 : 0.5,
    consistencyScore: metadata.publisher ? 0.8 : 0.5,
    ambiguityPenalty: 0,
  }));
  setField("subject", metadata.subject, subjectConfidence);
  setField("gradeBand", metadata.gradeBand, confidenceFromSignals({
    ocrSignalScore,
    classifierScore: /grade/i.test(normalizedText) ? 0.86 : 0.45,
    consistencyScore: metadata.gradeBand ? 0.8 : 0.5,
    ambiguityPenalty: metadata.gradeBand && metadata.gradeBand.length < 2 ? 0.08 : 0,
  }));
  setField("isbn", metadata.isbn, isbnConfidence);
  setField("seriesName", metadata.seriesName, seriesConfidence);
  setField("copyrightYear", metadata.copyrightYear, confidenceFromSignals({
    ocrSignalScore,
    classifierScore: /copyright/i.test(normalizedText) ? 0.9 : 0.58,
    consistencyScore: metadata.copyrightYear && metadata.copyrightYear >= 1900 && metadata.copyrightYear <= 2100 ? 0.88 : 0.4,
    ambiguityPenalty: metadata.copyrightYear && metadata.copyrightYear < 1900 ? 0.2 : 0,
  }));
  setField("publisherLocation", metadata.publisherLocation, confidenceFromSignals({
    ocrSignalScore,
    classifierScore: /,\s*[A-Z]{2}\b/.test(normalizedText) ? 0.78 : 0.48,
    consistencyScore: metadata.publisherLocation ? 0.75 : 0.5,
    ambiguityPenalty: 0,
  }));
  setField("additionalIsbns", metadata.additionalIsbns, confidenceFromSignals({
    ocrSignalScore,
    classifierScore: metadata.additionalIsbns && metadata.additionalIsbns.length > 0 ? 0.82 : 0.45,
    consistencyScore: metadata.additionalIsbns?.every((value) => isValidIsbn(value)) ? 0.86 : 0.42,
    ambiguityPenalty: metadata.additionalIsbns && metadata.additionalIsbns.some((value) => !isValidIsbn(value)) ? 0.15 : 0,
  }));

  return fieldMap;
}

export function isLikelyTocText(rawText: string): boolean {
  const text = rawText.toLowerCase();
  return (
    text.includes("table of contents") ||
    /chapter\s+\d+/i.test(rawText) ||
    /\d+\.\d+\s+[A-Za-z]/.test(rawText)
  );
}

export function evaluateAutoCaptureSafety(rawText: string, step: AutoCaptureStep): AutoContentSafetyResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { allowed: true };
  }

  const lowered = normalizeContent(trimmed);

  if (containsAny(lowered, PROFANITY_TERMS)) {
    return {
      allowed: false,
      reason: "profanity",
      message: "Capture blocked: detected inappropriate language. This Auto tool only accepts textbook metadata and table of contents captures.",
    };
  }

  if (containsAny(lowered, ADULT_TERMS)) {
    return {
      allowed: false,
      reason: "adult",
      message: "Capture blocked: detected adult or explicit content. This Auto tool only accepts textbook metadata and table of contents captures.",
    };
  }

  if (step === "toc" && !isLikelyTocText(trimmed)) {
    return {
      allowed: false,
      reason: "non-book",
      message: AUTO_MODE_SCOPE_MESSAGE,
    };
  }

  if ((step === "cover" || step === "title") && !isLikelyBookPageText(trimmed)) {
    return {
      allowed: false,
      reason: "non-book",
      message: "Capture blocked: this does not look like a textbook cover or title page. Please capture a textbook page.",
    };
  }

  return { allowed: true };
}

export function assessImageModerationSignal(signal: ImageModerationSignal): ImageModerationAssessment {
  const normalizedContext = normalizeContent(signal.contextText ?? "");
  const educationalContextDetected = containsAny(normalizedContext, EDUCATIONAL_EXCEPTION_TERMS);
  const ratio = Math.max(0, Math.min(1, signal.skinToneRatio));

  if (ratio >= 0.72) {
    if (educationalContextDetected) {
      return {
        decision: "review",
        confidence: 0.9,
        reason: "High explicit-image signal with educational context. Requires admin approval.",
        educationalContextDetected,
        skinToneRatio: ratio,
      };
    }

    return {
      decision: "block",
      confidence: 0.95,
      reason: "High explicit-image signal detected without educational context.",
      educationalContextDetected,
      skinToneRatio: ratio,
    };
  }

  if (ratio >= 0.52) {
    return {
      decision: "review",
      confidence: educationalContextDetected ? 0.82 : 0.72,
      reason: educationalContextDetected
        ? "Potentially graphic educational imagery. Requires admin approval."
        : "Potential explicit-image signal. Requires admin approval.",
      educationalContextDetected,
      skinToneRatio: ratio,
    };
  }

  return {
    decision: "allow",
    confidence: 0.9,
    reason: "Image-level screening passed.",
    educationalContextDetected,
    skinToneRatio: ratio,
  };
}

function isLikelyBookPageText(rawText: string): boolean {
  const lowered = rawText.toLowerCase();
  const bookSignals = [
    /isbn/, /edition/, /publisher/, /press/, /copyright/, /author/, /chapter/, /unit/,
    /table of contents/, /student edition/, /teacher edition/, /grade/, /volume/
  ];

  const signalCount = bookSignals.reduce((count, pattern) => count + (pattern.test(lowered) ? 1 : 0), 0);
  if (signalCount > 0) {
    return true;
  }

  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return false;
  }

  const alphaWords = lowered.match(/[a-z]{3,}/g) ?? [];
  return alphaWords.length >= 8;
}

function normalizeContent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[@$!]/g, "")
    .replace(/[^a-z0-9\s\*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(content: string, terms: string[]): boolean {
  return terms.some((term) => content.includes(term));
}

function inferSubject(text: string): string | undefined {
  const source = text.toLowerCase();
  if (/algebra|geometry|mathematics|math/.test(source)) return "Math";
  if (/physical science|earth science|biology|chemistry|physics|science/.test(source)) return "Science";
  if (/history|social studies|government|civics/.test(source)) return "Social Studies";
  if (/language arts|literature|grammar|reading/.test(source)) return "ELA";
  if (/computer science|coding|programming/.test(source)) return "Computer Science";
  return undefined;
}

function normalizeIsbnLike(value: string): string {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sectionMergeKey(section: TocSection): string {
  return `${normalizeSectionNumber(section.sectionNumber)}|${normalizeToken(section.title)}`;
}

function normalizeChapterNumber(chapterNumber: string): string {
  const trimmed = chapterNumber.trim();
  const asInt = Number.parseInt(trimmed, 10);
  if (Number.isInteger(asInt)) {
    return String(asInt);
  }
  return trimmed.toUpperCase();
}

function normalizeSectionNumber(sectionNumber: string): string {
  const parts = sectionNumber
    .trim()
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return sectionNumber.trim();
  }

  return parts
    .map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isInteger(parsed) ? String(parsed) : part;
    })
    .join(".");
}

function parseSectionOrder(sectionNumber: string): number {
  const parts = normalizeSectionNumber(sectionNumber)
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  if (!parts.every((part) => Number.isFinite(part))) {
    return Number.NaN;
  }

  return parts.reduce((acc, value, index) => acc + value / Math.pow(100, index), 0);
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function computeOcrSignalScore(rawText: string): number {
  if (!rawText.trim()) {
    return 0.2;
  }

  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const words = rawText.match(/[A-Za-z]{2,}/g) ?? [];
  const numericTokens = rawText.match(/\b\d+\b/g) ?? [];

  const lineScore = Math.min(1, lines.length / 10);
  const wordScore = Math.min(1, words.length / 40);
  const numericScore = Math.min(1, numericTokens.length / 18);

  return clamp01((lineScore * 0.35) + (wordScore * 0.45) + (numericScore * 0.2));
}

function confidenceFromSignals(input: {
  ocrSignalScore: number;
  classifierScore: number;
  consistencyScore: number;
  ambiguityPenalty: number;
}): number {
  const weighted = (input.ocrSignalScore * 0.3) + (input.classifierScore * 0.35) + (input.consistencyScore * 0.35);
  return clamp01(weighted - input.ambiguityPenalty);
}

function hasSubjectSignal(rawText: string, subject?: string): boolean {
  if (!subject) {
    return false;
  }

  const normalized = subject.toLowerCase();
  if (normalized === "math") {
    return /algebra|geometry|math|mathematics|calculus/.test(rawText.toLowerCase());
  }
  if (normalized === "science") {
    return /science|biology|chemistry|physics|earth/.test(rawText.toLowerCase());
  }
  if (normalized === "social studies") {
    return /history|social studies|government|civics/.test(rawText.toLowerCase());
  }
  if (normalized === "ela") {
    return /language arts|literature|reading|grammar|english/.test(rawText.toLowerCase());
  }
  if (normalized === "computer science") {
    return /computer science|coding|programming/.test(rawText.toLowerCase());
  }
  return true;
}

function isValidIsbn(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  if (normalized.length === 10) {
    let total = 0;
    for (let index = 0; index < 9; index += 1) {
      const digit = Number.parseInt(normalized[index], 10);
      if (!Number.isFinite(digit)) {
        return false;
      }
      total += (10 - index) * digit;
    }

    const checksum = normalized[9] === "X" ? 10 : Number.parseInt(normalized[9], 10);
    if (!Number.isFinite(checksum)) {
      return false;
    }

    return ((total + checksum) % 11) === 0;
  }

  if (normalized.length === 13) {
    let total = 0;
    for (let index = 0; index < 12; index += 1) {
      const digit = Number.parseInt(normalized[index], 10);
      if (!Number.isFinite(digit)) {
        return false;
      }
      total += digit * (index % 2 === 0 ? 1 : 3);
    }

    const checkDigit = (10 - (total % 10)) % 10;
    const lastDigit = Number.parseInt(normalized[12], 10);
    return Number.isFinite(lastDigit) && checkDigit === lastDigit;
  }

  return false;
}

function hasAlphabeticSignal(value: string): boolean {
  const alphaChars = (value.match(/[A-Za-z]/g) ?? []).length;
  if (alphaChars < 3) {
    return false;
  }

  const ratio = alphaChars / Math.max(1, value.length);
  return ratio >= 0.45;
}

function normalizeDecorativeNoise(value: string): string {
  const withoutControl = value
    .replace(/[\u0000-\u001F]+/g, " ")
    .replace(/[|_~`^*#@]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutControl) {
    return "";
  }

  // Remove obvious OCR garbage sequences like "IlI1l1" runs.
  return withoutControl.replace(/\b[Il1]{4,}\b/g, "").replace(/\s+/g, " ").trim();
}

function collapseRepeatedWords(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return value;
  }

  const compact: string[] = [];
  for (const word of words) {
    const prior = compact[compact.length - 1];
    if (prior && prior.localeCompare(word, undefined, { sensitivity: "accent" }) === 0) {
      continue;
    }
    compact.push(word);
  }

  return compact.join(" ");
}

function shouldKeepMetadataLine(value: string, index: number): boolean {
  if (!value) {
    return false;
  }

  // Preserve structured identifier lines even when alphabetic density is low.
  if (/\bisbn\b/i.test(value)) {
    return true;
  }

  if (DECORATIVE_TEXT_PATTERNS.some((pattern) => pattern.test(value))) {
    return false;
  }

  if (!hasAlphabeticSignal(value)) {
    return false;
  }

  if (value.length >= 6 && value.length <= 120) {
    return true;
  }

  // Keep early lines because title/subtitle are commonly near the top.
  return index <= 3;
}

function metadataPriorityScore(value: string): number {
  const normalized = value.toLowerCase();
  let score = 0;

  for (const term of METADATA_PRIORITY_TERMS) {
    if (normalized.includes(term)) {
      score += 2;
    }
  }

  if (/\b(teacher|student)('?s)?\s+edition\b/i.test(value)) {
    score += 4;
  }
  if (/\b(19|20)\d{2}\b/.test(value)) {
    score += 1;
  }
  if (/\bisbn\b/i.test(value)) {
    score += 2;
  }

  return score;
}

export function preprocessMetadataOcrText(rawText: string): string {
  const normalizedText = rawText.replace(/\r/g, "\n").trim();
  if (!normalizedText) {
    return "";
  }

  const lines = normalizedText
    .split("\n")
    .map((line) => normalizeDecorativeNoise(line))
    .map((line) => collapseRepeatedWords(line))
    .filter(Boolean);

  const filtered = lines
    .map((line, index) => ({
      line,
      index,
      keep: shouldKeepMetadataLine(line, index),
      score: metadataPriorityScore(line),
    }))
    .filter((entry) => entry.keep)
    .sort((a, b) => {
      if (b.score === a.score) {
        return a.index - b.index;
      }
      return b.score - a.score;
    })
    .slice(0, 20)
    .sort((a, b) => a.index - b.index)
    .map((entry) => {
      const mostlyUppercase = entry.line === entry.line.toUpperCase() && /[A-Z]/.test(entry.line);
      return mostlyUppercase ? toTitleCase(entry.line) : entry.line;
    });

  return filtered.join("\n").trim();
}

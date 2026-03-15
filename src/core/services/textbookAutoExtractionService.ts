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

export const DEFAULT_AUTO_CAPTURE_LIMITS: AutoCaptureLimits = {
  maxCoverCaptures: 1,
  maxTitleCaptures: 2,
  maxTocCaptures: 8,
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
        message: "This Auto tool is only for metadata and table of contents, not full content capture.",
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
        message: "This Auto tool is only for metadata and table of contents, not full content capture.",
        nextUsage: next,
      };
    }
    next.title += 1;
    return { allowed: true, nextUsage: next };
  }

  if (next.toc >= limits.maxTocCaptures) {
    return {
      allowed: false,
      message: "This Auto tool is only for metadata and table of contents, not full content capture.",
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
  const text = rawText.replace(/\r/g, "").trim();
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

  metadata.subject = inferSubject(text);

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
      message: "This Auto tool is only for metadata and table of contents, not full content capture.",
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

function inferSubject(text: string): string {
  const source = text.toLowerCase();
  if (/algebra|geometry|mathematics|math/.test(source)) return "Math";
  if (/biology|chemistry|physics|earth science|science/.test(source)) return "Science";
  if (/history|social studies|government|civics/.test(source)) return "Social Studies";
  if (/language arts|literature|grammar|reading|english/.test(source)) return "ELA";
  if (/computer science|coding|programming/.test(source)) return "Computer Science";
  return "Other";
}

function normalizeIsbnLike(value: string): string {
  return value.replace(/[^0-9Xx]/g, "").toUpperCase();
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

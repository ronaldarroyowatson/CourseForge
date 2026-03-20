export interface OcrCorrectionContext {
  step?: "cover" | "title" | "toc";
  publisherHint?: string;
}

interface OcrCorrectionRule {
  id: string;
  contextKey: string;
  noisyLineKey: string;
  correctedLine: string;
  createdAtMs: number;
  updatedAtMs: number;
  appliedCount: number;
}

const STORAGE_KEY = "courseforge.ocrCorrectionRules.v1";
const MAX_RULES = 250;

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function normalizePublisher(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join("-");
}

function normalizeLineKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildContextKey(context?: OcrCorrectionContext): string {
  const step = context?.step ?? "any";
  const publisher = normalizePublisher(context?.publisherHint) || "any";
  return `${step}|${publisher}`;
}

function parseRules(raw: string | null): OcrCorrectionRule[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as OcrCorrectionRule[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry) =>
      typeof entry.id === "string"
      && typeof entry.contextKey === "string"
      && typeof entry.noisyLineKey === "string"
      && typeof entry.correctedLine === "string"
    );
  } catch {
    return [];
  }
}

function readRules(): OcrCorrectionRule[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  return parseRules(storage.getItem(STORAGE_KEY));
}

function writeRules(rules: OcrCorrectionRule[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(rules.slice(-MAX_RULES)));
}

export function applyOcrCorrectionLearning(text: string, context?: OcrCorrectionContext): string {
  const rules = readRules();
  if (rules.length === 0) {
    return text;
  }

  const contextKey = buildContextKey(context);
  const lines = text.replace(/\r/g, "\n").split("\n");
  let changed = false;

  const nextLines = lines.map((line) => {
    const normalized = normalizeLineKey(line);
    if (!normalized) {
      return line;
    }

    const matchingRule = rules.find((rule) =>
      rule.noisyLineKey === normalized
      && (rule.contextKey === contextKey || rule.contextKey.startsWith("any|"))
    );

    if (!matchingRule) {
      return line;
    }

    matchingRule.appliedCount += 1;
    matchingRule.updatedAtMs = Date.now();
    changed = true;
    return matchingRule.correctedLine;
  });

  if (changed) {
    writeRules(rules);
  }

  return nextLines.join("\n");
}

export function recordOcrCorrectionLearning(rawText: string, correctedText: string, context?: OcrCorrectionContext): void {
  const rawLines = rawText.replace(/\r/g, "\n").split("\n").map((line) => line.trim());
  const correctedLines = correctedText.replace(/\r/g, "\n").split("\n").map((line) => line.trim());

  if (rawLines.length === 0 || correctedLines.length === 0) {
    return;
  }

  const contextKey = buildContextKey(context);
  const rules = readRules();
  const now = Date.now();

  const total = Math.min(rawLines.length, correctedLines.length);
  for (let index = 0; index < total; index += 1) {
    const noisyLine = rawLines[index];
    const correctedLine = correctedLines[index];

    if (!noisyLine || !correctedLine || noisyLine === correctedLine) {
      continue;
    }

    const noisyLineKey = normalizeLineKey(noisyLine);
    if (!noisyLineKey || noisyLineKey.length < 4) {
      continue;
    }

    const hasLetters = /[a-z]/i.test(correctedLine);
    if (!hasLetters) {
      continue;
    }

    const existing = rules.find((rule) => rule.contextKey === contextKey && rule.noisyLineKey === noisyLineKey);
    if (existing) {
      existing.correctedLine = correctedLine;
      existing.updatedAtMs = now;
      continue;
    }

    rules.push({
      id: `${contextKey}:${noisyLineKey}`,
      contextKey,
      noisyLineKey,
      correctedLine,
      createdAtMs: now,
      updatedAtMs: now,
      appliedCount: 0,
    });
  }

  if (rules.length > 0) {
    writeRules(rules);
  }
}

export interface TocTreeMapNode {
  id: string;
  text: string;
  role: string;
  level?: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export function normalizeTocTreeMapText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isLikelyOcrNoiseLine(normalizedText: string): boolean {
  if (normalizedText.length < 3) {
    return true;
  }

  if (/^[=\-\s©®()]+$/.test(normalizedText)) {
    return true;
  }

  if (/^i\s*=/.test(normalizedText) || /^g\s*=/.test(normalizedText)) {
    return true;
  }

  return false;
}

export function cleanOcrTocLine(line: string): string | null {
  const compact = line
    .replace(/\s+/g, " ")
    .replace(/[©®]/g, " ")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizeTocTreeMapText(compact);
  if (!normalized || isLikelyOcrNoiseLine(normalized)) {
    return null;
  }

  if (normalized.includes("go to current location")) {
    return "Table of Contents";
  }

  if (normalized === "contents x") {
    return "Contents";
  }

  return compact;
}

export function isTopLevelTocHeading(text: string): boolean {
  const normalized = normalizeTocTreeMapText(text);
  return /^(unit|module|chapter)\b/.test(normalized);
}

export function selectTocTreeMapLines(lines: string[], maxCount = 220): string[] {
  if (maxCount <= 0) {
    return [];
  }

  const topLevel: string[] = [];
  const remaining: string[] = [];

  lines.forEach((line) => {
    if (isTopLevelTocHeading(line)) {
      topLevel.push(line);
      return;
    }

    remaining.push(line);
  });

  return [...topLevel, ...remaining].slice(0, maxCount);
}

export function getTocTreeMapNodeKey(node: TocTreeMapNode): string {
  const normalizedText = normalizeTocTreeMapText(node.text);
  if (node.role === "ocr-line") {
    return [node.role, node.level ?? 0, normalizedText].join("|");
  }

  return [
    node.role,
    node.level ?? 0,
    normalizedText,
    Math.round(node.xRatio * 24),
  ].join("|");
}

export function mergeTocTreeMapNodes(existing: TocTreeMapNode[], incoming: TocTreeMapNode[]): TocTreeMapNode[] {
  return mergeTocTreeMapNodesWithStats(existing, incoming).nodes;
}

export interface TocTreeMapMergeStats {
  nodes: TocTreeMapNode[];
  incomingCount: number;
  addedCount: number;
  duplicateCount: number;
  droppedByCapCount: number;
  totalCount: number;
}

export function mergeTocTreeMapNodesWithStats(existing: TocTreeMapNode[], incoming: TocTreeMapNode[]): TocTreeMapMergeStats {
  const merged: TocTreeMapNode[] = [];
  const seen = new Set<string>();

  const appendIfNew = (node: TocTreeMapNode): boolean => {
    const key = getTocTreeMapNodeKey(node);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    merged.push(node);
    return true;
  };

  existing.forEach((node) => {
    appendIfNew(node);
  });
  const baseExistingCount = Math.min(220, merged.length);

  let preCapAddedCount = 0;
  incoming.forEach((node) => {
    if (appendIfNew(node)) {
      preCapAddedCount += 1;
    }
  });

  const capped = merged.slice(0, 220);
  const totalCount = capped.length;
  const droppedByCapCount = Math.max(0, merged.length - totalCount);
  const effectiveAddedCount = Math.max(0, totalCount - baseExistingCount);
  const duplicateCount = Math.max(0, incoming.length - preCapAddedCount);

  return {
    nodes: capped,
    incomingCount: incoming.length,
    addedCount: effectiveAddedCount,
    duplicateCount,
    droppedByCapCount,
    totalCount,
  };
}
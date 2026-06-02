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
  const merged: TocTreeMapNode[] = [];
  const seen = new Set<string>();

  const appendIfNew = (node: TocTreeMapNode): void => {
    const key = getTocTreeMapNodeKey(node);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(node);
  };

  existing.forEach(appendIfNew);
  incoming.forEach(appendIfNew);

  return merged.slice(0, 220);
}
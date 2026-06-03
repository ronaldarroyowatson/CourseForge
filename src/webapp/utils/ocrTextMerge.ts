function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function splitNormalizedLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function splitTokens(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function looksLikeTitledPageLine(line: string): boolean {
  if (!/[A-Za-z].+\s+\d{1,4}(?:\s*[-–]\s*\d{1,4})?$/.test(line)) {
    return false;
  }

  const symbolCount = (line.match(/[^A-Za-z0-9\s.,:;!?()'"%\-–]/g) ?? []).length;
  const symbolRatio = line.length > 0 ? symbolCount / line.length : 1;
  if (symbolRatio > 0.08) {
    return false;
  }

  const alphaTokens = splitTokens(line).filter((token) => /[A-Za-z]{3,}/.test(token));
  return alphaTokens.length >= 2;
}

function hasTocShape(line: string): boolean {
  return /\b(module|chapter|lesson|unit)\b/i.test(line)
    || /^\d+(?:\.\d+)+\s+/i.test(line)
    || looksLikeTitledPageLine(line)
    || /\bclaim\s*,\s*evidence\s*,\s*reasoning\b/i.test(line)
    || /\bgo\s+further\b/i.test(line);
}

function tokenNoiseScore(token: string): number {
  if (!token.trim()) {
    return 1;
  }

  const cleaned = token.replace(/[.,:;!?()\[\]{}'"%]/g, "");
  if (!cleaned) {
    return 0.9;
  }

  const letters = (cleaned.match(/[A-Za-z]/g) ?? []).length;
  const digits = (cleaned.match(/[0-9]/g) ?? []).length;
  const other = cleaned.length - letters - digits;

  let score = 0;
  if (other > 0) {
    score += Math.min(0.7, other / cleaned.length);
  }

  if (letters > 0 && digits > 0 && cleaned.length >= 4) {
    score += 0.25;
  }

  if (letters >= 2 && digits >= 3) {
    score += 0.35;
  }

  if (cleaned.length === 1 && /[^0-9]/.test(cleaned)) {
    score += 0.35;
  }

  if (/^[^A-Za-z0-9]{2,}$/.test(token)) {
    score += 0.6;
  }

  return Math.max(0, Math.min(1, score));
}

function lineConfidence(line: string): number {
  const tokens = splitTokens(line);
  if (tokens.length === 0) {
    return 0;
  }

  const tokenNoise = tokens.reduce((sum, token) => sum + tokenNoiseScore(token), 0) / tokens.length;
  const letters = (line.match(/[A-Za-z]/g) ?? []).length;
  const symbols = (line.match(/[^A-Za-z0-9\s.,:;!?()'"%\-–]/g) ?? []).length;
  const symbolPenalty = line.length > 0 ? Math.min(0.5, symbols / line.length) : 0;
  const lexicalBonus = letters >= 4 ? 0.18 : 0;
  const tocBonus = hasTocShape(line) ? 0.22 : 0;

  const confidence = 0.72 - (tokenNoise * 0.62) - (symbolPenalty * 0.48) + lexicalBonus + tocBonus;
  return Math.max(0, Math.min(1, confidence));
}

function isHighNoiseLine(line: string): boolean {
  const normalized = normalizeLine(line);
  if (!normalized) {
    return true;
  }

  if (hasTocShape(line)) {
    return false;
  }

  if (/^[^a-z0-9]{2,}$/i.test(line.trim())) {
    return true;
  }

  const tokens = splitTokens(line);
  if (tokens.length <= 2) {
    const significant = tokens.filter((token) => normalizeToken(token).length >= 2);
    if (significant.length === 0) {
      return true;
    }
  }

  const suspiciousMixedToken = tokens.some((token) => {
    const cleaned = token.replace(/[^A-Za-z0-9]/g, "");
    if (!cleaned) {
      return false;
    }
    const letters = (cleaned.match(/[A-Za-z]/g) ?? []).length;
    const digits = (cleaned.match(/[0-9]/g) ?? []).length;
    return letters >= 2 && digits >= 3;
  });

  const extremeGarbageToken = tokens.some((token) => {
    const cleaned = token.replace(/[^A-Za-z0-9]/g, "");
    if (cleaned.length < 7) {
      return false;
    }
    const letters = (cleaned.match(/[A-Za-z]/g) ?? []).length;
    const digits = (cleaned.match(/[0-9]/g) ?? []).length;
    return letters >= 1 && digits >= 3;
  });

  const noiseAverage = tokens.length > 0
    ? tokens.reduce((sum, token) => sum + tokenNoiseScore(token), 0) / tokens.length
    : 1;
  const symbolCount = (line.match(/[^A-Za-z0-9\s.,:;!?()'"%\-–]/g) ?? []).length;
  const symbolRatio = line.length > 0 ? symbolCount / line.length : 1;

  if (suspiciousMixedToken && noiseAverage >= 0.4) {
    return true;
  }

  if (extremeGarbageToken && symbolRatio >= 0.1) {
    return true;
  }

  if (symbolRatio >= 0.18 && noiseAverage >= 0.38) {
    return true;
  }

  return lineConfidence(line) < 0.22;
}

function lineSimilarity(left: string, right: string): number {
  const leftTokens = splitTokens(left).map(normalizeToken).filter(Boolean);
  const rightTokens = splitTokens(right).map(normalizeToken).filter(Boolean);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let shared = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      shared += 1;
    }
  });

  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = union > 0 ? shared / union : 0;

  if (normalizeLine(left) === normalizeLine(right)) {
    return 1;
  }

  return jaccard;
}

function chooseBetterToken(existingToken: string, incomingToken: string): string {
  const existingScore = tokenNoiseScore(existingToken);
  const incomingScore = tokenNoiseScore(incomingToken);
  if (incomingScore < existingScore) {
    return incomingToken;
  }
  if (existingScore < incomingScore) {
    return existingToken;
  }

  const existingNorm = normalizeToken(existingToken);
  const incomingNorm = normalizeToken(incomingToken);
  if (incomingNorm.length > existingNorm.length) {
    return incomingToken;
  }
  return existingToken;
}

function mergeLineByTokenQuality(existingLine: string, incomingLine: string): string {
  const existingTokens = splitTokens(existingLine);
  const incomingTokens = splitTokens(incomingLine);
  const maxCount = Math.max(existingTokens.length, incomingTokens.length);

  const mergedTokens: string[] = [];
  for (let index = 0; index < maxCount; index += 1) {
    const existingToken = existingTokens[index];
    const incomingToken = incomingTokens[index];

    if (existingToken && incomingToken) {
      const existingNorm = normalizeToken(existingToken);
      const incomingNorm = normalizeToken(incomingToken);

      if (existingNorm && incomingNorm && (existingNorm === incomingNorm || lineSimilarity(existingToken, incomingToken) >= 0.5)) {
        mergedTokens.push(chooseBetterToken(existingToken, incomingToken));
      } else {
        const existingTokenConfidence = 1 - tokenNoiseScore(existingToken);
        const incomingTokenConfidence = 1 - tokenNoiseScore(incomingToken);
        mergedTokens.push(incomingTokenConfidence >= existingTokenConfidence ? incomingToken : existingToken);
      }
      continue;
    }

    if (incomingToken) {
      mergedTokens.push(incomingToken);
    } else if (existingToken) {
      mergedTokens.push(existingToken);
    }
  }

  return mergedTokens.join(" ").replace(/\s+/g, " ").trim();
}

function findLineOverlapCount(existing: string[], incoming: string[]): number {
  const maxOverlap = Math.min(existing.length, incoming.length, 60);
  if (maxOverlap === 0) {
    return 0;
  }

  const normalizedExisting = existing.map(normalizeLine);
  const normalizedIncoming = incoming.map(normalizeLine);

  for (let count = maxOverlap; count >= 1; count -= 1) {
    let matches = true;
    for (let index = 0; index < count; index += 1) {
      const existingLine = normalizedExisting[normalizedExisting.length - count + index];
      const incomingLine = normalizedIncoming[index];
      if (!existingLine || !incomingLine || existingLine !== incomingLine) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return count;
    }
  }

  return 0;
}

function findBestLineOverlap(existing: string[], incoming: string[]): { count: number; score: number } {
  const strict = findLineOverlapCount(existing, incoming);
  if (strict > 0) {
    return { count: strict, score: 1 };
  }

  const maxOverlap = Math.min(existing.length, incoming.length, 60);
  let best = { count: 0, score: 0 };

  for (let count = maxOverlap; count >= 1; count -= 1) {
    let scoreTotal = 0;
    for (let index = 0; index < count; index += 1) {
      const existingLine = existing[existing.length - count + index];
      const incomingLine = incoming[index];
      scoreTotal += lineSimilarity(existingLine ?? "", incomingLine ?? "");
    }

    const averageScore = scoreTotal / count;
    if (count >= 2 && averageScore >= 0.88) {
      return { count, score: averageScore };
    }

    if (averageScore > best.score) {
      best = { count, score: averageScore };
    }
  }

  if (best.score >= 0.9 && best.count >= 2) {
    return best;
  }

  return { count: 0, score: 0 };
}

function collapseSequentialDuplicates(lines: string[]): string[] {
  const result: string[] = [];

  for (const line of lines) {
    const previous = result.length > 0 ? result[result.length - 1] : null;
    if (previous && normalizeLine(previous) === normalizeLine(line)) {
      continue;
    }
    result.push(line);
  }

  return result;
}

function collapseNearDuplicates(lines: string[]): string[] {
  const result: string[] = [];

  for (const line of lines) {
    const previous = result[result.length - 1];
    if (!previous) {
      result.push(line);
      continue;
    }

    if (lineSimilarity(previous, line) >= 0.9) {
      result[result.length - 1] = lineConfidence(line) >= lineConfidence(previous) ? line : previous;
      continue;
    }

    result.push(line);
  }

  return result;
}

function denoiseLines(lines: string[]): string[] {
  return lines.filter((line) => !isHighNoiseLine(line));
}

function runIterativeRefinement(lines: string[], applyDenoise = true): string[] {
  let current = [...lines];

  for (let round = 0; round < 3; round += 1) {
    const previousSerialized = JSON.stringify(current);
    const deduped = collapseNearDuplicates(collapseSequentialDuplicates(current));
    current = applyDenoise ? denoiseLines(deduped) : deduped;
    if (JSON.stringify(current) === previousSerialized) {
      break;
    }
  }

  return current;
}

function mergeOverlappingRegion(existingTail: string[], incomingHead: string[]): string[] {
  const overlapSize = Math.min(existingTail.length, incomingHead.length);
  const merged: string[] = [];

  for (let index = 0; index < overlapSize; index += 1) {
    const existingLine = existingTail[index] ?? "";
    const incomingLine = incomingHead[index] ?? "";
    const similarity = lineSimilarity(existingLine, incomingLine);

    if (similarity >= 0.5) {
      merged.push(mergeLineByTokenQuality(existingLine, incomingLine));
      continue;
    }

    const existingConfidence = lineConfidence(existingLine);
    const incomingConfidence = lineConfidence(incomingLine);
    merged.push(incomingConfidence >= existingConfidence ? incomingLine : existingLine);
  }

  return merged;
}

/**
 * Merge OCR text from a follow-up screenshot into an existing OCR transcript.
 * Trims top-overlap lines from the incoming shot and removes sequential duplicates.
 */
export function mergeOcrTextWithOverlap(existingText: string, incomingText: string): string {
  const existingLines = splitNormalizedLines(existingText);
  const incomingLines = splitNormalizedLines(incomingText);

  if (existingLines.length === 0) {
    return incomingLines.join("\n");
  }

  if (incomingLines.length === 0) {
    return existingLines.join("\n");
  }

  const overlap = findBestLineOverlap(existingLines, incomingLines);

  if (overlap.count <= 0) {
    const fallbackMerged = runIterativeRefinement([...existingLines, ...incomingLines], true);
    return fallbackMerged.join("\n");
  }

  const left = existingLines.slice(0, Math.max(0, existingLines.length - overlap.count));
  const overlappingExisting = existingLines.slice(existingLines.length - overlap.count);
  const overlappingIncoming = incomingLines.slice(0, overlap.count);
  const mergedOverlap = mergeOverlappingRegion(overlappingExisting, overlappingIncoming);
  const right = incomingLines.slice(overlap.count);

  const merged = runIterativeRefinement([...left, ...mergedOverlap, ...right]);
  return merged.join("\n");
}

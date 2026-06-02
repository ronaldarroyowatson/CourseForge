function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function splitNormalizedLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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

  const overlapCount = findLineOverlapCount(existingLines, incomingLines);
  const trimmedIncoming = incomingLines.slice(overlapCount);
  const merged = collapseSequentialDuplicates([...existingLines, ...trimmedIncoming]);

  return merged.join("\n");
}

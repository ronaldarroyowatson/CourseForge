export function incrementTrailingNumber(value: string): string {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^(.*?)(\d+)(?!.*\d)$/);

  if (!match) {
    return trimmedValue;
  }

  const [, prefix, numericSuffix] = match;
  const nextNumber = Number.parseInt(numericSuffix, 10) + 1;
  return `${prefix}${nextNumber}`;
}

export function getNextIndex(values: number[]): string {
  if (values.length === 0) {
    return "";
  }

  return String(Math.max(...values) + 1);
}
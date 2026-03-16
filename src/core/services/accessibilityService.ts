export interface ContrastCheckResult {
  ratio: number;
  passesAA: boolean;
  passesAAA: boolean;
}

function toLinearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b);
}

export function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.trim().replace(/^#/, "");
  const full = cleaned.length === 3
    ? cleaned.split("").map((char) => `${char}${char}`).join("")
    : cleaned;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

export function computeContrastRatio(foregroundHex: string, backgroundHex: string): number {
  const fgLum = relativeLuminance(hexToRgb(foregroundHex));
  const bgLum = relativeLuminance(hexToRgb(backgroundHex));
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

export function checkContrast(foregroundHex: string, backgroundHex: string): ContrastCheckResult {
  const ratio = computeContrastRatio(foregroundHex, backgroundHex);
  return {
    ratio,
    passesAA: ratio >= 4.5,
    passesAAA: ratio >= 7,
  };
}

export function simplifyNumberForDyscalculia(value: number | string): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(numeric);
}

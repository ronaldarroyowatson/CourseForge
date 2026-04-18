export const LEGACY_BRAND_BLUE = "#0c3183" as const;

export const AUTHORITATIVE_SEMANTIC_PALETTE = {
  MAJOR: "#2563EB",
  MINOR: "#73A2F5",
  ACCENT: "#FFFFFF",
  SUCCESS: "#22C55E",
  WARNING: "#FACC15",
  ERROR: "#EF4444",
  INFO: "#06B6D4",
} as const;

export type SemanticRole = keyof typeof AUTHORITATIVE_SEMANTIC_PALETTE;

export function normalizeHexColor(input: string | null | undefined): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(prefixed)) {
    return prefixed.toUpperCase();
  }

  return prefixed.toUpperCase();
}

export function getAuthoritativeSemanticToken(role: SemanticRole): string {
  return AUTHORITATIVE_SEMANTIC_PALETTE[role];
}

export function detectLegacyColorUsage(color: string | null | undefined, whitelist: string[] = []): boolean {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return false;
  }

  const normalizedWhitelist = new Set(whitelist.map((entry) => normalizeHexColor(entry)));
  return normalized === normalizeHexColor(LEGACY_BRAND_BLUE) && !normalizedWhitelist.has(normalized);
}

export function getSemanticCssVariables(): Record<string, string> {
  return {
    "--dsc-major": AUTHORITATIVE_SEMANTIC_PALETTE.MAJOR,
    "--dsc-minor": AUTHORITATIVE_SEMANTIC_PALETTE.MINOR,
    "--dsc-accent": AUTHORITATIVE_SEMANTIC_PALETTE.ACCENT,
    "--dsc-success": AUTHORITATIVE_SEMANTIC_PALETTE.SUCCESS,
    "--dsc-warning": AUTHORITATIVE_SEMANTIC_PALETTE.WARNING,
    "--dsc-error": AUTHORITATIVE_SEMANTIC_PALETTE.ERROR,
    "--dsc-info": AUTHORITATIVE_SEMANTIC_PALETTE.INFO,
  };
}

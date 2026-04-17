/**
 * Authoritative DSC Semantic Token Palette
 *
 * These hex values are canonical and MUST NOT be overridden by harmony tools,
 * theme generators, or defaults. Any code path that produces a different value
 * for these roles is a bug.
 *
 * If a legacy color must be referenced (e.g. for migration purposes), add it to
 * LEGACY_COLOR_WHITELIST with a clear comment explaining the exemption.
 */

export interface SemanticTokenPalette {
  MAJOR: string;
  MINOR: string;
  ACCENT: string;
  SUCCESS: string;
  WARNING: string;
  ERROR: string;
  INFO: string;
}

/**
 * The single source of truth for all DSC semantic color tokens.
 * These values drive CSS variable generation, theme objects, and
 * component styling across the CourseForge UI.
 */
export const SEMANTIC_PALETTE: Readonly<SemanticTokenPalette> = Object.freeze({
  MAJOR:   "#2563EB",
  MINOR:   "#73A2F5",
  ACCENT:  "#FFFFFF",
  SUCCESS: "#22C55E",
  WARNING: "#FACC15",
  ERROR:   "#EF4444",
  INFO:    "#06B6D4",
});

/**
 * Legacy colors that are explicitly allowed in whitelisted contexts.
 * Every entry here must have a comment explaining its purpose.
 */
export const LEGACY_COLOR_WHITELIST: Readonly<Record<string, string>> = Object.freeze({
  /**
   * LEGACY_BRAND_BLUE: The original CourseForge brand primary blue.
   * Permitted only in historical export templates and legacy migration paths.
   * Must NOT appear in active themes, card backgrounds, or live UI tokens.
   */
  LEGACY_BRAND_BLUE: "#0c3183",
});

/**
 * CSS custom property names that map to each semantic token.
 * These names are used to generate the :root block and verify
 * computed values match the authoritative palette.
 */
export const SEMANTIC_CSS_VARS: Readonly<Record<keyof SemanticTokenPalette, string>> = Object.freeze({
  MAJOR:   "--dsc-major",
  MINOR:   "--dsc-minor",
  ACCENT:  "--dsc-accent",
  SUCCESS: "--dsc-success",
  WARNING: "--dsc-warning",
  ERROR:   "--dsc-error",
  INFO:    "--dsc-info",
});

/**
 * Checks whether a hex color value is a known legacy color that is explicitly
 * whitelisted and therefore allowed in certain contexts.
 */
export function isLegacyColorWhitelisted(hex: string): boolean {
  const normalized = hex.toLowerCase().replace(/^#/, "");
  return Object.values(LEGACY_COLOR_WHITELIST).some(
    (value) => value.toLowerCase().replace(/^#/, "") === normalized
  );
}

/**
 * Checks whether a hex value matches the authoritative semantic palette
 * for the given role. Returns true if the values match (case-insensitive).
 */
export function semanticTokenMatchesPalette(
  role: keyof SemanticTokenPalette,
  hexValue: string
): boolean {
  const expected = SEMANTIC_PALETTE[role].toLowerCase();
  const actual = hexValue.toLowerCase();
  return expected === actual;
}

/**
 * Returns the authoritative hex value for a semantic role.
 */
export function getSemanticColor(role: keyof SemanticTokenPalette): string {
  return SEMANTIC_PALETTE[role];
}

/**
 * Validates a theme object's semantic tokens against the authoritative palette.
 * Returns an array of mismatch descriptions (empty if everything is correct).
 */
export function validateSemanticTokens(
  theme: Partial<Record<keyof SemanticTokenPalette, string>>
): Array<{ role: keyof SemanticTokenPalette; expected: string; actual: string }> {
  const mismatches: Array<{ role: keyof SemanticTokenPalette; expected: string; actual: string }> = [];

  for (const role of Object.keys(SEMANTIC_PALETTE) as Array<keyof SemanticTokenPalette>) {
    const actual = theme[role];
    if (actual === undefined) {
      continue;
    }

    if (!semanticTokenMatchesPalette(role, actual)) {
      mismatches.push({
        role,
        expected: SEMANTIC_PALETTE[role],
        actual,
      });
    }
  }

  return mismatches;
}

/**
 * Generates a CSS :root block string containing all DSC semantic token
 * custom properties with their authoritative values.
 *
 * Intended for injection into the document <head> or for snapshot testing.
 */
export function generateSemanticTokensCss(): string {
  const lines: string[] = [":root {"];
  for (const role of Object.keys(SEMANTIC_PALETTE) as Array<keyof SemanticTokenPalette>) {
    const cssVar = SEMANTIC_CSS_VARS[role];
    const value = SEMANTIC_PALETTE[role];
    lines.push(`  ${cssVar}: ${value};`);
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Applies semantic token CSS custom properties to a DOM element (defaults to
 * document.documentElement). Safe to call in SSR (no-op when window is absent).
 */
export function applySemanticTokensToRoot(element?: HTMLElement): void {
  if (typeof window === "undefined") {
    return;
  }

  const target = element ?? document.documentElement;
  for (const role of Object.keys(SEMANTIC_PALETTE) as Array<keyof SemanticTokenPalette>) {
    const cssVar = SEMANTIC_CSS_VARS[role];
    const value = SEMANTIC_PALETTE[role];
    target.style.setProperty(cssVar, value);
  }
}

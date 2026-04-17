/**
 * Token Resolution Debug Module
 *
 * Activated when:
 *   - COURSEFORGE_DEBUG_DSC=1 environment variable is set
 *   - The unified Debug Log card Generate Report button is pressed
 *   - The CLI `program debug dsc` command is run
 *
 * Records every token resolution event with full diagnostic context.
 */

import {
  type SemanticTokenPalette,
  LEGACY_COLOR_WHITELIST,
  SEMANTIC_PALETTE,
  semanticTokenMatchesPalette,
} from "./semanticTokens";

export type ComponentState = "default" | "hover" | "active" | "disabled" | "focus";
export type ThemeMode = "light" | "dark" | "system";
export type TokenResolutionStatus = "ok" | "mismatch" | "error" | "cascading-failure-risk";

export interface TokenResolutionRecord {
  /** ISO timestamp when this resolution was recorded */
  timestamp: string;
  /** The semantic role this token is supposed to fulfill, e.g. "MAJOR" */
  semanticRole: keyof SemanticTokenPalette | string;
  /** The CSS variable or token name that was requested */
  requestedToken: string;
  /** The CSS variable or token name that was ultimately resolved */
  resolvedToken: string;
  /** The computed hex color value (normalized to lowercase) */
  computedColor: string;
  /** Full fallback chain ordered from first attempted to last */
  fallbackChain: string[];
  /** Reason the fallback chain was traversed (empty when no fallback was needed) */
  reasonForFallback: string;
  /** Active theme mode at resolution time */
  themeMode: ThemeMode;
  /** Name of the component that triggered this resolution */
  componentName: string;
  /** Visual state of the component */
  componentState: ComponentState;
  /** Foreground-vs-background contrast ratio (0 when unknown) */
  contrastAgainstBackground: number;
  /** Whether the contrast ratio meets WCAG AA (4.5:1 for text) */
  contrastIsAcceptable: boolean;
  /** Overall resolution status */
  status: TokenResolutionStatus;
  /** Human-readable description of any problem found */
  issue?: string;
}

export interface CardTokenReport {
  pageId: string;
  cardId: string;
  cardType: string;
  recipeName: string;
  expectedTokenSet: Partial<Record<string, string>>;
  actualTokenSet: Partial<Record<string, string>>;
  backgroundColor: string;
  borderColor: string;
  titleTextColor: string;
  bodyTextColor: string;
  buttonTypes: string[];
  buttonTokenSets: Array<{ buttonType: string; tokens: Partial<Record<string, string>>; computedColors: Partial<Record<string, string>> }>;
  fallbacksUsed: string[];
  mismatches: Array<{ token: string; expected: string; actual: string }>;
  legacyColorsFound: Array<{ token: string; color: string; isWhitelisted: boolean }>;
  timestamp: string;
}

export interface DscDebugReport {
  generatedAt: string;
  appVersion: string;
  themeMode: ThemeMode;
  semanticPalette: Readonly<SemanticTokenPalette>;
  semanticPaletteValidation: Array<{ role: string; expected: string; actual: string; status: "ok" | "mismatch" }>;
  tokenResolutions: TokenResolutionRecord[];
  cardReports: CardTokenReport[];
  legacyColorInstances: Array<{ color: string; location: string; isWhitelisted: boolean }>;
  summary: {
    totalResolutions: number;
    mismatches: number;
    errors: number;
    cascadingFailureRisks: number;
    legacyColorCount: number;
    unwhitelistedLegacyColors: number;
  };
}

// --------------------------------------------------------------------------
// In-memory resolution log (ring buffer, max 2000 entries)
// --------------------------------------------------------------------------

const MAX_RECORDS = 2000;
const resolutionLog: TokenResolutionRecord[] = [];

/** Pre-computed normalized legacy color hex values (no leading #) for fast lookup */
const NORMALIZED_LEGACY_HEX_VALUES: ReadonlySet<string> = new Set(
  Object.values(LEGACY_COLOR_WHITELIST).map((v) => v.toLowerCase().replace(/^#/, ""))
);

/**
 * Returns true when DSC debug mode is active. Checks both the environment
 * variable and the localStorage override so it works in browser and Node.
 */
export function isDscDebugEnabled(): boolean {
  // Node / CI environment
  if (typeof process !== "undefined" && process.env["COURSEFORGE_DEBUG_DSC"] === "1") {
    return true;
  }

  // Browser localStorage override
  if (typeof window !== "undefined") {
    return window.localStorage.getItem("courseforge.dscDebug") === "1";
  }

  return false;
}

/**
 * Enable or disable DSC debug mode in localStorage (browser only).
 */
export function setDscDebugEnabled(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  if (enabled) {
    window.localStorage.setItem("courseforge.dscDebug", "1");
  } else {
    window.localStorage.removeItem("courseforge.dscDebug");
  }
}

/**
 * Record a single token resolution event. No-op when debug mode is off.
 */
export function recordTokenResolution(params: {
  semanticRole: keyof SemanticTokenPalette | string;
  requestedToken: string;
  resolvedToken: string;
  computedColor: string;
  fallbackChain?: string[];
  reasonForFallback?: string;
  themeMode?: ThemeMode;
  componentName?: string;
  componentState?: ComponentState;
  contrastAgainstBackground?: number;
  contrastIsAcceptable?: boolean;
}): TokenResolutionRecord | null {
  if (!isDscDebugEnabled()) {
    return null;
  }

  const computedColorNorm = params.computedColor.toLowerCase();
  const computedColorNoHash = computedColorNorm.replace(/^#/, "");
  const fallbackChain = params.fallbackChain ?? [];
  const reasonForFallback = params.reasonForFallback ?? "";

  let status: TokenResolutionStatus = "ok";
  let issue: string | undefined;

  // Use pre-computed set for O(1) legacy color lookup
  const isLegacyBrandBlue = computedColorNoHash === "0c3183";
  const isLegacy = NORMALIZED_LEGACY_HEX_VALUES.has(computedColorNoHash);

  if (isLegacyBrandBlue && !isWhitelistedForRole(params.semanticRole)) {
    status = "error";
    issue = `Computed color ${params.computedColor} is the legacy brand blue (#0c3183). This color must not appear in active UI tokens unless explicitly whitelisted.`;
  } else if (!isLegacy && isSemanticallyMapped(params.semanticRole)) {
    const role = params.semanticRole as keyof SemanticTokenPalette;
    if (!semanticTokenMatchesPalette(role, computedColorNorm)) {
      status = "mismatch";
      issue = `Token "${params.semanticRole}" resolved to ${params.computedColor} but the authoritative value is ${SEMANTIC_PALETTE[role]}.`;
    }
  }

  if (fallbackChain.length > 0 && status === "ok") {
    status = "cascading-failure-risk";
    issue = `Token traversed a fallback chain of ${fallbackChain.length} step(s). This may indicate a missing or misconfigured token.`;
  }

  const record: TokenResolutionRecord = {
    timestamp: new Date().toISOString(),
    semanticRole: params.semanticRole,
    requestedToken: params.requestedToken,
    resolvedToken: params.resolvedToken,
    computedColor: computedColorNorm,
    fallbackChain,
    reasonForFallback,
    themeMode: params.themeMode ?? "light",
    componentName: params.componentName ?? "unknown",
    componentState: params.componentState ?? "default",
    contrastAgainstBackground: params.contrastAgainstBackground ?? 0,
    contrastIsAcceptable: params.contrastIsAcceptable ?? true,
    status,
    issue,
  };

  if (resolutionLog.length >= MAX_RECORDS) {
    resolutionLog.shift();
  }

  resolutionLog.push(record);
  return record;
}

function isSemanticallyMapped(role: string): role is keyof SemanticTokenPalette {
  return role in SEMANTIC_PALETTE;
}

function isWhitelistedForRole(_role: string): boolean {
  // Currently no roles are whitelisted for legacy brand blue.
  // Add entries here if a specific role must reference a legacy value.
  return false;
}

/**
 * Return a snapshot of all recorded resolution events.
 */
export function getTokenResolutionLog(): TokenResolutionRecord[] {
  return [...resolutionLog];
}

/**
 * Clear all recorded resolution events.
 */
export function clearTokenResolutionLog(): void {
  resolutionLog.length = 0;
}

// --------------------------------------------------------------------------
// Card-level token reports (in-memory, populated by UI introspection)
// --------------------------------------------------------------------------

const cardReports: CardTokenReport[] = [];

/**
 * Register a card-level token report from the UI introspection layer.
 */
export function registerCardTokenReport(report: CardTokenReport): void {
  const existingIndex = cardReports.findIndex(
    (r) => r.pageId === report.pageId && r.cardId === report.cardId
  );

  if (existingIndex >= 0) {
    cardReports[existingIndex] = report;
  } else {
    cardReports.push(report);
  }
}

/**
 * Return all registered card token reports.
 */
export function getCardTokenReports(): CardTokenReport[] {
  return [...cardReports];
}

/**
 * Return card reports for a specific page.
 */
export function getCardTokenReportsByPage(pageId: string): CardTokenReport[] {
  return cardReports.filter((r) => r.pageId === pageId);
}

/**
 * Clear all card-level token reports.
 */
export function clearCardTokenReports(): void {
  cardReports.length = 0;
}

// --------------------------------------------------------------------------
// Full debug report generation
// --------------------------------------------------------------------------

/**
 * Scan a CSS variable value string for any occurrence of a legacy color.
 * Returns null when none found.
 */
function detectLegacyColor(value: string): { color: string; isWhitelisted: boolean } | null {
  const legacyValues = Object.entries(LEGACY_COLOR_WHITELIST);
  for (const [, legacyHex] of legacyValues) {
    const normalized = legacyHex.toLowerCase().replace(/^#/, "");
    if (value.toLowerCase().includes(normalized)) {
      return { color: legacyHex, isWhitelisted: true };
    }
  }

  return null;
}

/**
 * Collect all CSS custom properties from document.documentElement and check
 * for legacy colors. Returns an array of detected instances.
 */
function scanCssVariablesForLegacyColors(): Array<{ color: string; location: string; isWhitelisted: boolean }> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return [];
  }

  const instances: Array<{ color: string; location: string; isWhitelisted: boolean }> = [];

  try {
    const allStyles = Array.from(document.styleSheets);
    for (const sheet of allStyles) {
      try {
        const rules = Array.from(sheet.cssRules ?? []);
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule) {
            const text = rule.style.cssText;
            const legacy = detectLegacyColor(text);
            if (legacy) {
              instances.push({ ...legacy, location: `${rule.selectorText}: ${text.slice(0, 80)}` });
            }
          }
        }
      } catch {
        // Cross-origin stylesheet — skip
      }
    }
  } catch {
    // DOM not available or security error
  }

  return instances;
}

/**
 * Validate current CSS custom property values on the root element against
 * the authoritative semantic palette.
 */
function validateCurrentCssVarValues(): Array<{ role: string; expected: string; actual: string; status: "ok" | "mismatch" }> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    // In SSR / Node, report the static palette as authoritative
    return Object.entries(SEMANTIC_PALETTE).map(([role, expected]) => ({
      role,
      expected,
      actual: expected,
      status: "ok" as const,
    }));
  }

  const computed = getComputedStyle(document.documentElement);
  return Object.entries(SEMANTIC_PALETTE).map(([role, expected]) => {
    const cssVar = `--dsc-${role.toLowerCase()}`;
    const actual = computed.getPropertyValue(cssVar).trim();
    const status = actual.toLowerCase() === expected.toLowerCase() ? "ok" as const : "mismatch" as const;
    return { role, expected, actual: actual || "(not set)", status };
  });
}

/**
 * Generates a comprehensive DscDebugReport capturing the current state of
 * semantic token resolution, CSS variables, and card-level token mappings.
 */
export function generateDscDebugReport(options: {
  appVersion?: string;
  themeMode?: ThemeMode;
} = {}): DscDebugReport {
  const themeMode: ThemeMode =
    options.themeMode ??
    ((typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark")
      ? "dark"
      : "light");

  const tokenResolutions = getTokenResolutionLog();
  const cards = getCardTokenReports();
  const legacyColorInstances = scanCssVariablesForLegacyColors();
  const semanticPaletteValidation = validateCurrentCssVarValues();

  const mismatches = tokenResolutions.filter((r) => r.status === "mismatch").length;
  const errors = tokenResolutions.filter((r) => r.status === "error").length;
  const cascadingFailureRisks = tokenResolutions.filter((r) => r.status === "cascading-failure-risk").length;
  const unwhitelisted = legacyColorInstances.filter((i) => !i.isWhitelisted).length;

  return {
    generatedAt: new Date().toISOString(),
    appVersion: options.appVersion ?? "unknown",
    themeMode,
    semanticPalette: SEMANTIC_PALETTE,
    semanticPaletteValidation,
    tokenResolutions,
    cardReports: cards,
    legacyColorInstances,
    summary: {
      totalResolutions: tokenResolutions.length,
      mismatches,
      errors,
      cascadingFailureRisks,
      legacyColorCount: legacyColorInstances.length,
      unwhitelistedLegacyColors: unwhitelisted,
    },
  };
}

/**
 * Serialize a DscDebugReport to a formatted JSON string.
 */
export function serializeDscDebugReport(report: DscDebugReport): string {
  return JSON.stringify(report, null, 2);
}

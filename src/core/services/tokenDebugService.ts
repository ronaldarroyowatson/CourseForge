import { checkContrast } from "./accessibilityService";
import {
  AUTHORITATIVE_SEMANTIC_PALETTE,
  detectLegacyColorUsage,
  normalizeHexColor,
  type SemanticRole,
} from "./semanticTokens";
import { getDesignTokenDebugReport } from "./designTokenDebugService";

export interface TokenResolutionRecord {
  semanticRole: SemanticRole;
  requestedToken: string;
  resolvedToken: string;
  computedColor: string;
  fallbackChain: string[];
  reasonForFallback: string;
  themeMode: "light" | "dark";
  componentName: string;
  componentState: "default" | "hover" | "active" | "disabled" | "focus";
  contrastAgainstBackground: number;
  contrastIsAcceptable: boolean;
  isLegacyColorError: boolean;
  isMismatch: boolean;
  cascadingFailureRisk: boolean;
}

export interface UiIntrospectionReport {
  pageId: string;
  cardId: string;
  cardType: string;
  recipeName: string;
  expectedTokenSet: Record<SemanticRole, string>;
  actualTokenSet: Record<SemanticRole, string>;
  backgroundColor: string;
  borderColor: string;
  titleTextColor: string;
  bodyTextColor: string;
  buttonTypes: string[];
  buttonTokenSets: Record<string, { semantic: SemanticRole; resolvedColor: string }>;
  fallbacksUsed: string[];
  mismatches: Array<{ token: SemanticRole; expected: string; actual: string }>;
  legacyColors: string[];
}

export interface FullDebugReport {
  generatedAt: string;
  debugEnabled: boolean;
  tokenResolution: TokenResolutionRecord[];
  uiIntrospection: UiIntrospectionReport;
  cascadingFailureDetector: {
    hasRisk: boolean;
    reasons: string[];
  };
}

const TOKEN_FALLBACK_CHAIN: Record<SemanticRole, string[]> = {
  MAJOR: ["--cf-semantic-major", "--primary-bg", "--cf-accent"],
  MINOR: ["--cf-semantic-minor", "--primary-border", "--cf-accent-strong"],
  ACCENT: ["--cf-semantic-accent", "--on-accent", "--cf-text-on-accent"],
  SUCCESS: ["--cf-semantic-success", "--success-color", "--cf-success"],
  WARNING: ["--cf-semantic-warning", "--cf-warning"],
  ERROR: ["--cf-semantic-error", "--danger-bg", "--cf-danger"],
  INFO: ["--cf-semantic-info", "--cf-info"],
};

function resolveColorFromSources(role: SemanticRole, tokenSources: Record<string, string>): { resolved: string; requested: string; reason: string; usedFallback: boolean } {
  const chain = TOKEN_FALLBACK_CHAIN[role];
  const first = chain[0];
  const requested = normalizeHexColor(tokenSources[first]);

  if (requested === AUTHORITATIVE_SEMANTIC_PALETTE[role]) {
    return { resolved: requested, requested, reason: "resolved-direct", usedFallback: false };
  }

  for (const token of chain) {
    const value = normalizeHexColor(tokenSources[token]);
    if (value === AUTHORITATIVE_SEMANTIC_PALETTE[role]) {
      return { resolved: value, requested, reason: `fallback:${token}`, usedFallback: token !== first };
    }
  }

  return {
    resolved: AUTHORITATIVE_SEMANTIC_PALETTE[role],
    requested,
    reason: requested ? "authoritative-override" : "missing-token-default",
    usedFallback: true,
  };
}

export function buildTokenResolutionRecords(options: {
  tokenSources?: Record<string, string>;
  themeMode?: "light" | "dark";
  componentName?: string;
  componentState?: TokenResolutionRecord["componentState"];
  backgroundColor?: string;
  whitelist?: string[];
} = {}): TokenResolutionRecord[] {
  const themeMode = options.themeMode ?? "light";
  const componentName = options.componentName ?? "Debug Log";
  const componentState = options.componentState ?? "default";
  const backgroundColor = normalizeHexColor(options.backgroundColor) || "#FFFFFF";
  const tokenSources = options.tokenSources ?? {};
  const whitelist = options.whitelist ?? [];

  return (Object.keys(AUTHORITATIVE_SEMANTIC_PALETTE) as SemanticRole[]).map((role) => {
    const fallbackChain = TOKEN_FALLBACK_CHAIN[role];
    const resolution = resolveColorFromSources(role, tokenSources);
    const computedColor = normalizeHexColor(resolution.resolved);
    const expected = AUTHORITATIVE_SEMANTIC_PALETTE[role];
    const contrast = checkContrast(computedColor || expected, backgroundColor);
    const requested = normalizeHexColor(resolution.requested);
    const isMismatch = Boolean(requested && requested !== expected && !detectLegacyColorUsage(requested, whitelist));
    const isLegacyColorError = detectLegacyColorUsage(requested, whitelist);

    return {
      semanticRole: role,
      requestedToken: fallbackChain[0],
      resolvedToken: resolution.reason.startsWith("fallback") ? resolution.reason.replace("fallback:", "") : fallbackChain[0],
      computedColor: computedColor || expected,
      fallbackChain,
      reasonForFallback: resolution.reason,
      themeMode,
      componentName,
      componentState,
      contrastAgainstBackground: Number(contrast.ratio.toFixed(2)),
      contrastIsAcceptable: contrast.passesAA,
      isLegacyColorError,
      isMismatch,
      cascadingFailureRisk: resolution.usedFallback,
    };
  });
}

export function buildUiIntrospectionReport(options: {
  pageId?: string;
  cardId?: string;
  cardType?: string;
  recipeName?: string;
  tokenSources?: Record<string, string>;
} = {}): UiIntrospectionReport {
  const dscReport = getDesignTokenDebugReport({
    pageId: options.pageId ?? "settings",
    cardId: options.cardId ?? "debug-log",
  });

  const expectedTokenSet = { ...AUTHORITATIVE_SEMANTIC_PALETTE };
  const actualTokenSet = (Object.keys(AUTHORITATIVE_SEMANTIC_PALETTE) as SemanticRole[]).reduce<Record<SemanticRole, string>>((accumulator, role) => {
    accumulator[role] = normalizeHexColor(dscReport.tokens[role].resolvedValue) || AUTHORITATIVE_SEMANTIC_PALETTE[role];
    return accumulator;
  }, {} as Record<SemanticRole, string>);

  const mismatches = (Object.keys(expectedTokenSet) as SemanticRole[])
    .filter((token) => actualTokenSet[token] !== expectedTokenSet[token])
    .map((token) => ({ token, expected: expectedTokenSet[token], actual: actualTokenSet[token] }));

  const fallbacksUsed = (Object.keys(dscReport.tokens) as SemanticRole[])
    .filter((token) => dscReport.tokens[token].usedFallback)
    .map((token) => token);

  const buttonTokenSets = {
    primary: { semantic: "MAJOR" as const, resolvedColor: actualTokenSet.MAJOR },
    secondary: { semantic: "MINOR" as const, resolvedColor: actualTokenSet.MINOR },
    danger: { semantic: "ERROR" as const, resolvedColor: actualTokenSet.ERROR },
  };

  const legacyColors = Object.values(actualTokenSet).filter((color) => detectLegacyColorUsage(color));

  return {
    pageId: dscReport.page.id,
    cardId: dscReport.card.id,
    cardType: options.cardType ?? "settings-card",
    recipeName: options.recipeName ?? "settings.debug-log",
    expectedTokenSet,
    actualTokenSet,
    backgroundColor: "var(--bg-panel)",
    borderColor: "var(--border-default)",
    titleTextColor: "var(--text-primary)",
    bodyTextColor: "var(--text-secondary)",
    buttonTypes: Object.keys(buttonTokenSets),
    buttonTokenSets,
    fallbacksUsed,
    mismatches,
    legacyColors,
  };
}

export function buildFullDebugReport(options: {
  enabled?: boolean;
  pageId?: string;
  cardId?: string;
  tokenSources?: Record<string, string>;
  themeMode?: "light" | "dark";
  whitelist?: string[];
} = {}): FullDebugReport {
  const tokenResolution = buildTokenResolutionRecords({
    tokenSources: options.tokenSources,
    themeMode: options.themeMode,
    whitelist: options.whitelist,
  });

  const uiIntrospection = buildUiIntrospectionReport({
    pageId: options.pageId,
    cardId: options.cardId,
    tokenSources: options.tokenSources,
  });

  const riskReasons: string[] = [];
  if (tokenResolution.some((entry) => entry.isLegacyColorError)) {
    riskReasons.push("Legacy color detected in active token output.");
  }
  if (tokenResolution.some((entry) => entry.isMismatch)) {
    riskReasons.push("Semantic token mismatch detected against authoritative palette.");
  }
  if (tokenResolution.some((entry) => entry.cascadingFailureRisk)) {
    riskReasons.push("Fallback chain activated; cascading failure risk increased.");
  }

  return {
    generatedAt: new Date().toISOString(),
    debugEnabled: options.enabled ?? true,
    tokenResolution,
    uiIntrospection,
    cascadingFailureDetector: {
      hasRisk: riskReasons.length > 0,
      reasons: riskReasons,
    },
  };
}

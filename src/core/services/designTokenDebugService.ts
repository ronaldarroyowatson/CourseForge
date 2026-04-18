export const AUTHORITATIVE_SEMANTIC_PALETTE = {
  MAJOR: "#2563EB",
  MINOR: "#73A2F5",
  ACCENT: "#FFFFFF",
  SUCCESS: "#22C55E",
  WARNING: "#FACC15",
  ERROR: "#EF4444",
  INFO: "#06B6D4",
} as const;

export type SemanticTokenName = keyof typeof AUTHORITATIVE_SEMANTIC_PALETTE;

export interface DesignTokenDebugComponent {
  id: string;
  label: string;
  type: "toggle" | "button" | "summary";
}

export interface DesignTokenDebugReport {
  enabled: boolean;
  page: {
    id: string;
    label: string;
  };
  card: {
    id: string;
    label: string;
    components: DesignTokenDebugComponent[];
  };
  tokens: Record<SemanticTokenName, {
    expectedValue: string;
    resolvedValue: string;
    source: string;
    status: "resolved" | "fallback" | "legacy-whitelist";
    fallbackChain: string[];
    usedFallback: boolean;
    usedLegacyWhitelist: boolean;
  }>;
  mismatches: Array<{
    token: SemanticTokenName;
    actual: string;
    expected: string;
    whitelisted: boolean;
  }>;
  cascadingFailureRisk: {
    level: "none" | "medium" | "high";
    summary: string;
    impactedTokens: SemanticTokenName[];
  };
}

type PageCatalogEntry = {
  id: string;
  label: string;
  cards: Record<string, {
    id: string;
    label: string;
    components: DesignTokenDebugComponent[];
  }>;
};

type BuildDesignTokenDebugReportOptions = {
  enabled?: boolean;
  pageId?: string;
  cardId?: string;
  componentIds?: string[];
  tokenSources?: Record<string, string | null | undefined>;
  legacyWhitelist?: string[];
  root?: HTMLElement;
};

const BUG_COLOR_VALUES = new Set(["#0C3183"]);

const PAGE_CATALOG: Record<string, PageCatalogEntry> = {
  settings: {
    id: "settings",
    label: "Settings",
    cards: {
      "debug-log": {
        id: "debug-log",
        label: "Debug Log",
        components: [
          { id: "debug-toggle", label: "Enable Debug Logging", type: "toggle" },
          { id: "debug-clear", label: "Clear Debug Log", type: "button" },
          { id: "debug-send", label: "Send Debug Log to Cloud", type: "button" },
          { id: "debug-introspection", label: "Token Introspection", type: "summary" },
        ],
      },
    },
  },
};

const TOKEN_FALLBACKS: Record<SemanticTokenName, string[]> = {
  MAJOR: ["--cf-semantic-major", "--primary-bg", "--cf-accent"],
  MINOR: ["--cf-semantic-minor", "--primary-border", "--cf-accent-strong"],
  ACCENT: ["--cf-semantic-accent", "--on-accent", "--cf-text-on-accent"],
  SUCCESS: ["--cf-semantic-success", "--success-color", "--cf-success"],
  WARNING: ["--cf-semantic-warning", "--cf-warning"],
  ERROR: ["--cf-semantic-error", "--danger-bg", "--cf-danger"],
  INFO: ["--cf-semantic-info", "--cf-info"],
};

function normalizeHex(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return normalized.toUpperCase();
}

function resolveCatalog(pageId: string, cardId: string, componentIds?: string[]): { page: PageCatalogEntry; card: PageCatalogEntry["cards"][string] } {
  const page = PAGE_CATALOG[pageId] ?? PAGE_CATALOG.settings;
  const card = page.cards[cardId] ?? page.cards["debug-log"];

  if (!componentIds?.length) {
    return { page, card };
  }

  return {
    page,
    card: {
      ...card,
      components: card.components.filter((component) => componentIds.includes(component.id)),
    },
  };
}

function readRootTokenSources(root?: HTMLElement): Record<string, string> {
  if (root) {
    return Object.values(TOKEN_FALLBACKS)
      .flat()
      .reduce<Record<string, string>>((accumulator, variableName) => {
        accumulator[variableName] = root.style.getPropertyValue(variableName) || "";
        return accumulator;
      }, {});
  }

  if (typeof document === "undefined") {
    return {};
  }

  const element = document.documentElement;
  const computed = window.getComputedStyle(element);
  return Object.values(TOKEN_FALLBACKS)
    .flat()
    .reduce<Record<string, string>>((accumulator, variableName) => {
      accumulator[variableName] = element.style.getPropertyValue(variableName) || computed.getPropertyValue(variableName) || "";
      return accumulator;
    }, {});
}

export function applyAuthoritativeSemanticPalette(root?: HTMLElement): void {
  const target = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!target) {
    return;
  }

  target.style.setProperty("--cf-semantic-major", AUTHORITATIVE_SEMANTIC_PALETTE.MAJOR);
  target.style.setProperty("--cf-semantic-minor", AUTHORITATIVE_SEMANTIC_PALETTE.MINOR);
  target.style.setProperty("--cf-semantic-accent", AUTHORITATIVE_SEMANTIC_PALETTE.ACCENT);
  target.style.setProperty("--cf-semantic-success", AUTHORITATIVE_SEMANTIC_PALETTE.SUCCESS);
  target.style.setProperty("--cf-semantic-warning", AUTHORITATIVE_SEMANTIC_PALETTE.WARNING);
  target.style.setProperty("--cf-semantic-error", AUTHORITATIVE_SEMANTIC_PALETTE.ERROR);
  target.style.setProperty("--cf-semantic-info", AUTHORITATIVE_SEMANTIC_PALETTE.INFO);

  target.style.setProperty("--cf-accent", AUTHORITATIVE_SEMANTIC_PALETTE.MAJOR);
  target.style.setProperty("--cf-accent-strong", AUTHORITATIVE_SEMANTIC_PALETTE.MINOR);
  target.style.setProperty("--cf-text-on-accent", AUTHORITATIVE_SEMANTIC_PALETTE.ACCENT);
  target.style.setProperty("--cf-success", AUTHORITATIVE_SEMANTIC_PALETTE.SUCCESS);
  target.style.setProperty("--cf-warning", AUTHORITATIVE_SEMANTIC_PALETTE.WARNING);
  target.style.setProperty("--cf-danger", AUTHORITATIVE_SEMANTIC_PALETTE.ERROR);
  target.style.setProperty("--cf-info", AUTHORITATIVE_SEMANTIC_PALETTE.INFO);

  target.style.setProperty("--primary-bg", AUTHORITATIVE_SEMANTIC_PALETTE.MAJOR);
  target.style.setProperty("--primary-border", AUTHORITATIVE_SEMANTIC_PALETTE.MINOR);
  target.style.setProperty("--primary-bg-hover", AUTHORITATIVE_SEMANTIC_PALETTE.MINOR);
  target.style.setProperty("--on-accent", AUTHORITATIVE_SEMANTIC_PALETTE.ACCENT);
  target.style.setProperty("--success-color", AUTHORITATIVE_SEMANTIC_PALETTE.SUCCESS);
  target.style.setProperty("--danger-bg", AUTHORITATIVE_SEMANTIC_PALETTE.ERROR);
}

export function buildDesignTokenDebugReport(options: BuildDesignTokenDebugReportOptions = {}): DesignTokenDebugReport {
  const pageId = options.pageId ?? "settings";
  const cardId = options.cardId ?? "debug-log";
  const { page, card } = resolveCatalog(pageId, cardId, options.componentIds);
  const tokenSources = {
    ...readRootTokenSources(options.root),
    ...(options.tokenSources ?? {}),
  };
  const whitelist = new Set((options.legacyWhitelist ?? []).map((value) => normalizeHex(value)));
  const mismatches: DesignTokenDebugReport["mismatches"] = [];
  const tokens = {} as DesignTokenDebugReport["tokens"];

  (Object.entries(AUTHORITATIVE_SEMANTIC_PALETTE) as Array<[SemanticTokenName, string]>).forEach(([token, expectedValue]) => {
    const fallbackChain = TOKEN_FALLBACKS[token];
    const candidates = fallbackChain
      .map((sourceName) => ({ sourceName, value: normalizeHex(tokenSources[sourceName]) }))
      .filter((candidate) => candidate.value);
    const firstCandidate = candidates[0] ?? null;
    const matchingCandidate = candidates.find((candidate) => candidate.value === expectedValue) ?? null;
    const whitelistedCandidate = candidates.find((candidate) => whitelist.has(candidate.value)) ?? null;
    const resolvedValue = matchingCandidate?.value ?? (whitelistedCandidate?.value ?? expectedValue);
    const usedLegacyWhitelist = Boolean(whitelistedCandidate && !matchingCandidate);
    const usedFallback = resolvedValue !== (firstCandidate?.value ?? expectedValue);
    const status = matchingCandidate
      ? (matchingCandidate === firstCandidate ? "resolved" : "fallback")
      : usedLegacyWhitelist
        ? "legacy-whitelist"
        : "fallback";

    tokens[token] = {
      expectedValue,
      resolvedValue,
      source: matchingCandidate?.sourceName ?? whitelistedCandidate?.sourceName ?? "authoritative-default",
      status,
      fallbackChain,
      usedFallback,
      usedLegacyWhitelist,
    };

    const firstValue = firstCandidate?.value ?? "";
    const mismatched = firstValue && firstValue !== expectedValue;
    const shouldFlagMismatch = mismatched && !whitelist.has(firstValue);
    if (shouldFlagMismatch) {
      mismatches.push({
        token,
        actual: firstValue,
        expected: expectedValue,
        whitelisted: false,
      });
    }

    if (BUG_COLOR_VALUES.has(firstValue) && !whitelist.has(firstValue) && !mismatches.some((entry) => entry.token === token)) {
      mismatches.push({
        token,
        actual: firstValue,
        expected: expectedValue,
        whitelisted: false,
      });
    }
  });

  const impactedTokens = mismatches.map((entry) => entry.token);
  const cascadingFailureRisk = mismatches.length === 0
    ? {
        level: "none" as const,
        summary: "No cascading token failures detected.",
        impactedTokens: [] as SemanticTokenName[],
      }
    : mismatches.some((entry) => entry.token === "MAJOR" || entry.token === "MINOR") || mismatches.length > 1
      ? {
          level: "high" as const,
          summary: "Authoritative palette mismatch can cascade into page, card, and control styling.",
          impactedTokens,
        }
      : {
          level: "medium" as const,
          summary: "A token mismatch was detected, but the fallback chain contained the spread radius.",
          impactedTokens,
        };

  return {
    enabled: options.enabled ?? true,
    page: {
      id: page.id,
      label: page.label,
    },
    card: {
      id: card.id,
      label: card.label,
      components: card.components,
    },
    tokens,
    mismatches,
    cascadingFailureRisk,
  };
}

export function getDesignTokenDebugReport(options: Omit<BuildDesignTokenDebugReportOptions, "root"> = {}): DesignTokenDebugReport {
  return buildDesignTokenDebugReport({
    pageId: options.pageId ?? "settings",
    cardId: options.cardId ?? "debug-log",
    componentIds: options.componentIds,
    enabled: options.enabled ?? true,
    legacyWhitelist: options.legacyWhitelist,
    tokenSources: options.tokenSources,
    root: typeof document !== "undefined" ? document.documentElement : undefined,
  });
}
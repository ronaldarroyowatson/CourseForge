import { appendDebugLogEntry } from "./debugLogService";

export type MotionEasing = "ease-in" | "ease-out" | "ease-in-out";
export type DirectionalFlow = "left-to-right" | "right-to-left";
export type StrokePreset = "common" | "doubling" | "soft" | "ultra-thin" | "sweet-spot";
export type CardShadeMode = "auto" | "manual";
export type CardGradientFocus = "top" | "center" | "bottom" | "custom";
export type HarmonyMode = "mono" | "analogous" | "complementary" | "split-complementary" | "triadic";
export type SaturationMode = "free" | "locked";
export type BrandColorMode = "independent" | "derived";
export type SemanticPaletteRole = "major" | "minor" | "accent" | "success" | "warning" | "error" | "info";
export type DscComponentName = "buttons" | "alerts" | "badges" | "inputs" | "tokens";
export type DscInteractionState = "default" | "hover" | "active" | "disabled" | "focus";
export type SemanticTokenName =
  | "background"
  | "surface"
  | "border"
  | "text"
  | "textSubtle"
  | "accent"
  | "accentHover"
  | "accentActive"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "cardBackground"
  | "cardShadow"
  | "cardGlow"
  | "buttonPrimary"
  | "buttonSecondary"
  | "buttonGhost";

export const LEGACY_BRAND_BLUE = "#0C3183";
export const LEGACY_COLOR_MAP = {
  LEGACY_BRAND_BLUE,
} as const;

export const HARMONY_MODES: HarmonyMode[] = ["mono", "analogous", "complementary", "split-complementary", "triadic"];
export const SEMANTIC_PALETTE_ROLES: SemanticPaletteRole[] = ["major", "minor", "accent", "success", "warning", "error", "info"];
export const LOCKED_SEMANTIC_PALETTE: Record<SemanticPaletteRole, string> = {
  major: "#2563EB",
  minor: "#73A2F5",
  accent: "#FFFFFF",
  success: "#22C55E",
  warning: "#FACC15",
  error: "#EF4444",
  info: "#06B6D4",
};
export const SEMANTIC_TOKEN_NAMES: SemanticTokenName[] = [
  "background",
  "surface",
  "border",
  "text",
  "textSubtle",
  "accent",
  "accentHover",
  "accentActive",
  "success",
  "warning",
  "error",
  "info",
  "cardBackground",
  "cardShadow",
  "cardGlow",
  "buttonPrimary",
  "buttonSecondary",
  "buttonGhost",
];

export interface SemanticColors {
  major: string;
  minor: string;
  accent: string;
  error: string;
  success: string;
  warning: string;
  info: string;
  pending: string;
  new: string;
}

export interface DscDebugResolutionRecord {
  id: string;
  timestamp: number;
  semanticRole: SemanticPaletteRole;
  sourcePath: string;
  requestedValue: string;
  computedValue: string;
  fallbackChain: string[];
  reasonForFallback: string | null;
  component: DscComponentName;
  interactionState: DscInteractionState;
  contrastRatio: number;
  themeMode: "light" | "dark";
  requestedToken: string;
  resolvedToken: string;
  computedColor: string;
  componentName: DscComponentName;
  componentState: DscInteractionState;
  contrastAgainstBackground: number;
  contrastAcceptable: boolean;
  cascadingFailureRisk: boolean;
}

export interface DscCascadingFailureRisk {
  code:
    | "missing-token"
    | "invalid-hex"
    | "low-contrast"
    | "unexpected-fallback"
    | "harmony-override-attempt"
    | "cross-mode-inconsistency"
    | "token-drift"
    | "legacy-color-use";
  message: string;
  token: string;
  component: DscComponentName;
  state: DscInteractionState;
  themeMode: "light" | "dark";
}

export interface DscDebugReport {
  generatedAt: string;
  debugMode: boolean;
  palette: Record<SemanticPaletteRole, string>;
  semanticTokens: {
    roles: Record<SemanticPaletteRole, string>;
    resolved: Record<SemanticTokenName, string>;
  };
  cssVariablesSnapshot: Record<string, string>;
  componentTokenMaps: Record<string, Record<string, string>>;
  fallbackRecords: DscDebugResolutionRecord[];
  contrastChecks: Array<{
    component: DscComponentName;
    interactionState: DscInteractionState;
    foreground: string;
    background: string;
    ratio: number;
    themeMode: "light" | "dark";
  }>;
  cascadingFailureSummary: {
    riskCount: number;
    risks: DscCascadingFailureRisk[];
  };
  uiIntrospection: {
    pages: DscPageIntrospection[];
  };
  themeGeneration: {
    mode: "light" | "dark";
    harmony: DesignTokens["harmony"];
    semantic: DesignTokens["color"]["semantic"];
  };
}

export interface DscComponentIntrospection {
  componentId: string;
  componentType: "title" | "text" | "button" | "toggle" | "input" | "other";
  tokenSet: {
    background: string;
    border: string;
    text: string;
  };
  computed: {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
  };
  fallbacksUsed: string[];
  mismatches: string[];
}

export interface DscCardIntrospection {
  pageId: string;
  cardId: string;
  cardType: "status" | "settings" | "title" | "dsc" | "example" | "unknown";
  recipeName: string;
  expectedTokenSet: {
    background: SemanticTokenName;
    border: SemanticTokenName;
    titleText: SemanticTokenName;
    bodyText: SemanticTokenName;
  };
  actualTokenSet: {
    background: string;
    border: string;
    titleText: string;
    bodyText: string;
  };
  backgroundColor: string;
  borderColor: string;
  titleTextColor: string;
  bodyTextColor: string;
  buttonTypes: string[];
  buttonTokenSets: Array<{
    type: string;
    expectedTokenSet: {
      background: SemanticTokenName;
      border: SemanticTokenName;
      text: SemanticTokenName;
    };
    computed: {
      backgroundColor: string;
      borderColor: string;
      textColor: string;
    };
  }>;
  fallbacksUsed: string[];
  mismatches: string[];
  legacyColorUsage: string[];
  components: DscComponentIntrospection[];
}

export interface DscPageIntrospection {
  pageId: string;
  cards: DscCardIntrospection[];
}

export type SemanticAssignments = Record<SemanticTokenName, SemanticPaletteRole>;

export interface ColorRoleRamp {
  hue: number;
  saturation: number;
  shades: string[];
}

export interface DesignTokenPreferences {
  gamma: number;
  typeRatio: number;
  strokePreset: StrokePreset;
  spacingRatio: number;
  motionTimingMs: number;
  motionEasing: MotionEasing;
  primaryHue: number;
  semanticColors: SemanticColors;
  useSystemDefaults: boolean;
  directionalFlow: DirectionalFlow;
  cardBaseShade: number;
  cardShadowOffsetMode: CardShadeMode;
  cardShadowOffset: number;
  cardGlowOffsetMode: CardShadeMode;
  cardGlowOffset: number;
  cardStrokeSize: number;
  cardStrokeRole: SemanticPaletteRole;
  cardGradientEnabled: boolean;
  cardGradientStart: string;
  cardGradientEnd: string;
  cardGradientStrength: number;
  cardGradientAngle: number;
  cardGradientFocus: CardGradientFocus;
  cardGradientFocusX: number;
  cardGradientFocusY: number;
  cardGradientScale: number;
  cardOverlayEnabled: boolean;
  cardOverlayStrength: number;
  cardOverlayRole: SemanticPaletteRole;
  settingsBaseLightLuminance: number;
  settingsBaseDarkLuminance: number;
  cardCornerRadius: number;
  boxCornerRadius: number;
  cardPaddingIndex: number;
  cardHeight: number;
  // Dual-mode card rules
  darkModeGlowIntensity: number;
  darkModeGlowRadius: number;
  lightModeShadowIntensity: number;
  lightModeShadowRadius: number;
  // Color harmony system
  colorHarmonyMode: HarmonyMode;
  colorHarmonyBaseHue: number;
  colorHarmonyBrandHue: number;
  colorHarmonySaturationMode: SaturationMode;
  colorHarmonySaturation: number;
  colorHarmonyBrandMode: BrandColorMode;
  semanticAssignments: SemanticAssignments;
  // Button behaviors
  buttonHoverEnabled: boolean;
  buttonSquishEnabled: boolean;
  buttonPressEnabled: boolean;
  buttonRippleEnabled: boolean;
  buttonDepthIntensity: number;
  buttonDepthRadius: number;
  buttonCornerRadius: number;
  useUnifiedCornerRadius: boolean;
}

export interface DesignTokens {
  color: {
    primary: string[];
    semantic: SemanticColors;
    roles: Record<SemanticPaletteRole, ColorRoleRamp>;
    assignments: SemanticAssignments;
    resolved: Record<SemanticTokenName, string>;
    zLuminanceByHeight: Record<number, string>;
  };
  type: {
    base: number;
    ratio: number;
    body: number;
    subheading: number;
    heading: number;
    title: number;
    scale: Record<"text-lg" | "text-2xl" | "text-3xl" | "text-4xl" | "text-5xl", number>;
  };
  stroke: {
    preset: StrokePreset;
    values: number[];
  };
  spacing: {
    base: number;
    ratio: number;
    values: number[];
  };
  motion: {
    timingMs: number;
    easing: MotionEasing;
    presets: {
      micro: number;
      default: number;
      xl: number;
    };
  };
  states: {
    hoverOpacity: number;
    activeOpacity: number;
    disabledOpacity: number;
    loadingOpacity: number;
  };
  card: {
    baseShade: number;
    shadowOffset: number;
    glowOffset: number;
    shadowShade: number;
    glowShade: number;
    strokeSize: number;
    strokeColor: string;
    gradientEnabled: boolean;
    gradientStart: string;
    gradientEnd: string;
    gradientStrength: number;
    gradientAngle: number;
    gradientFocus: string;
    gradientScale: number;
    overlayEnabled: boolean;
    overlayColor: string;
    overlayStrength: number;
    settingsBaseLightLuminance: number;
    settingsBaseDarkLuminance: number;
    cornerRadius: number;
    padding: number;
    height: number;
    darkModeGlowIntensity: number;
    darkModeGlowRadius: number;
    lightModeShadowIntensity: number;
    lightModeShadowRadius: number;
    colors: {
      base: string;
      shadow: string;
      glow: string;
    };
  };
  harmony: {
    mode: HarmonyMode;
    baseHue: number;
    brandHue: number;
    effectiveBrandHue: number;
    saturationMode: SaturationMode;
    saturation: number;
    majorHue: number;
    minorHue: number;
    accentHue: number;
    highlightHue: number;
    colors: {
      major: string;
      minor: string;
      accent: string;
      highlight: string;
    };
  };
  component: {
    buttonPrimary: {
      background: string;
      border: string;
      text: string;
      hover: string;
      active: string;
      disabled: string;
      focusRing: string;
    };
    buttonSecondary: {
      background: string;
      border: string;
      text: string;
      hover: string;
      active: string;
      disabled: string;
      focusRing: string;
    };
    buttonGhost: {
      background: string;
      border: string;
      text: string;
      hover: string;
      active: string;
      disabled: string;
      focusRing: string;
    };
    alert: {
      success: string;
      warning: string;
      error: string;
      info: string;
      text: string;
    };
    badge: {
      success: string;
      warning: string;
      error: string;
      info: string;
      text: string;
    };
    input: {
      background: string;
      border: string;
      text: string;
      focusRing: string;
      hoverBorder: string;
      activeBorder: string;
      disabledBackground: string;
    };
    card: {
      background: string;
      shadow: string;
      glow: string;
      border: string;
    };
  };
  button: {
    hoverEnabled: boolean;
    squishEnabled: boolean;
    pressEnabled: boolean;
    rippleEnabled: boolean;
    depthIntensity: number;
    depthRadius: number;
    cornerRadius: number;
  };
}

const DESIGN_TOKENS_STORAGE_KEY = "courseforge.designTokens.v1";
const DESIGN_TOKENS_BACKUP_KEY = "courseforge.designTokens.corruptedBackup.v1";
const DESIGN_TOKENS_FIRST_RUN_KEY = "courseforge.designTokens.firstRunComplete.v1";
const DESIGN_TOKENS_PROFILE_KEY = "courseforge.designTokens.profile.v1";
const DESIGN_TOKENS_PROFILE_VERSION = "semantic-unified-v2";

export type CloudSettingsDecision = "apply-cloud" | "keep-local" | "merge-local-into-cloud" | "delete-cloud-use-local-defaults";

export interface DesignTokenValidationResult {
  valid: boolean;
  invalidFields: string[];
  repaired: DesignTokenPreferences;
}

export interface FirstRunDetectionTraceEntry {
  step: string;
  status: "success" | "failure" | "fallback";
  message: string;
  details?: Record<string, unknown>;
}

export interface FirstRunResolution {
  preferences: DesignTokenPreferences;
  source: "local" | "system" | "default";
  detectedSystem: Record<string, unknown>;
  failedSystem: Record<string, string>;
  traces: FirstRunDetectionTraceEntry[];
}

const STROKE_PRESETS: Record<StrokePreset, number[]> = {
  common: [1, 1.5, 2],
  doubling: [1, 2, 4],
  soft: [1, 1.25, 1.5],
  "ultra-thin": [0.5, 1, 2, 3],
  "sweet-spot": [1, 1.5, 2, 3],
};

const DEFAULT_SEMANTIC_ASSIGNMENTS: SemanticAssignments = {
  background: "major",
  surface: "major",
  border: "minor",
  text: "accent",
  textSubtle: "accent",
  accent: "accent",
  accentHover: "accent",
  accentActive: "accent",
  success: "success",
  warning: "warning",
  error: "error",
  info: "info",
  cardBackground: "major",
  cardShadow: "minor",
  cardGlow: "accent",
  buttonPrimary: "major",
  buttonSecondary: "minor",
  buttonGhost: "major",
};

const SEMANTIC_TOKEN_SHADE_INDEX: Record<SemanticTokenName, number> = {
  background: 0,
  surface: 2,
  border: 4,
  text: 8,
  textSubtle: 6,
  accent: 4,
  accentHover: 5,
  accentActive: 3,
  success: 4,
  warning: 4,
  error: 4,
  info: 4,
  cardBackground: 2,
  cardShadow: 1,
  cardGlow: 3,
  buttonPrimary: 4,
  buttonSecondary: 2,
  buttonGhost: 1,
};

export const DEFAULT_DESIGN_TOKEN_PREFERENCES: DesignTokenPreferences = {
  gamma: 2.2,
  typeRatio: 1.25,
  strokePreset: "sweet-spot",
  spacingRatio: 1.25,
  motionTimingMs: 300,
  motionEasing: "ease-in-out",
  primaryHue: 221.2,
  semanticColors: {
    major: LOCKED_SEMANTIC_PALETTE.major,
    minor: LOCKED_SEMANTIC_PALETTE.minor,
    accent: LOCKED_SEMANTIC_PALETTE.accent,
    error: LOCKED_SEMANTIC_PALETTE.error,
    success: LOCKED_SEMANTIC_PALETTE.success,
    warning: LOCKED_SEMANTIC_PALETTE.warning,
    info: LOCKED_SEMANTIC_PALETTE.info,
    pending: LOCKED_SEMANTIC_PALETTE.warning,
    new: LOCKED_SEMANTIC_PALETTE.info,
  },
  useSystemDefaults: false,
  directionalFlow: "left-to-right",
  cardBaseShade: 3,
  cardShadowOffsetMode: "auto",
  cardShadowOffset: -2,
  cardGlowOffsetMode: "auto",
  cardGlowOffset: 2,
  cardStrokeSize: 1,
  cardStrokeRole: "minor",
  cardGradientEnabled: true,
  cardGradientStart: "major+3",
  cardGradientEnd: "major",
  cardGradientStrength: 7,
  cardGradientAngle: 155,
  cardGradientFocus: "top",
  cardGradientFocusX: 50,
  cardGradientFocusY: 24,
  cardGradientScale: 1,
  cardOverlayEnabled: false,
  cardOverlayStrength: 3,
  cardOverlayRole: "major",
  settingsBaseLightLuminance: 98,
  settingsBaseDarkLuminance: 4,
  cardCornerRadius: 12,
  boxCornerRadius: 10,
  cardPaddingIndex: 4,
  cardHeight: 220,
  darkModeGlowIntensity: 6,
  darkModeGlowRadius: 18,
  lightModeShadowIntensity: 5,
  lightModeShadowRadius: 14,
  colorHarmonyMode: "mono",
  colorHarmonyBaseHue: 221.2,
  colorHarmonyBrandHue: 221.2,
  colorHarmonySaturationMode: "free",
  colorHarmonySaturation: 83,
  colorHarmonyBrandMode: "independent",
  semanticAssignments: DEFAULT_SEMANTIC_ASSIGNMENTS,
  buttonHoverEnabled: true,
  buttonSquishEnabled: true,
  buttonPressEnabled: true,
  buttonRippleEnabled: true,
  buttonDepthIntensity: 5,
  buttonDepthRadius: 12,
  buttonCornerRadius: 10,
  useUnifiedCornerRadius: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampShade(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.round(clamp(value, 1, 9));
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.round(clamp(value, min, max));
}

function clampCardOffset(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  return clamp(rounded, min, max);
}

function normalizeCardGradientFocus(value: unknown): CardGradientFocus {
  return value === "top" || value === "center" || value === "bottom" || value === "custom"
    ? value
    : "top";
}

function resolveCardGradientFocusValue(preferences: DesignTokenPreferences): string {
  if (preferences.cardGradientFocus === "custom") {
    return `${preferences.cardGradientFocusX}% ${preferences.cardGradientFocusY}%`;
  }

  if (preferences.cardGradientFocus === "center") {
    return "50% 50%";
  }

  if (preferences.cardGradientFocus === "bottom") {
    return "50% 85%";
  }

  return "50% 15%";
}

function parseRoleTokenReference(value: string): { role: SemanticPaletteRole; offset: number } | null {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(major|minor|accent|success|warning|error|info)(?:([+-])(\d))?$/);
  if (!match) {
    return null;
  }

  const role = match[1] as SemanticPaletteRole;
  const operator = match[2];
  const amount = Number(match[3] ?? 0);
  const offset = operator === "-" ? -amount : amount;
  return {
    role,
    offset,
  };
}

function resolveRoleTokenColor(
  value: string,
  roleRamps: Record<SemanticPaletteRole, ColorRoleRamp>,
  fallback: string,
): string {
  const parsed = parseRoleTokenReference(value);
  if (!parsed) {
    return fallback;
  }

  const shades = roleRamps[parsed.role].shades;
  const index = clamp(4 + parsed.offset, 0, shades.length - 1);
  return shades[index] ?? fallback;
}

function parseHexColor(value: string, fallback: string): string {
  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
}

function toHex(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, "0");
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 1);
  const lightness = clamp(l, 0, 1);

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return `#${toHex((r + m) * 255)}${toHex((g + m) * 255)}${toHex((b + m) * 255)}`;
}

function hexToHue(value: string): number | null {
  const normalized = value.trim();
  const match = normalized.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    return null;
  }

  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  if (delta === 0) {
    return 0;
  }

  let hue = 0;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return normalizeHue(hue * 60);
}

function blendHue(fromHue: number, toHue: number, ratio: number): number {
  const start = ((fromHue % 360) + 360) % 360;
  const end = ((toHue % 360) + 360) % 360;
  const delta = ((((end - start) % 360) + 540) % 360) - 180;
  return ((start + delta * clamp(ratio, 0, 1)) % 360 + 360) % 360;
}

function normalizeHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizeSemanticAssignments(input: Partial<SemanticAssignments> | null | undefined): SemanticAssignments {
  const next = input ?? {};
  const resolved = { ...DEFAULT_SEMANTIC_ASSIGNMENTS };

  for (const token of SEMANTIC_TOKEN_NAMES) {
    const candidate = next[token];
    if (candidate && SEMANTIC_PALETTE_ROLES.includes(candidate)) {
      resolved[token] = candidate;
    }
  }

  return resolved;
}

function buildSemanticColors(input: Partial<SemanticColors> | null | undefined): SemanticColors {
  const semantic = input ?? {};
  const warning = parseHexColor(semantic.warning ?? semantic.pending ?? "", LOCKED_SEMANTIC_PALETTE.warning);
  const info = parseHexColor(semantic.info ?? semantic.new ?? "", LOCKED_SEMANTIC_PALETTE.info);

  // Harmony controls are visualization-only. Semantic palette roles remain locked and authoritative.
  return {
    major: LOCKED_SEMANTIC_PALETTE.major,
    minor: LOCKED_SEMANTIC_PALETTE.minor,
    accent: LOCKED_SEMANTIC_PALETTE.accent,
    error: parseHexColor(semantic.error ?? "", LOCKED_SEMANTIC_PALETTE.error),
    success: parseHexColor(semantic.success ?? "", LOCKED_SEMANTIC_PALETTE.success),
    warning,
    info,
    pending: warning,
    new: info,
  };
}

function generateHarmonyHues(baseHue: number, mode: HarmonyMode): {
  majorHue: number;
  minorHue: number;
  accentHue: number;
  highlightHue: number;
} {
  const h = normalizeHue(baseHue);

  switch (mode) {
    case "mono":
      return {
        majorHue: h,
        minorHue: h,
        accentHue: h,
        highlightHue: h,
      };
    case "analogous":
      return {
        majorHue: h,
        minorHue: normalizeHue(h + 30),
        accentHue: normalizeHue(h - 30),
        highlightHue: normalizeHue(h + 15),
      };
    case "complementary":
      return {
        majorHue: h,
        minorHue: normalizeHue(h + 180),
        accentHue: normalizeHue(h + 180),
        highlightHue: normalizeHue(h + 180),
      };
    case "split-complementary":
      return {
        majorHue: h,
        minorHue: normalizeHue(h + 150),
        accentHue: normalizeHue(h + 210),
        highlightHue: normalizeHue(h + 180),
      };
    case "triadic":
      return {
        majorHue: h,
        minorHue: normalizeHue(h + 120),
        accentHue: normalizeHue(h + 240),
        highlightHue: normalizeHue(h + 120),
      };
    default:
      return {
        majorHue: h,
        minorHue: normalizeHue(h + 180),
        accentHue: normalizeHue(h + 180),
        highlightHue: normalizeHue(h + 180),
      };
  }
}

export function sanitizeDesignTokenPreferences(input: Partial<DesignTokenPreferences> | null | undefined): DesignTokenPreferences {
  const next = input ?? {};
  const cardBaseShade = clampShade(next.cardBaseShade ?? DEFAULT_DESIGN_TOKEN_PREFERENCES.cardBaseShade, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardBaseShade);
  const rawShadowMode = (next as Partial<DesignTokenPreferences> & { cardShadowShadeMode?: CardShadeMode }).cardShadowShadeMode;
  const rawGlowMode = (next as Partial<DesignTokenPreferences> & { cardGlowShadeMode?: CardShadeMode }).cardGlowShadeMode;
  const cardShadowOffsetMode = next.cardShadowOffsetMode === "manual" || rawShadowMode === "manual" ? "manual" : "auto";
  const cardGlowOffsetMode = next.cardGlowOffsetMode === "manual" || rawGlowMode === "manual" ? "manual" : "auto";
  const legacyShadowShade = clampShade(
    (next as Partial<DesignTokenPreferences> & { cardShadowShade?: number }).cardShadowShade ?? cardBaseShade - 1,
    cardBaseShade - 1,
  );
  const legacyGlowShade = clampShade(
    (next as Partial<DesignTokenPreferences> & { cardGlowShade?: number }).cardGlowShade ?? cardBaseShade + 1,
    cardBaseShade + 1,
  );
  const inferredShadowOffset = clampCardOffset(legacyShadowShade - cardBaseShade, -4, -1, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardShadowOffset);
  const inferredGlowOffset = clampCardOffset(legacyGlowShade - cardBaseShade, 1, 4, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGlowOffset);
  const cardShadowOffset = clampCardOffset(next.cardShadowOffset ?? inferredShadowOffset, -4, -1, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardShadowOffset);
  const cardGlowOffset = clampCardOffset(next.cardGlowOffset ?? inferredGlowOffset, 1, 4, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGlowOffset);
  const cardStrokeRole = SEMANTIC_PALETTE_ROLES.includes(next.cardStrokeRole as SemanticPaletteRole)
    ? (next.cardStrokeRole as SemanticPaletteRole)
    : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardStrokeRole;
  const cardOverlayRole = SEMANTIC_PALETTE_ROLES.includes(next.cardOverlayRole as SemanticPaletteRole)
    ? (next.cardOverlayRole as SemanticPaletteRole)
    : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardOverlayRole;

  return {
    gamma: clamp(typeof next.gamma === "number" ? next.gamma : DEFAULT_DESIGN_TOKEN_PREFERENCES.gamma, 1.6, 2.6),
    typeRatio: clamp(typeof next.typeRatio === "number" ? next.typeRatio : DEFAULT_DESIGN_TOKEN_PREFERENCES.typeRatio, 1.067, 1.5),
    strokePreset: typeof next.strokePreset === "string" && next.strokePreset in STROKE_PRESETS
      ? (next.strokePreset as StrokePreset)
      : DEFAULT_DESIGN_TOKEN_PREFERENCES.strokePreset,
    spacingRatio: clamp(typeof next.spacingRatio === "number" ? next.spacingRatio : DEFAULT_DESIGN_TOKEN_PREFERENCES.spacingRatio, 1.25, 2),
    motionTimingMs: clamp(typeof next.motionTimingMs === "number" ? next.motionTimingMs : DEFAULT_DESIGN_TOKEN_PREFERENCES.motionTimingMs, 100, 500),
    motionEasing: next.motionEasing === "ease-in" || next.motionEasing === "ease-out" || next.motionEasing === "ease-in-out"
      ? next.motionEasing
      : DEFAULT_DESIGN_TOKEN_PREFERENCES.motionEasing,
    primaryHue: clamp(typeof next.primaryHue === "number" ? next.primaryHue : DEFAULT_DESIGN_TOKEN_PREFERENCES.primaryHue, 0, 360),
    semanticColors: buildSemanticColors(next.semanticColors),
    useSystemDefaults: Boolean(next.useSystemDefaults),
    directionalFlow:
      next.directionalFlow === "left-to-right" || next.directionalFlow === "right-to-left"
        ? next.directionalFlow
        : DEFAULT_DESIGN_TOKEN_PREFERENCES.directionalFlow,
    cardBaseShade,
    cardShadowOffsetMode,
    cardShadowOffset,
    cardGlowOffsetMode,
    cardGlowOffset,
    cardStrokeSize: clamp(typeof next.cardStrokeSize === "number" ? next.cardStrokeSize : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardStrokeSize, 0, 3),
    cardStrokeRole,
    cardGradientEnabled: typeof next.cardGradientEnabled === "boolean" ? next.cardGradientEnabled : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientEnabled,
    cardGradientStart: typeof next.cardGradientStart === "string" ? next.cardGradientStart : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientStart,
    cardGradientEnd: typeof next.cardGradientEnd === "string" ? next.cardGradientEnd : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientEnd,
    cardGradientStrength: clamp(typeof next.cardGradientStrength === "number" ? next.cardGradientStrength : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientStrength, 0, 20),
    cardGradientAngle: clampInteger(typeof next.cardGradientAngle === "number" ? next.cardGradientAngle : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientAngle, 0, 360, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientAngle),
    cardGradientFocus: normalizeCardGradientFocus(next.cardGradientFocus),
    cardGradientFocusX: clampInteger(typeof next.cardGradientFocusX === "number" ? next.cardGradientFocusX : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientFocusX, 0, 100, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientFocusX),
    cardGradientFocusY: clampInteger(typeof next.cardGradientFocusY === "number" ? next.cardGradientFocusY : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientFocusY, 0, 100, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientFocusY),
    cardGradientScale: clamp(typeof next.cardGradientScale === "number" ? next.cardGradientScale : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientScale, 0.5, 3),
    cardOverlayEnabled: typeof next.cardOverlayEnabled === "boolean" ? next.cardOverlayEnabled : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardOverlayEnabled,
    cardOverlayStrength: clamp(typeof next.cardOverlayStrength === "number" ? next.cardOverlayStrength : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardOverlayStrength, 0, 10),
    cardOverlayRole,
    settingsBaseLightLuminance: clamp(typeof next.settingsBaseLightLuminance === "number" ? next.settingsBaseLightLuminance : DEFAULT_DESIGN_TOKEN_PREFERENCES.settingsBaseLightLuminance, 92, 100),
    settingsBaseDarkLuminance: clamp(typeof next.settingsBaseDarkLuminance === "number" ? next.settingsBaseDarkLuminance : DEFAULT_DESIGN_TOKEN_PREFERENCES.settingsBaseDarkLuminance, 0, 8),
    cardCornerRadius: clamp(typeof next.cardCornerRadius === "number" ? next.cardCornerRadius : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardCornerRadius, 4, 40),
    boxCornerRadius: clamp(typeof next.boxCornerRadius === "number" ? next.boxCornerRadius : DEFAULT_DESIGN_TOKEN_PREFERENCES.boxCornerRadius, 4, 40),
    cardPaddingIndex: clamp(Math.round(typeof next.cardPaddingIndex === "number" ? next.cardPaddingIndex : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardPaddingIndex), 0, 5),
    cardHeight: clamp(typeof next.cardHeight === "number" ? next.cardHeight : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardHeight, 140, 460),
    darkModeGlowIntensity: clamp(typeof next.darkModeGlowIntensity === "number" ? next.darkModeGlowIntensity : DEFAULT_DESIGN_TOKEN_PREFERENCES.darkModeGlowIntensity, 0, 10),
    darkModeGlowRadius: clamp(typeof next.darkModeGlowRadius === "number" ? next.darkModeGlowRadius : DEFAULT_DESIGN_TOKEN_PREFERENCES.darkModeGlowRadius, 4, 48),
    lightModeShadowIntensity: clamp(typeof next.lightModeShadowIntensity === "number" ? next.lightModeShadowIntensity : DEFAULT_DESIGN_TOKEN_PREFERENCES.lightModeShadowIntensity, 0, 10),
    lightModeShadowRadius: clamp(typeof next.lightModeShadowRadius === "number" ? next.lightModeShadowRadius : DEFAULT_DESIGN_TOKEN_PREFERENCES.lightModeShadowRadius, 4, 48),
    colorHarmonyMode: HARMONY_MODES.includes(next.colorHarmonyMode as HarmonyMode)
      ? (next.colorHarmonyMode as HarmonyMode)
      : DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyMode,
    colorHarmonyBaseHue: clamp(typeof next.colorHarmonyBaseHue === "number" ? next.colorHarmonyBaseHue : DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBaseHue, 0, 360),
    colorHarmonyBrandHue: clamp(typeof next.colorHarmonyBrandHue === "number" ? next.colorHarmonyBrandHue : DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBrandHue, 0, 360),
    colorHarmonySaturationMode: next.colorHarmonySaturationMode === "locked" ? "locked" : "free",
    colorHarmonySaturation: clamp(typeof next.colorHarmonySaturation === "number" ? next.colorHarmonySaturation : DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonySaturation, 0, 100),
    colorHarmonyBrandMode: next.colorHarmonyBrandMode === "derived" ? "derived" : "independent",
    semanticAssignments: normalizeSemanticAssignments(next.semanticAssignments),
    buttonHoverEnabled: typeof next.buttonHoverEnabled === "boolean" ? next.buttonHoverEnabled : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonHoverEnabled,
    buttonSquishEnabled: typeof next.buttonSquishEnabled === "boolean" ? next.buttonSquishEnabled : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonSquishEnabled,
    buttonPressEnabled: typeof next.buttonPressEnabled === "boolean" ? next.buttonPressEnabled : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonPressEnabled,
    buttonRippleEnabled: typeof next.buttonRippleEnabled === "boolean" ? next.buttonRippleEnabled : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonRippleEnabled,
    buttonDepthIntensity: clamp(typeof next.buttonDepthIntensity === "number" ? next.buttonDepthIntensity : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonDepthIntensity, 0, 10),
    buttonDepthRadius: clamp(typeof next.buttonDepthRadius === "number" ? next.buttonDepthRadius : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonDepthRadius, 4, 32),
    buttonCornerRadius: clamp(typeof next.buttonCornerRadius === "number" ? next.buttonCornerRadius : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonCornerRadius, 4, 40),
    useUnifiedCornerRadius: typeof next.useUnifiedCornerRadius === "boolean" ? next.useUnifiedCornerRadius : DEFAULT_DESIGN_TOKEN_PREFERENCES.useUnifiedCornerRadius,
  };
}

export function validateDesignTokenPreferences(input: unknown): DesignTokenValidationResult {
  const invalidFields: string[] = [];

  const candidate = (typeof input === "object" && input !== null)
    ? (input as Partial<DesignTokenPreferences>)
    : {};

  if (typeof candidate.gamma !== "number" || candidate.gamma < 1.6 || candidate.gamma > 2.6) {
    invalidFields.push("gamma");
  }

  if (typeof candidate.typeRatio !== "number" || candidate.typeRatio < 1.067 || candidate.typeRatio > 1.5) {
    invalidFields.push("typeRatio");
  }

  if (typeof candidate.spacingRatio !== "number" || candidate.spacingRatio < 1.25 || candidate.spacingRatio > 2) {
    invalidFields.push("spacingRatio");
  }

  if (typeof candidate.motionTimingMs !== "number" || candidate.motionTimingMs < 100 || candidate.motionTimingMs > 500) {
    invalidFields.push("motionTimingMs");
  }

  if (candidate.motionEasing !== "ease-in" && candidate.motionEasing !== "ease-out" && candidate.motionEasing !== "ease-in-out") {
    invalidFields.push("motionEasing");
  }

  if (typeof candidate.primaryHue !== "number" || candidate.primaryHue < 0 || candidate.primaryHue > 360) {
    invalidFields.push("primaryHue");
  }

  if (typeof candidate.strokePreset !== "string" || !(candidate.strokePreset in STROKE_PRESETS)) {
    invalidFields.push("strokePreset");
  }

  if (candidate.directionalFlow !== "left-to-right" && candidate.directionalFlow !== "right-to-left") {
    invalidFields.push("directionalFlow");
  }

  if (typeof candidate.cardBaseShade !== "number" || candidate.cardBaseShade < 1 || candidate.cardBaseShade > 9) {
    invalidFields.push("cardBaseShade");
  }

  if (candidate.cardShadowOffsetMode !== "auto" && candidate.cardShadowOffsetMode !== "manual") {
    invalidFields.push("cardShadowOffsetMode");
  }

  if (typeof candidate.cardShadowOffset !== "number" || candidate.cardShadowOffset < -4 || candidate.cardShadowOffset > -1) {
    invalidFields.push("cardShadowOffset");
  }

  if (candidate.cardGlowOffsetMode !== "auto" && candidate.cardGlowOffsetMode !== "manual") {
    invalidFields.push("cardGlowOffsetMode");
  }

  if (typeof candidate.cardGlowOffset !== "number" || candidate.cardGlowOffset < 1 || candidate.cardGlowOffset > 4) {
    invalidFields.push("cardGlowOffset");
  }

  if (typeof candidate.cardStrokeSize !== "number" || candidate.cardStrokeSize < 0 || candidate.cardStrokeSize > 3) {
    invalidFields.push("cardStrokeSize");
  }

  if (!SEMANTIC_PALETTE_ROLES.includes(candidate.cardStrokeRole as SemanticPaletteRole)) {
    invalidFields.push("cardStrokeRole");
  }

  if (typeof candidate.cardGradientEnabled !== "boolean") {
    invalidFields.push("cardGradientEnabled");
  }

  if (typeof candidate.cardGradientStart !== "string") {
    invalidFields.push("cardGradientStart");
  }

  if (typeof candidate.cardGradientEnd !== "string") {
    invalidFields.push("cardGradientEnd");
  }

  if (typeof candidate.cardGradientStrength !== "number" || candidate.cardGradientStrength < 0 || candidate.cardGradientStrength > 20) {
    invalidFields.push("cardGradientStrength");
  }

  if (typeof candidate.cardGradientAngle !== "number" || candidate.cardGradientAngle < 0 || candidate.cardGradientAngle > 360) {
    invalidFields.push("cardGradientAngle");
  }

  if (candidate.cardGradientFocus !== "top" && candidate.cardGradientFocus !== "center" && candidate.cardGradientFocus !== "bottom" && candidate.cardGradientFocus !== "custom") {
    invalidFields.push("cardGradientFocus");
  }

  if (typeof candidate.cardGradientFocusX !== "number" || candidate.cardGradientFocusX < 0 || candidate.cardGradientFocusX > 100) {
    invalidFields.push("cardGradientFocusX");
  }

  if (typeof candidate.cardGradientFocusY !== "number" || candidate.cardGradientFocusY < 0 || candidate.cardGradientFocusY > 100) {
    invalidFields.push("cardGradientFocusY");
  }

  if (typeof candidate.cardGradientScale !== "number" || candidate.cardGradientScale < 0.5 || candidate.cardGradientScale > 3) {
    invalidFields.push("cardGradientScale");
  }

  if (typeof candidate.cardOverlayEnabled !== "boolean") {
    invalidFields.push("cardOverlayEnabled");
  }

  if (typeof candidate.cardOverlayStrength !== "number" || candidate.cardOverlayStrength < 0 || candidate.cardOverlayStrength > 10) {
    invalidFields.push("cardOverlayStrength");
  }

  if (!SEMANTIC_PALETTE_ROLES.includes(candidate.cardOverlayRole as SemanticPaletteRole)) {
    invalidFields.push("cardOverlayRole");
  }

  if (typeof candidate.settingsBaseLightLuminance !== "number" || candidate.settingsBaseLightLuminance < 92 || candidate.settingsBaseLightLuminance > 100) {
    invalidFields.push("settingsBaseLightLuminance");
  }

  if (typeof candidate.settingsBaseDarkLuminance !== "number" || candidate.settingsBaseDarkLuminance < 0 || candidate.settingsBaseDarkLuminance > 8) {
    invalidFields.push("settingsBaseDarkLuminance");
  }

  if (typeof candidate.cardCornerRadius !== "number" || candidate.cardCornerRadius < 4 || candidate.cardCornerRadius > 40) {
    invalidFields.push("cardCornerRadius");
  }

  if (typeof candidate.boxCornerRadius !== "number" || candidate.boxCornerRadius < 4 || candidate.boxCornerRadius > 40) {
    invalidFields.push("boxCornerRadius");
  }

  if (typeof candidate.cardPaddingIndex !== "number" || candidate.cardPaddingIndex < 0 || candidate.cardPaddingIndex > 5) {
    invalidFields.push("cardPaddingIndex");
  }

  if (typeof candidate.cardHeight !== "number" || candidate.cardHeight < 140 || candidate.cardHeight > 460) {
    invalidFields.push("cardHeight");
  }

  if (typeof candidate.darkModeGlowIntensity !== "number" || candidate.darkModeGlowIntensity < 0 || candidate.darkModeGlowIntensity > 10) {
    invalidFields.push("darkModeGlowIntensity");
  }

  if (typeof candidate.darkModeGlowRadius !== "number" || candidate.darkModeGlowRadius < 4 || candidate.darkModeGlowRadius > 48) {
    invalidFields.push("darkModeGlowRadius");
  }

  if (typeof candidate.lightModeShadowIntensity !== "number" || candidate.lightModeShadowIntensity < 0 || candidate.lightModeShadowIntensity > 10) {
    invalidFields.push("lightModeShadowIntensity");
  }

  if (typeof candidate.lightModeShadowRadius !== "number" || candidate.lightModeShadowRadius < 4 || candidate.lightModeShadowRadius > 48) {
    invalidFields.push("lightModeShadowRadius");
  }

  if (!HARMONY_MODES.includes(candidate.colorHarmonyMode as HarmonyMode)) {
    invalidFields.push("colorHarmonyMode");
  }

  if (typeof candidate.colorHarmonyBaseHue !== "number" || candidate.colorHarmonyBaseHue < 0 || candidate.colorHarmonyBaseHue > 360) {
    invalidFields.push("colorHarmonyBaseHue");
  }

  if (typeof candidate.colorHarmonyBrandHue !== "number" || candidate.colorHarmonyBrandHue < 0 || candidate.colorHarmonyBrandHue > 360) {
    invalidFields.push("colorHarmonyBrandHue");
  }

  if (candidate.colorHarmonySaturationMode !== "free" && candidate.colorHarmonySaturationMode !== "locked") {
    invalidFields.push("colorHarmonySaturationMode");
  }

  if (typeof candidate.colorHarmonySaturation !== "number" || candidate.colorHarmonySaturation < 0 || candidate.colorHarmonySaturation > 100) {
    invalidFields.push("colorHarmonySaturation");
  }

  if (candidate.colorHarmonyBrandMode !== "independent" && candidate.colorHarmonyBrandMode !== "derived") {
    invalidFields.push("colorHarmonyBrandMode");
  }

  if (typeof candidate.buttonHoverEnabled !== "boolean") {
    invalidFields.push("buttonHoverEnabled");
  }

  if (typeof candidate.buttonSquishEnabled !== "boolean") {
    invalidFields.push("buttonSquishEnabled");
  }

  if (typeof candidate.buttonPressEnabled !== "boolean") {
    invalidFields.push("buttonPressEnabled");
  }

  if (typeof candidate.buttonRippleEnabled !== "boolean") {
    invalidFields.push("buttonRippleEnabled");
  }

  if (typeof candidate.buttonDepthIntensity !== "number" || candidate.buttonDepthIntensity < 0 || candidate.buttonDepthIntensity > 10) {
    invalidFields.push("buttonDepthIntensity");
  }

  if (typeof candidate.buttonDepthRadius !== "number" || candidate.buttonDepthRadius < 4 || candidate.buttonDepthRadius > 32) {
    invalidFields.push("buttonDepthRadius");
  }

  if (typeof candidate.buttonCornerRadius !== "number" || candidate.buttonCornerRadius < 4 || candidate.buttonCornerRadius > 40) {
    invalidFields.push("buttonCornerRadius");
  }

  if (typeof candidate.useUnifiedCornerRadius !== "boolean") {
    invalidFields.push("useUnifiedCornerRadius");
  }

  const semantic = candidate.semanticColors;
  if (!semantic || typeof semantic !== "object") {
    invalidFields.push("semanticColors");
  } else {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.major ?? ""))) {
      invalidFields.push("semanticColors.major");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.minor ?? ""))) {
      invalidFields.push("semanticColors.minor");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.accent ?? ""))) {
      invalidFields.push("semanticColors.accent");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.error ?? ""))) {
      invalidFields.push("semanticColors.error");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.success ?? ""))) {
      invalidFields.push("semanticColors.success");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.warning ?? semantic.pending ?? ""))) {
      invalidFields.push("semanticColors.warning");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.info ?? semantic.new ?? ""))) {
      invalidFields.push("semanticColors.info");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.pending ?? ""))) {
      invalidFields.push("semanticColors.pending");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.new ?? ""))) {
      invalidFields.push("semanticColors.new");
    }
  }

  const assignments = candidate.semanticAssignments;
  if (!assignments || typeof assignments !== "object") {
    invalidFields.push("semanticAssignments");
  } else {
    for (const token of SEMANTIC_TOKEN_NAMES) {
      if (!SEMANTIC_PALETTE_ROLES.includes(assignments[token] as SemanticPaletteRole)) {
        invalidFields.push(`semanticAssignments.${token}`);
      }
    }
  }

  return {
    valid: invalidFields.length === 0,
    invalidFields,
    repaired: sanitizeDesignTokenPreferences(candidate),
  };
}

function buildPrimaryScale(hue: number, saturation: number, gamma: number, darkMode = false): string[] {
  if (darkMode) {
    const darkLightnessStops = [0.02, 0.07, 0.13, 0.2, 0.28, 0.38, 0.5, 0.64, 0.8];
    return darkLightnessStops.map((lightness) => hslToHex(hue, clamp(saturation / 100, 0, 1), lightness));
  }

  const shades: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    // Light mode mirrors dark mode ordering: shade 1 is lightest, shade 9 is darkest.
    const t = 1 - (index / 8);
    const luminance = Math.pow(t, gamma);
    const lightness = 0.16 + luminance * 0.72;
    shades.push(hslToHex(hue, clamp(saturation / 100, 0, 1), lightness));
  }

  return shades;
}

function deriveSemanticRoleRamps(
  harmonyHues: ReturnType<typeof generateHarmonyHues>,
  brandHue: number,
  saturation: number,
  gamma: number,
  semanticColors: SemanticColors,
  darkMode: boolean,
): Record<SemanticPaletteRole, ColorRoleRamp> {
  const buildLockedRoleRamp = (role: SemanticPaletteRole, fallbackHue: number): ColorRoleRamp => {
    const lockedHex = LOCKED_SEMANTIC_PALETTE[role];
    const hue = hexToHue(lockedHex) ?? fallbackHue;
    return {
      hue,
      saturation,
      shades: Array.from({ length: 9 }, () => lockedHex),
    };
  };

  return {
    major: buildLockedRoleRamp("major", harmonyHues.majorHue),
    minor: buildLockedRoleRamp("minor", harmonyHues.minorHue),
    accent: buildLockedRoleRamp("accent", brandHue),
    success: buildLockedRoleRamp("success", harmonyHues.minorHue),
    warning: buildLockedRoleRamp("warning", normalizeHue(harmonyHues.majorHue + 45)),
    error: buildLockedRoleRamp("error", normalizeHue(harmonyHues.majorHue - 24)),
    info: buildLockedRoleRamp("info", brandHue),
  };
}

function resolveSemanticTokenColors(
  assignments: SemanticAssignments,
  roles: Record<SemanticPaletteRole, ColorRoleRamp>,
): Record<SemanticTokenName, string> {
  const resolved = {} as Record<SemanticTokenName, string>;
  for (const token of SEMANTIC_TOKEN_NAMES) {
    const role = assignments[token];
    const shades = roles[role].shades;
    resolved[token] = shades[SEMANTIC_TOKEN_SHADE_INDEX[token]] ?? shades[shades.length - 1];
  }
  return resolved;
}

function buildTypeScale(base: number, ratio: number): Record<"text-lg" | "text-2xl" | "text-3xl" | "text-4xl" | "text-5xl", number> {
  const compute = (step: number) => Number((base * Math.pow(ratio, step)).toFixed(2));
  return {
    "text-lg": compute(1),
    "text-2xl": compute(2),
    "text-3xl": compute(3),
    "text-4xl": compute(4),
    "text-5xl": compute(5),
  };
}

function buildSpacingScale(base: number, ratio: number): number[] {
  return Array.from({ length: 6 }, (_, index) => Number((base * Math.pow(ratio, index)).toFixed(2)));
}

export function generateDesignTokens(preferences: DesignTokenPreferences): DesignTokens {
  const isDarkTheme = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  const effectiveBoxCornerRadius = preferences.useUnifiedCornerRadius
    ? preferences.buttonCornerRadius
    : preferences.boxCornerRadius;
  const effectiveButtonCornerRadius = preferences.useUnifiedCornerRadius
    ? preferences.boxCornerRadius
    : preferences.buttonCornerRadius;
  const sanitizedAssignments = normalizeSemanticAssignments(preferences.semanticAssignments);
  const sanitizedSemanticColors = buildSemanticColors(preferences.semanticColors);
  const harmonyHues = generateHarmonyHues(preferences.colorHarmonyBaseHue, preferences.colorHarmonyMode);
  const effectiveBrandHue = preferences.colorHarmonyBrandMode === "derived"
    ? harmonyHues.accentHue
    : normalizeHue(preferences.colorHarmonyBrandHue);
  const effectiveSaturation = clamp(preferences.colorHarmonySaturation, 0, 100);

  // Use colorHarmonyBaseHue directly — sanitizer guarantees a valid number; avoid || which breaks hue=0 (red)
  const primary = buildPrimaryScale(preferences.colorHarmonyBaseHue, effectiveSaturation, preferences.gamma, isDarkTheme);
  const typeScale = buildTypeScale(12, preferences.typeRatio);
  const baseShadeIndex = clampShade(preferences.cardBaseShade, 3) - 1;
  // CSS Y-position offsets for visual shadow/glow positioning (always negative/positive for consistent direction)
  const effectiveShadowOffset = preferences.cardShadowOffsetMode === "auto"
    ? -2
    : clampCardOffset(preferences.cardShadowOffset, -4, -1, -2);
  const effectiveGlowOffset = preferences.cardGlowOffsetMode === "auto"
    ? 2
    : clampCardOffset(preferences.cardGlowOffset, 1, 4, 2);
  // Shade index offsets for color selection — mirrored per mode:
  // DARK (shade 1=darkest, 9=lightest): shadow (darker) = base-2, glow (lighter) = base+2
  // LIGHT (shade 1=lightest, 9=darkest): shadow (darker) = base+2, glow (lighter) = base-2
  const shadowShadeOffset = preferences.cardShadowOffsetMode === "auto"
    ? (isDarkTheme ? -2 : 2)
    : preferences.cardShadowOffset;
  const glowShadeOffset = preferences.cardGlowOffsetMode === "auto"
    ? (isDarkTheme ? 2 : -2)
    : preferences.cardGlowOffset;
  const shadowShadeIndex = clamp(baseShadeIndex + shadowShadeOffset, 0, 8);
  const glowShadeIndex = clamp(baseShadeIndex + glowShadeOffset, 0, 8);
  const spacingScale = buildSpacingScale(4, preferences.spacingRatio);
  const roleRamps = deriveSemanticRoleRamps(
    harmonyHues,
    effectiveBrandHue,
    effectiveSaturation,
    preferences.gamma,
    sanitizedSemanticColors,
    isDarkTheme,
  );
  const resolvedSemantic = resolveSemanticTokenColors(sanitizedAssignments, roleRamps);
  const cardBaseRole = roleRamps[sanitizedAssignments.cardBackground].shades;
  const cardShadowRole = roleRamps[sanitizedAssignments.cardShadow].shades;
  const cardGlowRole = roleRamps[sanitizedAssignments.cardGlow].shades;
  const cardStrokeColor = roleRamps[preferences.cardStrokeRole].shades[4];
  const gradientBaseColor = cardBaseRole[baseShadeIndex];
  const gradientStartColor = resolveRoleTokenColor(preferences.cardGradientStart, roleRamps, gradientBaseColor);
  const gradientEndColor = resolveRoleTokenColor(preferences.cardGradientEnd, roleRamps, gradientBaseColor);
  const overlayColor = roleRamps[preferences.cardOverlayRole].shades[4];
  const cardGradientFocus = resolveCardGradientFocusValue(preferences);

  return {
    color: {
      primary,
      semantic: sanitizedSemanticColors,
      roles: roleRamps,
      assignments: sanitizedAssignments,
      resolved: resolvedSemantic,
      zLuminanceByHeight: {
        0: primary[0],
        1: primary[2],
        2: primary[4],
        3: primary[6],
        4: primary[8],
      },
    },
    type: {
      base: 12,
      ratio: preferences.typeRatio,
      body: 12,
      subheading: typeScale["text-lg"],
      heading: typeScale["text-2xl"],
      title: typeScale["text-3xl"],
      scale: typeScale,
    },
    stroke: {
      preset: preferences.strokePreset,
      values: STROKE_PRESETS[preferences.strokePreset],
    },
    spacing: {
      base: 4,
      ratio: preferences.spacingRatio,
      values: spacingScale,
    },
    motion: {
      timingMs: preferences.motionTimingMs,
      easing: preferences.motionEasing,
      presets: {
        micro: 100,
        default: 300,
        xl: 500,
      },
    },
    states: {
      hoverOpacity: 0.92,
      activeOpacity: 0.84,
      disabledOpacity: 0.48,
      loadingOpacity: 0.64,
    },
    card: {
      baseShade: baseShadeIndex + 1,
      shadowOffset: effectiveShadowOffset,
      glowOffset: effectiveGlowOffset,
      shadowShade: shadowShadeIndex + 1,
      glowShade: glowShadeIndex + 1,
      strokeSize: preferences.cardStrokeSize,
      strokeColor: cardStrokeColor,
      gradientEnabled: preferences.cardGradientEnabled,
      gradientStart: preferences.cardGradientEnabled ? gradientStartColor : gradientBaseColor,
      gradientEnd: preferences.cardGradientEnabled ? gradientEndColor : gradientBaseColor,
      gradientStrength: preferences.cardGradientEnabled ? preferences.cardGradientStrength : 0,
      gradientAngle: preferences.cardGradientAngle,
      gradientFocus: cardGradientFocus,
      gradientScale: preferences.cardGradientScale,
      overlayEnabled: preferences.cardOverlayEnabled,
      overlayColor,
      overlayStrength: preferences.cardOverlayEnabled ? preferences.cardOverlayStrength : 0,
      settingsBaseLightLuminance: preferences.settingsBaseLightLuminance,
      settingsBaseDarkLuminance: preferences.settingsBaseDarkLuminance,
      cornerRadius: effectiveBoxCornerRadius,
      padding: spacingScale[preferences.cardPaddingIndex] ?? spacingScale[4],
      height: preferences.cardHeight,
      darkModeGlowIntensity: preferences.darkModeGlowIntensity,
      darkModeGlowRadius: preferences.darkModeGlowRadius,
      lightModeShadowIntensity: preferences.lightModeShadowIntensity,
      lightModeShadowRadius: preferences.lightModeShadowRadius,
      colors: {
        base: cardBaseRole[baseShadeIndex],
        shadow: cardShadowRole[shadowShadeIndex],
        glow: cardGlowRole[glowShadeIndex],
      },
    },
    harmony: {
      mode: preferences.colorHarmonyMode,
      baseHue: preferences.colorHarmonyBaseHue,
      brandHue: preferences.colorHarmonyBrandHue,
      effectiveBrandHue,
      saturationMode: preferences.colorHarmonySaturationMode,
      saturation: effectiveSaturation,
      majorHue: harmonyHues.majorHue,
      minorHue: harmonyHues.minorHue,
      accentHue: harmonyHues.accentHue,
      highlightHue: harmonyHues.highlightHue,
      colors: {
        major: roleRamps.major.shades[4],
        minor: roleRamps.minor.shades[4],
        accent: roleRamps.accent.shades[4],
        highlight: roleRamps.info.shades[5],
      },
    },
    component: {
      buttonPrimary: {
        background: resolvedSemantic.buttonPrimary,
        border: resolvedSemantic.accentActive,
        text: resolvedSemantic.text,
        hover: resolvedSemantic.accentHover,
        active: resolvedSemantic.accentActive,
        disabled: resolvedSemantic.surface,
        focusRing: resolvedSemantic.info,
      },
      buttonSecondary: {
        background: resolvedSemantic.buttonSecondary,
        border: resolvedSemantic.border,
        text: resolvedSemantic.text,
        hover: resolvedSemantic.surface,
        active: resolvedSemantic.border,
        disabled: resolvedSemantic.surface,
        focusRing: resolvedSemantic.info,
      },
      buttonGhost: {
        background: resolvedSemantic.buttonGhost,
        border: resolvedSemantic.border,
        text: resolvedSemantic.text,
        hover: resolvedSemantic.surface,
        active: resolvedSemantic.border,
        disabled: resolvedSemantic.surface,
        focusRing: resolvedSemantic.info,
      },
      alert: {
        success: resolvedSemantic.success,
        warning: resolvedSemantic.warning,
        error: resolvedSemantic.error,
        info: resolvedSemantic.info,
        text: resolvedSemantic.text,
      },
      badge: {
        success: resolvedSemantic.success,
        warning: resolvedSemantic.warning,
        error: resolvedSemantic.error,
        info: resolvedSemantic.info,
        text: resolvedSemantic.text,
      },
      input: {
        background: resolvedSemantic.surface,
        border: resolvedSemantic.border,
        text: resolvedSemantic.text,
        focusRing: resolvedSemantic.info,
        hoverBorder: resolvedSemantic.accentHover,
        activeBorder: resolvedSemantic.accentActive,
        disabledBackground: resolvedSemantic.background,
      },
      card: {
        background: resolvedSemantic.cardBackground,
        shadow: resolvedSemantic.cardShadow,
        glow: resolvedSemantic.cardGlow,
        border: cardStrokeColor,
      },
    },
    button: {
      hoverEnabled: preferences.buttonHoverEnabled,
      squishEnabled: preferences.buttonSquishEnabled,
      pressEnabled: preferences.buttonPressEnabled,
      rippleEnabled: preferences.buttonRippleEnabled,
      depthIntensity: preferences.buttonDepthIntensity,
      depthRadius: preferences.buttonDepthRadius,
      cornerRadius: effectiveButtonCornerRadius,
    },
  };
}

export function applyDesignTokensToDocument(tokens: DesignTokens, docRef: Document = document): void {
  const root = docRef.documentElement;

  tokens.color.primary.forEach((shade, index) => {
    root.style.setProperty(`--cf-ds-primary-${index + 1}`, shade);
  });

  for (const role of SEMANTIC_PALETTE_ROLES) {
    const ramp = tokens.color.roles[role];
    root.style.setProperty(`--cf-ds-role-${role}-hue`, String(ramp.hue));
    root.style.setProperty(`--cf-ds-role-${role}-saturation`, `${ramp.saturation}%`);
    ramp.shades.forEach((shade, index) => {
      root.style.setProperty(`--cf-ds-role-${role}-${index + 1}`, shade);
    });
  }

  for (const tokenName of SEMANTIC_TOKEN_NAMES) {
    const cssToken = tokenName.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    root.style.setProperty(`--cf-semantic-${cssToken}`, tokens.color.resolved[tokenName]);
  }

  root.style.setProperty("--cf-ds-semantic-error", tokens.color.semantic.error);
  root.style.setProperty("--cf-ds-semantic-success", tokens.color.semantic.success);
  root.style.setProperty("--cf-ds-semantic-warning", tokens.color.semantic.warning);
  root.style.setProperty("--cf-ds-semantic-info", tokens.color.semantic.info);
  root.style.setProperty("--cf-ds-semantic-pending", tokens.color.semantic.pending);
  root.style.setProperty("--cf-ds-semantic-new", tokens.color.semantic.new);

  root.style.setProperty("--cf-ds-type-base", `${tokens.type.base}px`);
  root.style.setProperty("--cf-ds-type-ratio", String(tokens.type.ratio));
  root.style.setProperty("--cf-ds-text-lg", `${tokens.type.scale["text-lg"]}px`);
  root.style.setProperty("--cf-ds-text-2xl", `${tokens.type.scale["text-2xl"]}px`);
  root.style.setProperty("--cf-ds-text-3xl", `${tokens.type.scale["text-3xl"]}px`);
  root.style.setProperty("--cf-ds-text-4xl", `${tokens.type.scale["text-4xl"]}px`);
  root.style.setProperty("--cf-ds-text-5xl", `${tokens.type.scale["text-5xl"]}px`);

  root.style.setProperty("--cf-ds-stroke-1", `${tokens.stroke.values[0] ?? 1}px`);
  root.style.setProperty("--cf-ds-stroke-2", `${tokens.stroke.values[1] ?? tokens.stroke.values[0] ?? 1}px`);
  root.style.setProperty("--cf-ds-stroke-3", `${tokens.stroke.values[2] ?? tokens.stroke.values[tokens.stroke.values.length - 1] ?? 1}px`);

  tokens.spacing.values.forEach((value, index) => {
    root.style.setProperty(`--cf-ds-space-${index}`, `${value}px`);
  });

  root.style.setProperty("--cf-ds-motion-ms", `${tokens.motion.timingMs}ms`);
  root.style.setProperty("--cf-ds-motion-easing", tokens.motion.easing);
  root.style.setProperty("--cf-ds-opacity-hover", String(tokens.states.hoverOpacity));
  root.style.setProperty("--cf-ds-opacity-active", String(tokens.states.activeOpacity));
  root.style.setProperty("--cf-ds-opacity-disabled", String(tokens.states.disabledOpacity));
  root.style.setProperty("--cf-ds-opacity-loading", String(tokens.states.loadingOpacity));
  root.style.setProperty("--cf-ds-card-bg", tokens.card.colors.base);
  root.style.setProperty("--cf-ds-card-shadow-color", tokens.card.colors.shadow);
  root.style.setProperty("--cf-ds-card-glow-color", tokens.card.colors.glow);
  root.style.setProperty("--cf-ds-card-shadow-offset", String(tokens.card.shadowOffset));
  root.style.setProperty("--cf-ds-card-glow-offset", String(tokens.card.glowOffset));
  root.style.setProperty("--cf-ds-card-stroke-size", `${tokens.card.strokeSize}px`);
  root.style.setProperty("--cf-ds-card-stroke-color", tokens.card.strokeColor);
  root.style.setProperty("--cf-ds-card-gradient-enabled", tokens.card.gradientEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-card-gradient-start", tokens.card.gradientStart);
  root.style.setProperty("--cf-ds-card-gradient-end", tokens.card.gradientEnd);
  root.style.setProperty("--cf-ds-card-gradient-strength", `${tokens.card.gradientStrength}%`);
  root.style.setProperty("--cf-ds-card-gradient-angle", `${tokens.card.gradientAngle}deg`);
  root.style.setProperty("--cf-ds-card-gradient-focus", tokens.card.gradientFocus);
  root.style.setProperty("--cf-ds-card-gradient-scale", String(tokens.card.gradientScale));
  root.style.setProperty("--cf-ds-card-overlay-enabled", tokens.card.overlayEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-card-overlay-color", tokens.card.overlayColor);
  root.style.setProperty("--cf-ds-card-overlay-strength", `${tokens.card.overlayStrength}%`);
  root.style.setProperty("--cf-ds-settings-base-light-luminance", `${tokens.card.settingsBaseLightLuminance}%`);
  root.style.setProperty("--cf-ds-settings-base-dark-luminance", `${tokens.card.settingsBaseDarkLuminance}%`);
  root.style.setProperty("--cf-ds-card-radius", `${tokens.card.cornerRadius}px`);
  root.style.setProperty("--cf-ds-box-radius", `${tokens.card.cornerRadius}px`);
  root.style.setProperty("--cf-ds-card-padding", `${tokens.card.padding}px`);
  root.style.setProperty("--cf-ds-card-height", `${tokens.card.height}px`);
  root.style.setProperty("--cf-ds-card-shadow-intensity", String(tokens.card.lightModeShadowIntensity));
  root.style.setProperty("--cf-ds-card-shadow-radius", `${tokens.card.lightModeShadowRadius}px`);
  root.style.setProperty("--cf-ds-card-glow-intensity", String(tokens.card.darkModeGlowIntensity));
  root.style.setProperty("--cf-ds-card-glow-radius", `${tokens.card.darkModeGlowRadius}px`);
  root.style.setProperty("--cf-ds-harmony-major", tokens.harmony.colors.major);
  root.style.setProperty("--cf-ds-harmony-minor", tokens.harmony.colors.minor);
  root.style.setProperty("--cf-ds-harmony-accent", tokens.harmony.colors.accent);
  root.style.setProperty("--cf-ds-harmony-highlight", tokens.harmony.colors.highlight);
  root.style.setProperty("--cf-ds-harmony-base-hue", String(tokens.harmony.baseHue));
  root.style.setProperty("--cf-ds-harmony-brand-hue", String(tokens.harmony.brandHue));
  root.style.setProperty("--cf-ds-harmony-effective-brand-hue", String(tokens.harmony.effectiveBrandHue));
  root.style.setProperty("--cf-ds-harmony-saturation", `${tokens.harmony.saturation}%`);
  root.style.setProperty("--cf-ds-harmony-major-hue", String(tokens.harmony.majorHue));
  root.style.setProperty("--cf-ds-harmony-minor-hue", String(tokens.harmony.minorHue));
  root.style.setProperty("--cf-ds-harmony-accent-hue", String(tokens.harmony.accentHue));
  root.style.setProperty("--cf-ds-harmony-highlight-hue", String(tokens.harmony.highlightHue));
  root.style.setProperty("--cf-ds-btn-primary-bg", tokens.component.buttonPrimary.background);
  root.style.setProperty("--cf-ds-btn-primary-border", tokens.component.buttonPrimary.border);
  root.style.setProperty("--cf-ds-btn-primary-text", tokens.component.buttonPrimary.text);
  root.style.setProperty("--cf-ds-btn-primary-hover", tokens.component.buttonPrimary.hover);
  root.style.setProperty("--cf-ds-btn-primary-active", tokens.component.buttonPrimary.active);
  root.style.setProperty("--cf-ds-btn-primary-disabled", tokens.component.buttonPrimary.disabled);
  root.style.setProperty("--cf-ds-btn-primary-focus", tokens.component.buttonPrimary.focusRing);
  root.style.setProperty("--cf-ds-btn-secondary-bg", tokens.component.buttonSecondary.background);
  root.style.setProperty("--cf-ds-btn-secondary-border", tokens.component.buttonSecondary.border);
  root.style.setProperty("--cf-ds-btn-secondary-text", tokens.component.buttonSecondary.text);
  root.style.setProperty("--cf-ds-btn-secondary-hover", tokens.component.buttonSecondary.hover);
  root.style.setProperty("--cf-ds-btn-secondary-active", tokens.component.buttonSecondary.active);
  root.style.setProperty("--cf-ds-btn-secondary-disabled", tokens.component.buttonSecondary.disabled);
  root.style.setProperty("--cf-ds-btn-secondary-focus", tokens.component.buttonSecondary.focusRing);
  root.style.setProperty("--cf-ds-btn-ghost-bg", tokens.component.buttonGhost.background);
  root.style.setProperty("--cf-ds-btn-ghost-border", tokens.component.buttonGhost.border);
  root.style.setProperty("--cf-ds-btn-ghost-text", tokens.component.buttonGhost.text);
  root.style.setProperty("--cf-ds-btn-ghost-hover", tokens.component.buttonGhost.hover);
  root.style.setProperty("--cf-ds-btn-ghost-active", tokens.component.buttonGhost.active);
  root.style.setProperty("--cf-ds-btn-ghost-disabled", tokens.component.buttonGhost.disabled);
  root.style.setProperty("--cf-ds-btn-ghost-focus", tokens.component.buttonGhost.focusRing);
  root.style.setProperty("--cf-ds-alert-success", tokens.component.alert.success);
  root.style.setProperty("--cf-ds-alert-warning", tokens.component.alert.warning);
  root.style.setProperty("--cf-ds-alert-error", tokens.component.alert.error);
  root.style.setProperty("--cf-ds-alert-info", tokens.component.alert.info);
  root.style.setProperty("--cf-ds-alert-text", tokens.component.alert.text);
  root.style.setProperty("--cf-ds-badge-success", tokens.component.badge.success);
  root.style.setProperty("--cf-ds-badge-warning", tokens.component.badge.warning);
  root.style.setProperty("--cf-ds-badge-error", tokens.component.badge.error);
  root.style.setProperty("--cf-ds-badge-info", tokens.component.badge.info);
  root.style.setProperty("--cf-ds-badge-text", tokens.component.badge.text);
  root.style.setProperty("--cf-ds-input-bg", tokens.component.input.background);
  root.style.setProperty("--cf-ds-input-border", tokens.component.input.border);
  root.style.setProperty("--cf-ds-input-text", tokens.component.input.text);
  root.style.setProperty("--cf-ds-input-focus", tokens.component.input.focusRing);
  root.style.setProperty("--cf-ds-input-hover-border", tokens.component.input.hoverBorder);
  root.style.setProperty("--cf-ds-input-active-border", tokens.component.input.activeBorder);
  root.style.setProperty("--cf-ds-input-disabled-bg", tokens.component.input.disabledBackground);
  root.style.setProperty("--cf-ds-btn-hover-enabled", tokens.button.hoverEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-btn-squish-enabled", tokens.button.squishEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-btn-press-enabled", tokens.button.pressEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-btn-ripple-enabled", tokens.button.rippleEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-btn-depth-intensity", String(tokens.button.depthIntensity));
  root.style.setProperty("--cf-ds-btn-depth-radius", `${tokens.button.depthRadius}px`);
  root.style.setProperty("--cf-ds-btn-radius", `${tokens.button.cornerRadius}px`);

  root.style.setProperty("--card-stroke-color", tokens.card.strokeColor);
  root.style.setProperty("--card-stroke-size", `${tokens.card.strokeSize}px`);
  root.style.setProperty("--card-base-shade", tokens.card.colors.base);
  root.style.setProperty("--card-shadow-shade", tokens.card.colors.shadow);
  root.style.setProperty("--card-glow-shade", tokens.card.colors.glow);
  root.style.setProperty("--card-shadow-offset", String(tokens.card.shadowOffset));
  root.style.setProperty("--card-glow-offset", String(tokens.card.glowOffset));
  root.style.setProperty("--card-gradient-enabled", tokens.card.gradientEnabled ? "1" : "0");
  root.style.setProperty("--card-gradient-start", tokens.card.gradientStart);
  root.style.setProperty("--card-gradient-end", tokens.card.gradientEnd);
  root.style.setProperty("--card-gradient-strength", `${tokens.card.gradientStrength}%`);
  root.style.setProperty("--card-gradient-angle", `${tokens.card.gradientAngle}deg`);
  root.style.setProperty("--card-gradient-focus", tokens.card.gradientFocus);
  root.style.setProperty("--card-gradient-scale", String(tokens.card.gradientScale));
  root.style.setProperty("--card-overlay-enabled", tokens.card.overlayEnabled ? "1" : "0");
  root.style.setProperty("--card-overlay-color", tokens.card.overlayColor);
  root.style.setProperty("--card-overlay-strength", `${tokens.card.overlayStrength}%`);

  const theme = typeof docRef !== "undefined" ? docRef.documentElement.dataset.theme : "light";
  void appendDebugLogEntry({
    eventType: "info",
    message: "Design tokens applied to document.",
    context: {
      theme: theme ?? "light",
      glowOrShadow: theme === "dark" ? "glow" : "shadow",
      darkModeGlowIntensity: tokens.card.darkModeGlowIntensity,
      darkModeGlowRadius: tokens.card.darkModeGlowRadius,
      lightModeShadowIntensity: tokens.card.lightModeShadowIntensity,
      lightModeShadowRadius: tokens.card.lightModeShadowRadius,
      harmonyMode: tokens.harmony.mode,
      harmonyBaseHue: tokens.harmony.baseHue,
      harmonyBrandHue: tokens.harmony.brandHue,
      harmonyEffectiveBrandHue: tokens.harmony.effectiveBrandHue,
      harmonySaturation: tokens.harmony.saturation,
      harmonyMajorHue: tokens.harmony.majorHue,
      harmonyMinorHue: tokens.harmony.minorHue,
      harmonyAccentHue: tokens.harmony.accentHue,
      buttonDepthIntensity: tokens.button.depthIntensity,
      buttonDepthRadius: tokens.button.depthRadius,
      boxCornerRadius: tokens.card.cornerRadius,
      buttonCornerRadius: tokens.button.cornerRadius,
    },
  });
}

function readStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function getDeterministicDefaultPatch(): Partial<DesignTokenPreferences> {
  return {
    primaryHue: DEFAULT_DESIGN_TOKEN_PREFERENCES.primaryHue,
    semanticColors: DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors,
    colorHarmonyMode: DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyMode,
    colorHarmonyBaseHue: DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBaseHue,
    colorHarmonyBrandHue: DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBrandHue,
    colorHarmonySaturationMode: DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonySaturationMode,
    colorHarmonySaturation: DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonySaturation,
    colorHarmonyBrandMode: DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBrandMode,
    semanticAssignments: DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticAssignments,
    useSystemDefaults: false,
  };
}

export function loadLocalDesignTokenPreferences(): DesignTokenPreferences {
  const storage = readStorage();
  if (!storage) {
    return DEFAULT_DESIGN_TOKEN_PREFERENCES;
  }

  const raw = storage.getItem(DESIGN_TOKENS_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_DESIGN_TOKEN_PREFERENCES;
  }

  try {
    return sanitizeDesignTokenPreferences(JSON.parse(raw) as Partial<DesignTokenPreferences>);
  } catch {
    return DEFAULT_DESIGN_TOKEN_PREFERENCES;
  }
}

export function readLocalDesignTokenDiagnostics(): {
  corrupted: boolean;
  invalidFields: string[];
  raw: unknown | null;
} {
  const storage = readStorage();
  if (!storage) {
    return { corrupted: false, invalidFields: [], raw: null };
  }

  const raw = storage.getItem(DESIGN_TOKENS_STORAGE_KEY);
  if (!raw) {
    return { corrupted: false, invalidFields: [], raw: null };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const validation = validateDesignTokenPreferences(parsed);
    return {
      corrupted: !validation.valid,
      invalidFields: validation.invalidFields,
      raw: parsed,
    };
  } catch {
    return {
      corrupted: true,
      invalidFields: ["json"],
      raw,
    };
  }
}

function safeMatchMedia(query: string): { ok: boolean; value?: boolean; reason?: string } {
  if (typeof window === "undefined") {
    return { ok: false, reason: "window_unavailable" };
  }

  if (!window.matchMedia) {
    return { ok: false, reason: "matchMedia_unsupported" };
  }

  try {
    return { ok: true, value: window.matchMedia(query).matches };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "matchMedia_error" };
  }
}

export function detectSystemDesignDefaultsDetailed(): {
  values: Partial<DesignTokenPreferences>;
  detected: Record<string, unknown>;
  failed: Record<string, string>;
} {
  const detected: Record<string, unknown> = {};
  const failed: Record<string, string> = {};

  const reducedMotion = safeMatchMedia("(prefers-reduced-motion: reduce)");
  if (reducedMotion.ok) {
    detected.prefersReducedMotion = reducedMotion.value === true;
  } else if (reducedMotion.reason) {
    failed.prefersReducedMotion = reducedMotion.reason;
  }

  const highContrast = safeMatchMedia("(prefers-contrast: more)");
  if (highContrast.ok) {
    detected.prefersHighContrast = highContrast.value === true;
  } else if (highContrast.reason) {
    failed.prefersHighContrast = highContrast.reason;
  }

  const darkMode = safeMatchMedia("(prefers-color-scheme: dark)");
  if (darkMode.ok) {
    detected.prefersDarkMode = darkMode.value === true;
  } else if (darkMode.reason) {
    failed.prefersDarkMode = darkMode.reason;
  }

  const browserFontScale = typeof window !== "undefined" && typeof window.devicePixelRatio === "number"
    ? Number(window.devicePixelRatio.toFixed(2))
    : null;

  if (browserFontScale !== null) {
    detected.browserScaleHint = browserFontScale;
  } else {
    failed.browserScaleHint = "devicePixelRatio_unavailable";
  }

  const rootStyle = typeof window !== "undefined" && typeof document !== "undefined"
    ? window.getComputedStyle(document.documentElement)
    : null;

  if (rootStyle) {
    detected.systemFontFamily = rootStyle.fontFamily || "unknown";
    detected.systemFontSize = rootStyle.fontSize || "unknown";
    detected.systemFontWeight = rootStyle.fontWeight || "unknown";
    detected.systemLineHeight = rootStyle.lineHeight || "unknown";
  } else {
    failed.systemTypography = "computed_style_unavailable";
  }

  const values: Partial<DesignTokenPreferences> = {
    motionTimingMs: detected.prefersReducedMotion === true ? 100 : DEFAULT_DESIGN_TOKEN_PREFERENCES.motionTimingMs,
    gamma: detected.prefersHighContrast === true ? 2.35 : DEFAULT_DESIGN_TOKEN_PREFERENCES.gamma,
    primaryHue: detected.prefersDarkMode === true ? 220 : DEFAULT_DESIGN_TOKEN_PREFERENCES.primaryHue,
    typeRatio: browserFontScale !== null
      ? clamp(1.12 + (browserFontScale - 1) * 0.24, 1.067, 1.5)
      : DEFAULT_DESIGN_TOKEN_PREFERENCES.typeRatio,
    colorHarmonyBaseHue: detected.prefersDarkMode === true ? 220 : DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBaseHue,
    colorHarmonyBrandHue: DEFAULT_DESIGN_TOKEN_PREFERENCES.colorHarmonyBrandHue,
    buttonDepthIntensity: detected.prefersHighContrast === true ? 6.5 : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonDepthIntensity,
    buttonDepthRadius: detected.prefersReducedMotion === true ? 8 : DEFAULT_DESIGN_TOKEN_PREFERENCES.buttonDepthRadius,
  };

  return { values, detected, failed };
}

export function initializeDesignTokenPreferencesOnFirstRun(): FirstRunResolution {
  const traces: FirstRunDetectionTraceEntry[] = [];
  const storage = readStorage();

  if (!storage) {
    traces.push({
      step: "storage",
      status: "fallback",
      message: "Storage API unavailable. Using default design tokens.",
    });
    return {
      preferences: DEFAULT_DESIGN_TOKEN_PREFERENCES,
      source: "default",
      detectedSystem: {},
      failedSystem: { storage: "unavailable" },
      traces,
    };
  }

  const raw = storage.getItem(DESIGN_TOKENS_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const validation = validateDesignTokenPreferences(parsed);
      if (validation.valid) {
        const currentProfile = storage.getItem(DESIGN_TOKENS_PROFILE_KEY);
        if (currentProfile !== DESIGN_TOKENS_PROFILE_VERSION) {
          const migrated = sanitizeDesignTokenPreferences({
            ...validation.repaired,
            ...getDeterministicDefaultPatch(),
          });
          saveLocalDesignTokenPreferences(migrated);
          storage.setItem(DESIGN_TOKENS_PROFILE_KEY, DESIGN_TOKENS_PROFILE_VERSION);
          traces.push({
            step: "profile-migration",
            status: "fallback",
            message: "Applied deterministic semantic profile defaults to existing local design tokens.",
            details: {
              fromProfile: currentProfile ?? "none",
              toProfile: DESIGN_TOKENS_PROFILE_VERSION,
            },
          });
          return {
            preferences: migrated,
            source: "local",
            detectedSystem: {},
            failedSystem: {},
            traces,
          };
        }

        traces.push({ step: "local-load", status: "success", message: "Loaded valid local design tokens." });
        return {
          preferences: validation.repaired,
          source: "local",
          detectedSystem: {},
          failedSystem: {},
          traces,
        };
      }

      storage.setItem(DESIGN_TOKENS_BACKUP_KEY, raw);
      traces.push({
        step: "local-validate",
        status: "failure",
        message: "Local design tokens are invalid and were quarantined.",
        details: { invalidFields: validation.invalidFields },
      });
    } catch {
      storage.setItem(DESIGN_TOKENS_BACKUP_KEY, raw);
      traces.push({
        step: "local-parse",
        status: "failure",
        message: "Local design tokens were corrupted JSON and were quarantined.",
      });
    }
  }

  const firstRunDone = storage.getItem(DESIGN_TOKENS_FIRST_RUN_KEY) === "1";
  if (!firstRunDone) {
    const system = detectSystemDesignDefaultsDetailed();
    const resolved = sanitizeDesignTokenPreferences({
      ...DEFAULT_DESIGN_TOKEN_PREFERENCES,
      ...getDeterministicDefaultPatch(),
      useSystemDefaults: true,
    });

    saveLocalDesignTokenPreferences(resolved);
    storage.setItem(DESIGN_TOKENS_FIRST_RUN_KEY, "1");
    storage.setItem(DESIGN_TOKENS_PROFILE_KEY, DESIGN_TOKENS_PROFILE_VERSION);

    traces.push({
      step: "first-run-detection",
      status: Object.keys(system.failed).length > 0 ? "fallback" : "success",
      message: "Applied deterministic semantic profile defaults for first run.",
      details: {
        profile: DESIGN_TOKENS_PROFILE_VERSION,
        detected: system.detected,
        failed: system.failed,
      },
    });

    return {
      preferences: resolved,
      source: "system",
      detectedSystem: system.detected,
      failedSystem: system.failed,
      traces,
    };
  }

  traces.push({
    step: "fallback-default",
    status: "fallback",
    message: "Using internal default design tokens.",
  });

  saveLocalDesignTokenPreferences(DEFAULT_DESIGN_TOKEN_PREFERENCES);
  storage.setItem(DESIGN_TOKENS_PROFILE_KEY, DESIGN_TOKENS_PROFILE_VERSION);
  return {
    preferences: DEFAULT_DESIGN_TOKEN_PREFERENCES,
    source: "default",
    detectedSystem: {},
    failedSystem: {},
    traces,
  };
}

export function tryRepairCorruptedLocalDesignSettings(): {
  success: boolean;
  invalidFields: string[];
  repaired: DesignTokenPreferences;
} {
  const storage = readStorage();
  if (!storage) {
    return {
      success: false,
      invalidFields: ["storage"],
      repaired: DEFAULT_DESIGN_TOKEN_PREFERENCES,
    };
  }

  const backupRaw = storage.getItem(DESIGN_TOKENS_BACKUP_KEY) ?? storage.getItem(DESIGN_TOKENS_STORAGE_KEY);
  if (!backupRaw) {
    return {
      success: false,
      invalidFields: ["missing_backup"],
      repaired: DEFAULT_DESIGN_TOKEN_PREFERENCES,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(backupRaw);
  } catch {
    return {
      success: false,
      invalidFields: ["json"],
      repaired: DEFAULT_DESIGN_TOKEN_PREFERENCES,
    };
  }

  const validation = validateDesignTokenPreferences(parsed);
  const repaired = validation.repaired;
  saveLocalDesignTokenPreferences(repaired);

  return {
    success: true,
    invalidFields: validation.invalidFields,
    repaired,
  };
}

export function saveLocalDesignTokenPreferences(preferences: DesignTokenPreferences): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }

  storage.setItem(DESIGN_TOKENS_STORAGE_KEY, JSON.stringify(preferences));
  storage.setItem(DESIGN_TOKENS_PROFILE_KEY, DESIGN_TOKENS_PROFILE_VERSION);
}

export function clearLocalDesignTokenPreferences(): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(DESIGN_TOKENS_STORAGE_KEY);
  storage.removeItem(DESIGN_TOKENS_BACKUP_KEY);
  storage.removeItem(DESIGN_TOKENS_PROFILE_KEY);
}

export function detectSystemDesignDefaults(): Partial<DesignTokenPreferences> {
  return detectSystemDesignDefaultsDetailed().values;
}

export async function saveDesignTokenPreferencesToCloud(userId: string, preferences: DesignTokenPreferences): Promise<void> {
  const [{ doc, setDoc }, { firestoreDb }] = await Promise.all([
    import("firebase/firestore"),
    import("../../firebase/firestore"),
  ]);

  await setDoc(
    doc(firestoreDb, "users", userId),
    {
      preferences: {
        designTokens: preferences,
      },
    },
    { merge: true }
  );

  void appendDebugLogEntry({
    eventType: "user_action",
    message: "Design tokens synced to cloud.",
    context: {
      userId,
      gamma: preferences.gamma,
      typeRatio: preferences.typeRatio,
      spacingRatio: preferences.spacingRatio,
      strokePreset: preferences.strokePreset,
    },
  });
}

export async function loadDesignTokenPreferencesFromCloud(userId: string): Promise<DesignTokenPreferences | null> {
  const [{ doc, getDoc }, { firestoreDb }] = await Promise.all([
    import("firebase/firestore"),
    import("../../firebase/firestore"),
  ]);

  const snapshot = await getDoc(doc(firestoreDb, "users", userId));
  if (!snapshot.exists()) {
    return null;
  }

  const raw = snapshot.get("preferences.designTokens") as Partial<DesignTokenPreferences> | undefined;
  if (!raw) {
    return null;
  }

  return sanitizeDesignTokenPreferences(raw);
}

export async function inspectCloudDesignTokenPreferences(userId: string): Promise<{
  exists: boolean;
  valid: boolean;
  invalidFields: string[];
  raw: unknown;
  sanitized: DesignTokenPreferences | null;
}> {
  const [{ doc, getDoc }, { firestoreDb }] = await Promise.all([
    import("firebase/firestore"),
    import("../../firebase/firestore"),
  ]);

  const snapshot = await getDoc(doc(firestoreDb, "users", userId));
  if (!snapshot.exists()) {
    return {
      exists: false,
      valid: false,
      invalidFields: [],
      raw: null,
      sanitized: null,
    };
  }

  const raw = snapshot.get("preferences.designTokens") as unknown;
  if (!raw) {
    return {
      exists: false,
      valid: false,
      invalidFields: [],
      raw: null,
      sanitized: null,
    };
  }

  const validation = validateDesignTokenPreferences(raw);
  return {
    exists: true,
    valid: validation.valid,
    invalidFields: validation.invalidFields,
    raw,
    sanitized: validation.repaired,
  };
}

export async function deleteCloudDesignTokenPreferences(userId: string): Promise<void> {
  const [{ doc, setDoc }, { firestoreDb }] = await Promise.all([
    import("firebase/firestore"),
    import("../../firebase/firestore"),
  ]);

  await setDoc(
    doc(firestoreDb, "users", userId),
    {
      preferences: {
        designTokens: null,
      },
    },
    { merge: true }
  );
}

export function resolveCloudSettingsDecision(input: {
  local: DesignTokenPreferences;
  cloud: DesignTokenPreferences | null;
  decision: CloudSettingsDecision;
}): {
  nextLocal: DesignTokenPreferences;
  cloudTarget: DesignTokenPreferences | null;
  trace: string;
} {
  if (input.decision === "apply-cloud") {
    return {
      nextLocal: input.cloud ?? input.local,
      cloudTarget: input.cloud,
      trace: input.cloud ? "Applied cloud settings to local." : "Cloud settings missing; kept local.",
    };
  }

  if (input.decision === "merge-local-into-cloud") {
    const merged = sanitizeDesignTokenPreferences({
      ...(input.cloud ?? {}),
      ...input.local,
    });

    return {
      nextLocal: merged,
      cloudTarget: merged,
      trace: "Merged local settings into cloud profile.",
    };
  }

  if (input.decision === "delete-cloud-use-local-defaults") {
    return {
      nextLocal: DEFAULT_DESIGN_TOKEN_PREFERENCES,
      cloudTarget: null,
      trace: "Deleted cloud settings and restored local defaults.",
    };
  }

  return {
    nextLocal: input.local,
    cloudTarget: input.local,
    trace: "Kept local settings.",
  };
}

const DSC_DEBUG_ENABLED_KEY = "courseforge.debugDsc.enabled";
const DSC_DEBUG_RECORDS_KEY = "courseforge.debugDsc.records.v1";
const DSC_DEBUG_MAX_RECORDS_KEY = "courseforge.debugDsc.maxRecords";
const DSC_DEBUG_MAX_AGE_DAYS_KEY = "courseforge.debugDsc.maxAgeDays";
const DSC_DEBUG_DEFAULT_MAX_RECORDS = 3000;
const DSC_DEBUG_DEFAULT_MAX_AGE_DAYS = 7;

function readDscDebugMaxRecords(): number {
  const storage = readStorage();
  const raw = storage?.getItem(DSC_DEBUG_MAX_RECORDS_KEY) ?? "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 100) {
    return DSC_DEBUG_DEFAULT_MAX_RECORDS;
  }

  return Math.round(parsed);
}

function readDscDebugMaxAgeDays(): number {
  const storage = readStorage();
  const raw = storage?.getItem(DSC_DEBUG_MAX_AGE_DAYS_KEY) ?? "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DSC_DEBUG_DEFAULT_MAX_AGE_DAYS;
  }

  return Math.round(parsed);
}

function parseHexToRgb(value: string): { r: number; g: number; b: number } | null {
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    return null;
  }

  const hex = match[1];
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function channelToLinear(value: number): number {
  const normalized = clamp(value / 255, 0, 1);
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const rgb = parseHexToRgb(hex);
  if (!rgb) {
    return 0;
  }

  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function calculateContrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return Number((((lighter + 0.05) / (darker + 0.05))).toFixed(2));
}

function normalizeHexColor(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    return normalized;
  }

  return `#${match[1].toUpperCase()}`;
}

function rgbStringToHex(value: string): string {
  const normalized = value.trim();
  const hex = normalizeHexColor(normalized);
  if (isValidHexColor(hex)) {
    return hex;
  }

  const rgbMatch = normalized.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgbMatch) {
    return normalized;
  }

  const r = clamp(Number(rgbMatch[1]), 0, 255);
  const g = clamp(Number(rgbMatch[2]), 0, 255);
  const b = clamp(Number(rgbMatch[3]), 0, 255);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function isLegacyColorAllowed(sourcePath: string): boolean {
  return sourcePath.toLowerCase().includes("legacy_color_map") || sourcePath.toLowerCase().includes("legacy_brand_blue");
}

function getExpectedCardTokens(cardId: string): DscCardIntrospection["expectedTokenSet"] {
  if (cardId === "design-system-controls") {
    return {
      background: "cardBackground",
      border: "border",
      titleText: "text",
      bodyText: "textSubtle",
    };
  }

  if (cardId === "title-card" || cardId === "settings-title") {
    return {
      background: "surface",
      border: "border",
      titleText: "text",
      bodyText: "textSubtle",
    };
  }

  return {
    background: "cardBackground",
    border: "border",
    titleText: "text",
    bodyText: "textSubtle",
  };
}

function mapCardType(cardId: string): DscCardIntrospection["cardType"] {
  if (cardId === "design-system-controls") {
    return "dsc";
  }
  if (cardId === "title-card" || cardId === "settings-title") {
    return "title";
  }
  if (cardId.includes("sync") || cardId.includes("status")) {
    return "status";
  }
  if (cardId.includes("example")) {
    return "example";
  }
  if (cardId.includes("settings") || cardId.includes("debug") || cardId.includes("updates") || cardId.includes("language")) {
    return "settings";
  }
  return "unknown";
}

function inferButtonTypeFromElement(button: Element): string {
  const explicit = button.getAttribute("data-button-type");
  if (explicit) {
    return explicit;
  }

  const className = button.className.toLowerCase();
  if (className.includes("primary")) {
    return "primary";
  }
  if (className.includes("secondary")) {
    return "secondary";
  }
  if (className.includes("ghost")) {
    return "ghost";
  }
  return "unknown";
}

function buildUiIntrospection(tokens: DesignTokens): { pages: DscPageIntrospection[] } {
  const noDomFallback: DscCardIntrospection = {
    pageId: "settings",
    cardId: "design-system-controls",
    cardType: "dsc",
    recipeName: "primary-surface-card",
    expectedTokenSet: getExpectedCardTokens("design-system-controls"),
    actualTokenSet: {
      background: tokens.color.resolved.cardBackground,
      border: tokens.color.resolved.border,
      titleText: tokens.color.resolved.text,
      bodyText: tokens.color.resolved.textSubtle,
    },
    backgroundColor: tokens.color.resolved.cardBackground,
    borderColor: tokens.color.resolved.border,
    titleTextColor: tokens.color.resolved.text,
    bodyTextColor: tokens.color.resolved.textSubtle,
    buttonTypes: ["active", "new", "pending", "error"],
    buttonTokenSets: [
      {
        type: "active",
        expectedTokenSet: { background: "buttonPrimary", border: "accentActive", text: "text" },
        computed: {
          backgroundColor: tokens.component.buttonPrimary.background,
          borderColor: tokens.component.buttonPrimary.border,
          textColor: tokens.component.buttonPrimary.text,
        },
      },
    ],
    fallbacksUsed: [],
    mismatches: [],
    legacyColorUsage: [],
    components: [],
  };

  if (typeof document === "undefined") {
    return {
      pages: [{ pageId: "settings", cards: [noDomFallback] }],
    };
  }

  const pageId = "settings";
  const cardSelectors = [
    ".settings-card[data-settings-card]",
    ".settings-card--design-system",
    ".cf-example-card",
  ];

  const nodeSet = new Set<Element>();
  for (const selector of cardSelectors) {
    document.querySelectorAll(selector).forEach((node) => {
      nodeSet.add(node);
    });
  }

  const cards: DscCardIntrospection[] = Array.from(nodeSet).map((node, index) => {
    const htmlNode = node as HTMLElement;
    const declaredId = htmlNode.dataset.settingsCard
      ?? (htmlNode.classList.contains("settings-card--design-system") ? "design-system-controls" : undefined)
      ?? (htmlNode.classList.contains("cf-example-card") ? "example-cards" : undefined)
      ?? `card-${index + 1}`;
    const expectedTokenSet = getExpectedCardTokens(declaredId);
    const style = window.getComputedStyle(htmlNode);
    const titleNode = htmlNode.querySelector("h1, h2, h3, h4, h5, h6") as HTMLElement | null;
    const bodyNode = htmlNode.querySelector("p, span, li") as HTMLElement | null;
    const titleStyle = titleNode ? window.getComputedStyle(titleNode) : null;
    const bodyStyle = bodyNode ? window.getComputedStyle(bodyNode) : null;

    const backgroundColor = rgbStringToHex(style.backgroundColor);
    const borderColor = rgbStringToHex(style.borderColor);
    const titleTextColor = rgbStringToHex(titleStyle?.color ?? style.color);
    const bodyTextColor = rgbStringToHex(bodyStyle?.color ?? style.color);

    const buttonElements = Array.from(htmlNode.querySelectorAll("button"));
    const buttonTypes = Array.from(new Set(buttonElements.map((button) => inferButtonTypeFromElement(button))));
    const buttonTokenSets = buttonElements.map((button) => {
      const buttonStyle = window.getComputedStyle(button);
      const buttonType = inferButtonTypeFromElement(button);
      const expected: { background: SemanticTokenName; border: SemanticTokenName; text: SemanticTokenName } = buttonType === "active"
        ? { background: "buttonPrimary", border: "accentActive", text: "text" }
        : buttonType === "pending"
          ? { background: "warning", border: "border", text: "text" }
          : buttonType === "error"
            ? { background: "error", border: "error", text: "text" }
            : { background: "buttonSecondary", border: "border", text: "text" };

      return {
        type: buttonType,
        expectedTokenSet: expected,
        computed: {
          backgroundColor: rgbStringToHex(buttonStyle.backgroundColor),
          borderColor: rgbStringToHex(buttonStyle.borderColor),
          textColor: rgbStringToHex(buttonStyle.color),
        },
      };
    });

    const components: DscComponentIntrospection[] = [];
    if (titleNode && titleStyle) {
      components.push({
        componentId: `${declaredId}-title`,
        componentType: "title",
        tokenSet: {
          background: expectedTokenSet.background,
          border: expectedTokenSet.border,
          text: expectedTokenSet.titleText,
        },
        computed: {
          backgroundColor,
          borderColor,
          textColor: rgbStringToHex(titleStyle.color),
        },
        fallbacksUsed: [],
        mismatches: [],
      });
    }

    const actualTokenSet = {
      background: backgroundColor,
      border: borderColor,
      titleText: titleTextColor,
      bodyText: bodyTextColor,
    };

    const mismatches: string[] = [];
    const expectedBackgroundColor = tokens.color.resolved[expectedTokenSet.background];
    if (isValidHexColor(backgroundColor) && backgroundColor.toUpperCase() !== normalizeHexColor(expectedBackgroundColor)) {
      mismatches.push(`background expected ${expectedBackgroundColor} but received ${backgroundColor}`);
    }
    const expectedBorderColor = tokens.color.resolved[expectedTokenSet.border];
    if (isValidHexColor(borderColor) && borderColor.toUpperCase() !== normalizeHexColor(expectedBorderColor)) {
      mismatches.push(`border expected ${expectedBorderColor} but received ${borderColor}`);
    }

    const legacyColorUsage = [backgroundColor, borderColor, titleTextColor, bodyTextColor]
      .filter((color) => normalizeHexColor(color) === LEGACY_BRAND_BLUE)
      .filter(() => !isLegacyColorAllowed(`cards.${declaredId}`));

    return {
      pageId,
      cardId: declaredId,
      cardType: mapCardType(declaredId),
      recipeName: declaredId === "design-system-controls" ? "dsc-surface-card" : "primary-surface-card",
      expectedTokenSet,
      actualTokenSet,
      backgroundColor,
      borderColor,
      titleTextColor,
      bodyTextColor,
      buttonTypes,
      buttonTokenSets,
      fallbacksUsed: mismatches.length > 0 ? ["token-resolution-mismatch"] : [],
      mismatches,
      legacyColorUsage,
      components,
    };
  });

  if (cards.length === 0) {
    return {
      pages: [{ pageId, cards: [noDomFallback] }],
    };
  }

  return {
    pages: [{ pageId, cards }],
  };
}

function getThemeModeForDebug(docRef?: Document): "light" | "dark" {
  const theme = docRef?.documentElement?.dataset?.theme ?? (typeof document !== "undefined" ? document.documentElement.dataset.theme : "light");
  return theme === "dark" ? "dark" : "light";
}

function normalizeDscDebugRecords(records: DscDebugResolutionRecord[]): DscDebugResolutionRecord[] {
  const maxRecords = readDscDebugMaxRecords();
  const maxAgeDays = readDscDebugMaxAgeDays();
  const minTimestamp = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

  const keptByAge = records.filter((record) => record.timestamp >= minTimestamp);
  if (keptByAge.length <= maxRecords) {
    return keptByAge;
  }

  return keptByAge.slice(keptByAge.length - maxRecords);
}

function loadDscDebugRecordsFromStorage(): DscDebugResolutionRecord[] {
  const storage = readStorage();
  const raw = storage?.getItem(DSC_DEBUG_RECORDS_KEY) ?? "";
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as DscDebugResolutionRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeDscDebugRecords(parsed);
  } catch {
    return [];
  }
}

function saveDscDebugRecordsToStorage(records: DscDebugResolutionRecord[]): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }

  storage.setItem(DSC_DEBUG_RECORDS_KEY, JSON.stringify(normalizeDscDebugRecords(records)));
}

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function buildDscDebugRecord(input: Omit<DscDebugResolutionRecord, "id" | "timestamp" | "requestedToken" | "resolvedToken" | "computedColor" | "componentName" | "componentState" | "contrastAgainstBackground" | "contrastAcceptable" | "cascadingFailureRisk">): DscDebugResolutionRecord {
  const contrastAcceptable = input.contrastRatio >= 4.5;
  const enforceContrast =
    input.sourcePath.toLowerCase().includes(".text")
    || input.sourcePath.toLowerCase().includes("textsubtle")
    || ((input.component === "alerts" || input.component === "badges") && input.interactionState === "default")
    || (input.component === "inputs" && input.interactionState === "default");
  const cascadingFailureRisk =
    input.reasonForFallback !== null
    || !isValidHexColor(input.computedValue)
    || (enforceContrast && !contrastAcceptable);

  return {
    id: `dsc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...input,
    requestedToken: input.requestedValue,
    resolvedToken: input.sourcePath,
    computedColor: input.computedValue,
    componentName: input.component,
    componentState: input.interactionState,
    contrastAgainstBackground: input.contrastRatio,
    contrastAcceptable,
    cascadingFailureRisk,
  };
}

function appendDscDebugRecords(records: DscDebugResolutionRecord[]): void {
  if (!records.length) {
    return;
  }

  const existing = loadDscDebugRecordsFromStorage();
  saveDscDebugRecordsToStorage([...existing, ...records]);
}

export function isDscDebugModeEnabled(): boolean {
  const storage = readStorage();
  const stored = storage?.getItem(DSC_DEBUG_ENABLED_KEY);
  if (stored !== null && stored !== undefined) {
    return stored === "true";
  }

  if (typeof process !== "undefined" && process.env) {
    return process.env.COURSEFORGE_DEBUG_DSC === "1";
  }

  return false;
}

export function setDscDebugModeEnabled(enabled: boolean): void {
  const storage = readStorage();
  storage?.setItem(DSC_DEBUG_ENABLED_KEY, String(enabled));
}

export function clearDscDebugRecords(): void {
  const storage = readStorage();
  storage?.removeItem(DSC_DEBUG_RECORDS_KEY);
}

export function getDscDebugRecords(): DscDebugResolutionRecord[] {
  return loadDscDebugRecordsFromStorage();
}

function buildComponentTokenMaps(tokens: DesignTokens): Record<string, Record<string, string>> {
  return {
    buttonPrimary: {
      default: tokens.component.buttonPrimary.background,
      hover: tokens.component.buttonPrimary.hover,
      active: tokens.component.buttonPrimary.active,
      disabled: tokens.component.buttonPrimary.disabled,
      focus: tokens.component.buttonPrimary.focusRing,
    },
    buttonSecondary: {
      default: tokens.component.buttonSecondary.background,
      hover: tokens.component.buttonSecondary.hover,
      active: tokens.component.buttonSecondary.active,
      disabled: tokens.component.buttonSecondary.disabled,
      focus: tokens.component.buttonSecondary.focusRing,
    },
    buttonGhost: {
      default: tokens.component.buttonGhost.background,
      hover: tokens.component.buttonGhost.hover,
      active: tokens.component.buttonGhost.active,
      disabled: tokens.component.buttonGhost.disabled,
      focus: tokens.component.buttonGhost.focusRing,
    },
    alerts: {
      success: tokens.component.alert.success,
      warning: tokens.component.alert.warning,
      error: tokens.component.alert.error,
      info: tokens.component.alert.info,
      text: tokens.component.alert.text,
    },
    badges: {
      success: tokens.component.badge.success,
      warning: tokens.component.badge.warning,
      error: tokens.component.badge.error,
      info: tokens.component.badge.info,
      text: tokens.component.badge.text,
    },
    inputs: {
      default: tokens.component.input.background,
      hover: tokens.component.input.hoverBorder,
      active: tokens.component.input.activeBorder,
      focus: tokens.component.input.focusRing,
      disabled: tokens.component.input.disabledBackground,
      text: tokens.component.input.text,
    },
  };
}

function buildCssVariableSnapshot(tokens: DesignTokens): Record<string, string> {
  return {
    "--cf-semantic-background": tokens.color.resolved.background,
    "--cf-semantic-surface": tokens.color.resolved.surface,
    "--cf-semantic-border": tokens.color.resolved.border,
    "--cf-semantic-text": tokens.color.resolved.text,
    "--cf-semantic-accent": tokens.color.resolved.accent,
    "--cf-semantic-accent-hover": tokens.color.resolved.accentHover,
    "--cf-semantic-accent-active": tokens.color.resolved.accentActive,
    "--cf-semantic-success": tokens.color.resolved.success,
    "--cf-semantic-warning": tokens.color.resolved.warning,
    "--cf-semantic-error": tokens.color.resolved.error,
    "--cf-semantic-info": tokens.color.resolved.info,
    "--cf-ds-harmony-major": tokens.harmony.colors.major,
    "--cf-ds-harmony-minor": tokens.harmony.colors.minor,
    "--cf-ds-harmony-accent": tokens.harmony.colors.accent,
  };
}

function buildFallbackRecords(tokens: DesignTokens, themeMode: "light" | "dark"): DscDebugResolutionRecord[] {
  const records: DscDebugResolutionRecord[] = [];
  const defaultBackground = tokens.color.resolved.background;

  for (const tokenName of SEMANTIC_TOKEN_NAMES) {
    const role = tokens.color.assignments[tokenName];
    const shadeIndex = SEMANTIC_TOKEN_SHADE_INDEX[tokenName] + 1;
    const requested = `${role}+${shadeIndex}`;
    const computed = tokens.color.resolved[tokenName];
    const lockedColor = LOCKED_SEMANTIC_PALETTE[role];
    const usedFallback = computed.toLowerCase() !== lockedColor.toLowerCase();
    const contrastRatio = calculateContrastRatio(computed, defaultBackground);

    records.push(buildDscDebugRecord({
      semanticRole: role,
      sourcePath: `semanticAssignments.${tokenName}`,
      requestedValue: requested,
      computedValue: computed,
      fallbackChain: [
        `semanticAssignments.${tokenName}`,
        `roles.${role}.shades[${shadeIndex}]`,
        `lockedPalette.${role}`,
      ],
      reasonForFallback: usedFallback ? `Computed value diverged from locked palette ${lockedColor}.` : null,
      component: "tokens",
      interactionState: "default",
      contrastRatio,
      themeMode,
    }));
  }

  const componentStates: Array<{ component: DscComponentName; state: DscInteractionState; value: string; bg: string; token: string }> = [
    { component: "buttons", state: "default", value: tokens.component.buttonPrimary.background, bg: tokens.color.resolved.background, token: "component.buttons.default" },
    { component: "buttons", state: "hover", value: tokens.component.buttonPrimary.hover, bg: tokens.color.resolved.background, token: "component.buttons.hover" },
    { component: "buttons", state: "active", value: tokens.component.buttonPrimary.active, bg: tokens.color.resolved.background, token: "component.buttons.active" },
    { component: "buttons", state: "disabled", value: tokens.component.buttonPrimary.disabled, bg: tokens.color.resolved.background, token: "component.buttons.disabled" },
    { component: "buttons", state: "focus", value: tokens.component.buttonPrimary.focusRing, bg: tokens.color.resolved.background, token: "component.buttons.focus" },
    { component: "inputs", state: "default", value: tokens.component.input.background, bg: tokens.color.resolved.background, token: "component.inputs.default" },
    { component: "inputs", state: "hover", value: tokens.component.input.hoverBorder, bg: tokens.color.resolved.background, token: "component.inputs.hover" },
    { component: "inputs", state: "active", value: tokens.component.input.activeBorder, bg: tokens.color.resolved.background, token: "component.inputs.active" },
    { component: "inputs", state: "disabled", value: tokens.component.input.disabledBackground, bg: tokens.color.resolved.background, token: "component.inputs.disabled" },
    { component: "inputs", state: "focus", value: tokens.component.input.focusRing, bg: tokens.color.resolved.background, token: "component.inputs.focus" },
    { component: "inputs", state: "default", value: tokens.component.input.text, bg: tokens.component.input.background, token: "component.inputs.text" },
  ];

  for (const entry of componentStates) {
    records.push(buildDscDebugRecord({
      semanticRole: "major",
      sourcePath: entry.token,
      requestedValue: entry.value,
      computedValue: entry.value,
      fallbackChain: [
        `component.${entry.component}.${entry.state}`,
        "resolvedSemantic",
        "lockedPalette",
      ],
      reasonForFallback: null,
      component: entry.component,
      interactionState: entry.state,
      contrastRatio: calculateContrastRatio(entry.value, entry.bg),
      themeMode,
    }));
  }

  return records;
}

function shouldEnforceContrast(record: DscDebugResolutionRecord): boolean {
  const source = record.sourcePath.toLowerCase();
  return source.includes(".text") || source.includes("textsubtle");
}

function detectCascadingFailureRisks(
  records: DscDebugResolutionRecord[],
  tokens: DesignTokens,
  uiIntrospection: { pages: DscPageIntrospection[] },
): DscCascadingFailureRisk[] {
  const risks: DscCascadingFailureRisk[] = [];

  for (const record of records) {
    const computed = record.computedColor || record.computedValue;
    const requested = record.requestedToken || record.requestedValue;

    if (!requested) {
      risks.push({
        code: "missing-token",
        message: `Missing requested token for ${record.sourcePath}.`,
        token: record.sourcePath,
        component: record.component,
        state: record.interactionState,
        themeMode: record.themeMode,
      });
    }

    if (!isValidHexColor(computed)) {
      risks.push({
        code: "invalid-hex",
        message: `Computed color is not a valid hex value (${computed}).`,
        token: record.sourcePath,
        component: record.component,
        state: record.interactionState,
        themeMode: record.themeMode,
      });
    }

    if (shouldEnforceContrast(record) && !record.contrastAcceptable) {
      risks.push({
        code: "low-contrast",
        message: `Contrast ratio ${record.contrastAgainstBackground.toFixed(2)} is below WCAG AA.`,
        token: record.sourcePath,
        component: record.component,
        state: record.interactionState,
        themeMode: record.themeMode,
      });
    }

    if (record.reasonForFallback) {
      risks.push({
        code: "unexpected-fallback",
        message: record.reasonForFallback,
        token: record.sourcePath,
        component: record.component,
        state: record.interactionState,
        themeMode: record.themeMode,
      });
    }

    if (normalizeHexColor(computed) === LEGACY_BRAND_BLUE && !isLegacyColorAllowed(record.sourcePath)) {
      risks.push({
        code: "legacy-color-use",
        message: `Legacy color ${LEGACY_BRAND_BLUE} detected in ${record.sourcePath} without whitelist approval.`,
        token: record.sourcePath,
        component: record.component,
        state: record.interactionState,
        themeMode: record.themeMode,
      });
    }

    if (record.fallbackChain.some((step) => step.toLowerCase().includes("harmony")) && record.component === "tokens") {
      risks.push({
        code: "harmony-override-attempt",
        message: `Harmony fallback chain touched locked semantic token ${record.sourcePath}.`,
        token: record.sourcePath,
        component: record.component,
        state: record.interactionState,
        themeMode: record.themeMode,
      });
    }

    if (record.component === "tokens") {
      const locked = LOCKED_SEMANTIC_PALETTE[record.semanticRole];
      if (computed.toLowerCase() !== locked.toLowerCase()) {
        risks.push({
          code: "token-drift",
          message: `Token drift detected for ${record.semanticRole}. Expected ${locked} but got ${computed}.`,
          token: record.sourcePath,
          component: record.component,
          state: record.interactionState,
          themeMode: record.themeMode,
        });
      }
    }
  }

  const crossModeDrift = SEMANTIC_PALETTE_ROLES.filter((role) => {
    return tokens.color.roles[role].shades[4].toLowerCase() !== LOCKED_SEMANTIC_PALETTE[role].toLowerCase();
  });

  for (const role of crossModeDrift) {
    risks.push({
      code: "cross-mode-inconsistency",
      message: `Role ${role} diverged from locked palette between mode layers.`,
      token: `roles.${role}.shades[4]`,
      component: "tokens",
      state: "default",
      themeMode: "light",
    });
  }

  for (const page of uiIntrospection.pages) {
    for (const card of page.cards) {
      for (const legacyColor of card.legacyColorUsage) {
        risks.push({
          code: "legacy-color-use",
          message: `Legacy color ${legacyColor} detected in card ${card.cardId}.`,
          token: `uiIntrospection.${page.pageId}.${card.cardId}`,
          component: "tokens",
          state: "default",
          themeMode: "light",
        });
      }

      for (const mismatch of card.mismatches) {
        risks.push({
          code: "unexpected-fallback",
          message: `Card mismatch in ${card.cardId}: ${mismatch}`,
          token: `uiIntrospection.${page.pageId}.${card.cardId}`,
          component: "tokens",
          state: "default",
          themeMode: "light",
        });
      }
    }
  }

  const dedupe = new Map<string, DscCascadingFailureRisk>();
  for (const risk of risks) {
    const key = `${risk.code}|${risk.token}|${risk.component}|${risk.state}|${risk.themeMode}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, risk);
    }
  }

  return Array.from(dedupe.values());
}

export function generateDscDebugReport(preferencesInput?: DesignTokenPreferences): DscDebugReport {
  const preferences = preferencesInput ? sanitizeDesignTokenPreferences(preferencesInput) : loadLocalDesignTokenPreferences();
  const tokens = generateDesignTokens(preferences);
  const themeMode = getThemeModeForDebug();
  const records = buildFallbackRecords(tokens, themeMode);

  if (isDscDebugModeEnabled()) {
    appendDscDebugRecords(records);
  }

  const rawRecords = isDscDebugModeEnabled() ? getDscDebugRecords() : records;
  const reportRecords = rawRecords.map((record) => {
    const computedColor = record.computedColor ?? record.computedValue;
    const requestedToken = record.requestedToken ?? record.requestedValue;
    const resolvedToken = record.resolvedToken ?? record.sourcePath;
    const contrastAgainstBackground = record.contrastAgainstBackground ?? record.contrastRatio;
    const contrastAcceptable = typeof record.contrastAcceptable === "boolean" ? record.contrastAcceptable : contrastAgainstBackground >= 4.5;
    const cascadingFailureRisk = typeof record.cascadingFailureRisk === "boolean"
      ? record.cascadingFailureRisk
      : Boolean(record.reasonForFallback) || !isValidHexColor(computedColor) || !contrastAcceptable;

    return {
      ...record,
      computedColor,
      requestedToken,
      resolvedToken,
      componentName: record.componentName ?? record.component,
      componentState: record.componentState ?? record.interactionState,
      contrastAgainstBackground,
      contrastAcceptable,
      cascadingFailureRisk,
    };
  });
  const componentMaps = buildComponentTokenMaps(tokens);
  const uiIntrospection = buildUiIntrospection(tokens);
  const cascadingRisks = detectCascadingFailureRisks(reportRecords, tokens, uiIntrospection);

  const contrastChecks = reportRecords.map((record) => ({
    component: record.component,
    interactionState: record.interactionState,
    foreground: record.computedColor,
    background: tokens.color.resolved.background,
    ratio: record.contrastAgainstBackground,
    themeMode: record.themeMode,
  }));

  return {
    generatedAt: new Date().toISOString(),
    debugMode: isDscDebugModeEnabled(),
    palette: { ...LOCKED_SEMANTIC_PALETTE },
    semanticTokens: {
      roles: Object.fromEntries(SEMANTIC_PALETTE_ROLES.map((role) => [role, tokens.color.roles[role].shades[4]])) as Record<SemanticPaletteRole, string>,
      resolved: { ...tokens.color.resolved },
    },
    cssVariablesSnapshot: buildCssVariableSnapshot(tokens),
    componentTokenMaps: componentMaps,
    fallbackRecords: reportRecords,
    contrastChecks,
    cascadingFailureSummary: {
      riskCount: cascadingRisks.length,
      risks: cascadingRisks,
    },
    uiIntrospection,
    themeGeneration: {
      mode: themeMode,
      harmony: tokens.harmony,
      semantic: tokens.color.semantic,
    },
  };
}

export async function logDesignSystemDebugEvent(message: string, context: Record<string, unknown> = {}): Promise<void> {
  await appendDebugLogEntry({
    eventType: "info",
    message,
    context,
  });
}

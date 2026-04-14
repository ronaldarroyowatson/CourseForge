import { appendDebugLogEntry } from "./debugLogService";

export type MotionEasing = "ease-in" | "ease-out" | "ease-in-out";
export type DirectionalFlow = "left-to-right" | "right-to-left";
export type StrokePreset = "common" | "doubling" | "soft" | "ultra-thin" | "sweet-spot";
export type CardShadeMode = "auto" | "manual";
export type HarmonyMode = "mono" | "analogous" | "complementary" | "split-complementary" | "triadic" | "tetradic" | "brand";

export const HARMONY_MODES: HarmonyMode[] = ["mono", "analogous", "complementary", "split-complementary", "triadic", "tetradic", "brand"];

export interface SemanticColors {
  error: string;
  success: string;
  pending: string;
  new: string;
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
  cardShadowShadeMode: CardShadeMode;
  cardShadowShade: number;
  cardGlowShadeMode: CardShadeMode;
  cardGlowShade: number;
  cardGradientStrength: number;
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
    shadowShade: number;
    glowShade: number;
    gradientStrength: number;
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

export const DEFAULT_DESIGN_TOKEN_PREFERENCES: DesignTokenPreferences = {
  gamma: 2.2,
  typeRatio: 1.25,
  strokePreset: "sweet-spot",
  spacingRatio: 1.25,
  motionTimingMs: 300,
  motionEasing: "ease-in-out",
  primaryHue: 212,
  semanticColors: {
    error: "#d14343",
    success: "#1f9d62",
    pending: "#d9a227",
    new: "#2f76d2",
  },
  useSystemDefaults: false,
  directionalFlow: "left-to-right",
  cardBaseShade: 3,
  cardShadowShadeMode: "auto",
  cardShadowShade: 2,
  cardGlowShadeMode: "auto",
  cardGlowShade: 4,
  cardGradientStrength: 4,
  cardCornerRadius: 12,
  boxCornerRadius: 10,
  cardPaddingIndex: 4,
  cardHeight: 220,
  darkModeGlowIntensity: 6,
  darkModeGlowRadius: 18,
  lightModeShadowIntensity: 5,
  lightModeShadowRadius: 14,
  colorHarmonyMode: "complementary",
  colorHarmonyBaseHue: 212,
  colorHarmonyBrandHue: 22,
  buttonHoverEnabled: true,
  buttonSquishEnabled: true,
  buttonPressEnabled: true,
  buttonRippleEnabled: false,
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

function blendHue(fromHue: number, toHue: number, ratio: number): number {
  const start = ((fromHue % 360) + 360) % 360;
  const end = ((toHue % 360) + 360) % 360;
  const delta = ((((end - start) % 360) + 540) % 360) - 180;
  return ((start + delta * clamp(ratio, 0, 1)) % 360 + 360) % 360;
}

function generateHarmonyHues(baseHue: number, mode: HarmonyMode, brandHue: number): {
  majorHue: number;
  minorHue: number;
  accentHue: number;
  highlightHue: number;
} {
  const h = ((baseHue % 360) + 360) % 360;
  const b = ((brandHue % 360) + 360) % 360;

  const withBrand = (minor: number, accent: number) => {
    const majorHue = h;
    const minorHue = blendHue(minor, b, 0.28);
    const accentHue = blendHue(accent, b, 0.72);
    return {
      majorHue,
      minorHue,
      accentHue,
      highlightHue: minorHue,
    };
  };

  switch (mode) {
    case "mono":
      return withBrand(h, h);
    case "analogous":
      return withBrand((h + 30) % 360, (h + 330) % 360);
    case "complementary":
      return withBrand((h + 180) % 360, (h + 210) % 360);
    case "split-complementary":
      return withBrand((h + 150) % 360, (h + 210) % 360);
    case "triadic":
      return withBrand((h + 120) % 360, (h + 240) % 360);
    case "tetradic":
      return withBrand((h + 90) % 360, (h + 180) % 360);
    case "brand":
      return {
        majorHue: h,
        minorHue: blendHue(h, b, 0.6),
        accentHue: b,
        highlightHue: blendHue(h, b, 0.35),
      };
    default:
      return withBrand((h + 180) % 360, (h + 210) % 360);
  }
}

export function sanitizeDesignTokenPreferences(input: Partial<DesignTokenPreferences> | null | undefined): DesignTokenPreferences {
  const next = input ?? {};
  const semantic = next.semanticColors ?? DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors;
  const cardBaseShade = clampShade(next.cardBaseShade ?? DEFAULT_DESIGN_TOKEN_PREFERENCES.cardBaseShade, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardBaseShade);
  const cardShadowShadeMode = next.cardShadowShadeMode === "manual" ? "manual" : "auto";
  const cardGlowShadeMode = next.cardGlowShadeMode === "manual" ? "manual" : "auto";
  const manualCardShadow = clampShade(next.cardShadowShade ?? DEFAULT_DESIGN_TOKEN_PREFERENCES.cardShadowShade, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardShadowShade);
  const manualCardGlow = clampShade(next.cardGlowShade ?? DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGlowShade, DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGlowShade);
  const cardShadowShade = cardShadowShadeMode === "auto" ? clampShade(cardBaseShade - 1, 1) : manualCardShadow;
  const cardGlowShade = cardGlowShadeMode === "auto" ? clampShade(cardBaseShade + 1, 9) : manualCardGlow;

  return {
    gamma: clamp(typeof next.gamma === "number" ? next.gamma : DEFAULT_DESIGN_TOKEN_PREFERENCES.gamma, 2, 2.4),
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
    semanticColors: {
      error: parseHexColor(semantic.error ?? "", DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors.error),
      success: parseHexColor(semantic.success ?? "", DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors.success),
      pending: parseHexColor(semantic.pending ?? "", DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors.pending),
      new: parseHexColor(semantic.new ?? "", DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors.new),
    },
    useSystemDefaults: Boolean(next.useSystemDefaults),
    directionalFlow:
      next.directionalFlow === "left-to-right" || next.directionalFlow === "right-to-left"
        ? next.directionalFlow
        : DEFAULT_DESIGN_TOKEN_PREFERENCES.directionalFlow,
    cardBaseShade,
    cardShadowShadeMode,
    cardShadowShade,
    cardGlowShadeMode,
    cardGlowShade,
    cardGradientStrength: clamp(typeof next.cardGradientStrength === "number" ? next.cardGradientStrength : DEFAULT_DESIGN_TOKEN_PREFERENCES.cardGradientStrength, 0, 10),
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

  if (typeof candidate.gamma !== "number" || candidate.gamma < 2 || candidate.gamma > 2.4) {
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

  if (candidate.cardShadowShadeMode !== "auto" && candidate.cardShadowShadeMode !== "manual") {
    invalidFields.push("cardShadowShadeMode");
  }

  if (typeof candidate.cardShadowShade !== "number" || candidate.cardShadowShade < 1 || candidate.cardShadowShade > 9) {
    invalidFields.push("cardShadowShade");
  }

  if (candidate.cardGlowShadeMode !== "auto" && candidate.cardGlowShadeMode !== "manual") {
    invalidFields.push("cardGlowShadeMode");
  }

  if (typeof candidate.cardGlowShade !== "number" || candidate.cardGlowShade < 1 || candidate.cardGlowShade > 9) {
    invalidFields.push("cardGlowShade");
  }

  if (typeof candidate.cardGradientStrength !== "number" || candidate.cardGradientStrength < 0 || candidate.cardGradientStrength > 10) {
    invalidFields.push("cardGradientStrength");
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
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.error ?? ""))) {
      invalidFields.push("semanticColors.error");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.success ?? ""))) {
      invalidFields.push("semanticColors.success");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.pending ?? ""))) {
      invalidFields.push("semanticColors.pending");
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(String(semantic.new ?? ""))) {
      invalidFields.push("semanticColors.new");
    }
  }

  return {
    valid: invalidFields.length === 0,
    invalidFields,
    repaired: sanitizeDesignTokenPreferences(candidate),
  };
}

function buildPrimaryScale(hue: number, gamma: number): string[] {
  const shades: string[] = [];
  for (let index = 0; index < 9; index += 1) {
    const t = index / 8;
    const luminance = Math.pow(t, gamma);
    const lightness = 0.16 + luminance * 0.72;
    shades.push(hslToHex(hue, 0.68, lightness));
  }

  return shades;
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
  const effectiveBoxCornerRadius = preferences.useUnifiedCornerRadius
    ? preferences.buttonCornerRadius
    : preferences.boxCornerRadius;
  const effectiveButtonCornerRadius = preferences.useUnifiedCornerRadius
    ? preferences.boxCornerRadius
    : preferences.buttonCornerRadius;

  const primary = buildPrimaryScale(preferences.primaryHue, preferences.gamma);
  const typeScale = buildTypeScale(12, preferences.typeRatio);
  const baseShadeIndex = clampShade(preferences.cardBaseShade, 3) - 1;
  const shadowShadeIndex = clampShade(preferences.cardShadowShade, 2) - 1;
  const glowShadeIndex = clampShade(preferences.cardGlowShade, 4) - 1;
  const spacingScale = buildSpacingScale(4, preferences.spacingRatio);

  const harmonyHues = generateHarmonyHues(preferences.colorHarmonyBaseHue, preferences.colorHarmonyMode, preferences.colorHarmonyBrandHue);
  const majorPrimary = buildPrimaryScale(harmonyHues.majorHue, preferences.gamma);
  const minorPrimary = buildPrimaryScale(harmonyHues.minorHue, preferences.gamma);
  const accentPrimary = buildPrimaryScale(harmonyHues.accentHue, preferences.gamma);

  return {
    color: {
      primary,
      semantic: preferences.semanticColors,
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
      shadowShade: shadowShadeIndex + 1,
      glowShade: glowShadeIndex + 1,
      gradientStrength: preferences.cardGradientStrength,
      cornerRadius: effectiveBoxCornerRadius,
      padding: spacingScale[preferences.cardPaddingIndex] ?? spacingScale[4],
      height: preferences.cardHeight,
      darkModeGlowIntensity: preferences.darkModeGlowIntensity,
      darkModeGlowRadius: preferences.darkModeGlowRadius,
      lightModeShadowIntensity: preferences.lightModeShadowIntensity,
      lightModeShadowRadius: preferences.lightModeShadowRadius,
      colors: {
        base: primary[baseShadeIndex],
        shadow: primary[shadowShadeIndex],
        glow: primary[glowShadeIndex],
      },
    },
    harmony: {
      mode: preferences.colorHarmonyMode,
      baseHue: preferences.colorHarmonyBaseHue,
      brandHue: preferences.colorHarmonyBrandHue,
      majorHue: harmonyHues.majorHue,
      minorHue: harmonyHues.minorHue,
      accentHue: harmonyHues.accentHue,
      highlightHue: harmonyHues.highlightHue,
      colors: {
        major: majorPrimary[4],
        minor: minorPrimary[4],
        accent: accentPrimary[3],
        highlight: minorPrimary[5],
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

  root.style.setProperty("--cf-ds-semantic-error", tokens.color.semantic.error);
  root.style.setProperty("--cf-ds-semantic-success", tokens.color.semantic.success);
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
  root.style.setProperty("--cf-ds-card-gradient-strength", `${tokens.card.gradientStrength}%`);
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
  root.style.setProperty("--cf-ds-harmony-major-hue", String(tokens.harmony.majorHue));
  root.style.setProperty("--cf-ds-harmony-minor-hue", String(tokens.harmony.minorHue));
  root.style.setProperty("--cf-ds-harmony-accent-hue", String(tokens.harmony.accentHue));
  root.style.setProperty("--cf-ds-harmony-highlight-hue", String(tokens.harmony.highlightHue));
  root.style.setProperty("--cf-ds-btn-hover-enabled", tokens.button.hoverEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-btn-squish-enabled", tokens.button.squishEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-btn-press-enabled", tokens.button.pressEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-btn-ripple-enabled", tokens.button.rippleEnabled ? "1" : "0");
  root.style.setProperty("--cf-ds-btn-depth-intensity", String(tokens.button.depthIntensity));
  root.style.setProperty("--cf-ds-btn-depth-radius", `${tokens.button.depthRadius}px`);
  root.style.setProperty("--cf-ds-btn-radius", `${tokens.button.cornerRadius}px`);

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
      ...system.values,
      useSystemDefaults: true,
    });

    saveLocalDesignTokenPreferences(resolved);
    storage.setItem(DESIGN_TOKENS_FIRST_RUN_KEY, "1");

    traces.push({
      step: "first-run-detection",
      status: Object.keys(system.failed).length > 0 ? "fallback" : "success",
      message: Object.keys(system.failed).length > 0
        ? "System setting detection partially failed. Applied available values with defaults fallback."
        : "Applied system-derived design tokens for first run.",
      details: {
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
}

export function clearLocalDesignTokenPreferences(): void {
  const storage = readStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(DESIGN_TOKENS_STORAGE_KEY);
  storage.removeItem(DESIGN_TOKENS_BACKUP_KEY);
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

export async function logDesignSystemDebugEvent(message: string, context: Record<string, unknown> = {}): Promise<void> {
  await appendDebugLogEntry({
    eventType: "info",
    message,
    context,
  });
}

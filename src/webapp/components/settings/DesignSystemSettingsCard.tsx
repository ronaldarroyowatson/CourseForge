import React from "react";
import { createPortal } from "react-dom";

import {
  type CloudSettingsDecision,
  type DesignTokenPreferences,
  type HarmonyMode,
  type SemanticPaletteRole,
  type SemanticTokenName,
  HARMONY_MODES,
  SEMANTIC_PALETTE_ROLES,
  SEMANTIC_TOKEN_NAMES,
  LOCKED_SEMANTIC_PALETTE,
  deleteCloudDesignTokenPreferences,
  inspectCloudDesignTokenPreferences,
  loadDesignTokenPreferencesFromCloud,
  logDesignSystemDebugEvent,
  readLocalDesignTokenDiagnostics,
  resolveCloudSettingsDecision,
  saveDesignTokenPreferencesToCloud,
  sanitizeDesignTokenPreferences,
  tryRepairCorruptedLocalDesignSettings,
} from "../../../core/services/designSystemService";
import {
  logFibonacciLayoutDecision,
  selectTwoCardLayout,
} from "../../../core/services/fibonacciLayoutService";
import { useUIStore } from "../../store/uiStore";

interface DesignSystemSettingsCardProps {
  userId: string | null;
  placementClassName?: string;
}

type PersistenceMode = "local" | "cloud" | "merge";

type RatioPreset = {
  label: string;
  value: number;
  description: string;
};

type SectionPair = {
  key: string;
  preview: string;
  control: string;
};

const SECTION_PAIRS: SectionPair[] = [
  { key: "color-harmony", preview: "color-harmony-preview", control: "color-harmony-controls" },
  { key: "color-curve", preview: "color-curve-preview", control: "color-curve-controls" },
  { key: "token-assignment", preview: "token-assignment-preview", control: "token-assignment-controls" },
  { key: "card-styling", preview: "card-styling-preview", control: "card-styling-controls" },
  { key: "component-previews", preview: "component-previews-preview", control: "component-previews-controls" },
];

const TYPE_RATIO_PRESETS: RatioPreset[] = [
  { label: "Minor Second", value: 1.067, description: "Very Subtle" },
  { label: "Major Second", value: 1.125, description: "Subtle" },
  { label: "Minor Third", value: 1.2, description: "Noticeable" },
  { label: "Major Third", value: 1.25, description: "Clear" },
  { label: "Perfect Fourth", value: 1.333, description: "Strong" },
  { label: "Perfect Fifth", value: 1.5, description: "Bold" },
];

const SPACING_PRESETS: RatioPreset[] = [
  { label: "Balanced", value: 1.25, description: "Default" },
  { label: "Premium", value: 1.333, description: "Comfortable" },
  { label: "Authoritative", value: 1.5, description: "Strong rhythm" },
  { label: "Clean", value: 2.0, description: "Very open" },
];

const RATIO_PRESET_SNAP_EPSILON = 0.004;

const STROKE_PRESET_OPTIONS: Array<{ label: string; value: DesignTokenPreferences["strokePreset"]; descriptor: string }> = [
  { label: "Common", value: "common", descriptor: "1 -> 1.5 -> 2" },
  { label: "Doubling", value: "doubling", descriptor: "1 -> 2 -> 4" },
  { label: "Soft", value: "soft", descriptor: "1 -> 1.25 -> 1.5" },
  { label: "Ultra Thin", value: "ultra-thin", descriptor: "0.5 -> 1 -> 2 -> 3" },
  { label: "Sweet Spot", value: "sweet-spot", descriptor: "1 -> 1.5 -> 2 -> 3" },
];

const SHADE_OPTIONS = Array.from({ length: 9 }, (_, index) => index + 1);

const SHADOW_OFFSET_OPTIONS = [-1, -2, -3, -4] as const;
const GLOW_OFFSET_OPTIONS = [1, 2, 3, 4] as const;
const STROKE_SIZE_SNAP_POINTS = [0, 1, 1.5, 2, 3] as const;
const CARD_GRADIENT_FOCUS_OPTIONS: Array<{ label: string; value: DesignTokenPreferences["cardGradientFocus"] }> = [
  { label: "Top", value: "top" },
  { label: "Center", value: "center" },
  { label: "Bottom", value: "bottom" },
  { label: "Custom (x,y)", value: "custom" },
];
const CARD_TOKEN_REFERENCE_OPTIONS = [
  "major",
  "major+1",
  "major+2",
  "major+3",
  "major+4",
  "minor",
  "minor+1",
  "minor+2",
  "minor+3",
  "minor+4",
  "accent",
  "accent+1",
  "accent+2",
  "accent+3",
  "accent+4",
  "success",
  "success+1",
  "success+2",
  "warning",
  "warning+1",
  "warning+2",
  "error",
  "error+1",
  "error+2",
  "info",
  "info+1",
  "info+2",
] as const;

const CARD_PADDING_OPTIONS = [
  { label: "Space 0", value: 0 },
  { label: "Space 1", value: 1 },
  { label: "Space 2", value: 2 },
  { label: "Space 3", value: 3 },
  { label: "Space 4", value: 4 },
  { label: "Space 5", value: 5 },
];

const HARMONY_MODE_HELP_TEXT: Record<HarmonyMode, string> = {
  mono: "All harmony markers stay on the base hue for a monochrome ramp.",
  analogous: "Places harmony anchors at plus/minus 30 degrees from the base hue.",
  complementary: "Moves the harmony anchors to the opposite side of the wheel.",
  "split-complementary": "Uses the two neighbors around the complement for softer contrast.",
  triadic: "Spreads the palette across a 120 degree triangle for vivid balance.",
};

const SEMANTIC_TOKEN_LABELS: Record<SemanticTokenName, string> = {
  background: "Background",
  surface: "Surface",
  border: "Border",
  text: "Text",
  textSubtle: "Text Subtle",
  accent: "Accent",
  accentHover: "Accent Hover",
  accentActive: "Accent Active",
  success: "Success",
  warning: "Warning",
  error: "Error",
  info: "Info",
  cardBackground: "Card Background",
  cardShadow: "Card Shadow",
  cardGlow: "Card Glow",
  buttonPrimary: "Button Primary",
  buttonSecondary: "Button Secondary",
  buttonGhost: "Button Ghost",
};

const SEMANTIC_ROLE_LABELS: Record<SemanticPaletteRole, string> = {
  major: "Major",
  minor: "Minor",
  accent: "Accent",
  success: "Success",
  warning: "Warning",
  error: "Error",
  info: "Info",
};

const GAMMA_SNAP_POINTS = [1.8, 2.0, 2.2, 2.4];

const WHEEL_HELPER_VISIBLE_MS = 20_000;
const WHEEL_HELPER_HOVER_VISIBLE_MS = 6_000;

function toHexChannel(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

function hueToHex(hue: number, saturation = 68): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const saturationRatio = Math.min(1, Math.max(0, saturation / 100));
  const lightness = 0.53;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturationRatio;
  const x = c * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const m = lightness - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (normalizedHue < 60) {
    r = c;
    g = x;
  } else if (normalizedHue < 120) {
    r = x;
    g = c;
  } else if (normalizedHue < 180) {
    g = c;
    b = x;
  } else if (normalizedHue < 240) {
    g = x;
    b = c;
  } else if (normalizedHue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return `#${toHexChannel((r + m) * 255)}${toHexChannel((g + m) * 255)}${toHexChannel((b + m) * 255)}`;
}

function harmonyTokenHex(hue: number, saturation: number, gamma: number, darkMode: boolean): string {
  const saturationRatio = Math.min(1, Math.max(0, saturation / 100));

  const midpointT = 1 - (4 / 8);
  const luminance = Math.pow(midpointT, gamma);
  const lightness = darkMode ? 0.28 : (0.16 + luminance * 0.72);
  const normalizedHue = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturationRatio;
  const x = c * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const m = lightness - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (normalizedHue < 60) {
    r = c;
    g = x;
  } else if (normalizedHue < 120) {
    r = x;
    g = c;
  } else if (normalizedHue < 180) {
    g = c;
    b = x;
  } else if (normalizedHue < 240) {
    g = x;
    b = c;
  } else if (normalizedHue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return `#${toHexChannel((r + m) * 255)}${toHexChannel((g + m) * 255)}${toHexChannel((b + m) * 255)}`;
}

function hexToHsl(value: string): { hue: number; saturation: number } | null {
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
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { hue: 0, saturation: 0 };
  }

  let hue = 0;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  hue = (hue * 60 + 360) % 360;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return {
    hue,
    saturation: Math.round(Math.max(0, Math.min(1, saturation)) * 100),
  };
}

function pointerToHarmonySelection(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  fallbackHue: number,
): { hue: number; saturation: number } | null {
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const outerRadius = Math.min(rect.width, rect.height) / 2 - 8;

  if (distance > outerRadius + 10) {
    return null;
  }

  const hue = distance <= 2
    ? ((fallbackHue % 360) + 360) % 360
    : ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
  return {
    hue,
    saturation: Math.round(Math.max(0, Math.min(1, distance / outerRadius)) * 100),
  };
}

function DemoButton({
  variant,
  size,
  state = "default",
}: {
  variant: "primary" | "secondary" | "ghost" | "destructive";
  size: "sm" | "md" | "lg";
  state?: "default" | "hover" | "active" | "disabled" | "loading";
}): React.JSX.Element {
  const classes = ["cf-ds-btn", `cf-ds-btn--${variant}`, `cf-ds-btn--${size}`];
  const buttonType: UnifiedButtonType = state === "loading"
    ? "pending"
    : variant === "primary"
      ? "active"
      : variant === "destructive"
        ? "error"
        : "new";
  if (state !== "default") {
    classes.push(`cf-ds-btn--${state}`);
  }

  classes.push(getUnifiedButtonClass(buttonType));

  return (
    <button type="button" data-button-type={buttonType} className={classes.join(" ")} disabled={state === "disabled"}>
      {state === "loading" ? "Loading" : `${variant} ${size}`}
    </button>
  );
}

function motionDescription(value: number): string {
  if (value <= 100) {
    return "Micro (hover, toggle)";
  }

  if (value <= 300) {
    return "Default (modal, dropdown)";
  }

  return "XL (complex operations)";
}

function resolveClosestPreset(value: number, presets: RatioPreset[]): RatioPreset {
  return presets.reduce((closest, candidate) => {
    return Math.abs(candidate.value - value) < Math.abs(closest.value - value) ? candidate : closest;
  }, presets[0]);
}

function describePreset(value: number, presets: RatioPreset[]): string {
  const closest = resolveClosestPreset(value, presets);
  return `${closest.label} (${closest.description})`;
}

function parseRgbChannels(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance(red: number, green: number, blue: number): number {
  const convert = (channel: number): number => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const r = convert(red);
  const g = convert(green);
  const b = convert(blue);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(background: [number, number, number], foreground: [number, number, number]): number {
  const backgroundLum = relativeLuminance(background[0], background[1], background[2]);
  const foregroundLum = relativeLuminance(foreground[0], foreground[1], foreground[2]);
  const lighter = Math.max(backgroundLum, foregroundLum);
  const darker = Math.min(backgroundLum, foregroundLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function shadeLabel(value: number): string {
  return `Shade ${Math.max(1, Math.min(9, Math.round(value)))}`;
}

function formatOffsetLabel(offset: number): string {
  return `base ${offset >= 0 ? "+" : "-"}${Math.abs(offset)}`;
}

function formatRoleTokenLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  const parts = normalized.match(/^(major|minor|accent|success|warning|error|info)([+-]\d+)?$/);
  if (!parts) {
    return value;
  }

  const role = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
  const offset = parts[2] ?? "";
  return `${role}${offset}`;
}

type UnifiedButtonType = "active" | "new" | "error" | "pending";
type UnifiedButtonSize = "standard" | "large";

function getUnifiedButtonClass(
  buttonType: UnifiedButtonType,
  size: UnifiedButtonSize = "standard",
  extraClasses: Array<string | false | null | undefined> = [],
): string {
  const classes = ["cf-unified-btn", `cf-unified-btn--${buttonType}`];
  if (size === "large") {
    classes.push("cf-unified-btn--large");
  }

  for (const className of extraClasses) {
    if (className) {
      classes.push(className);
    }
  }

  return classes.join(" ");
}

export function DesignSystemSettingsCard({ userId, placementClassName }: DesignSystemSettingsCardProps): React.JSX.Element {
  const prefs = useUIStore((state) => state.designTokenPreferences);
  const tokens = useUIStore((state) => state.designTokens);
  const theme = useUIStore((state) => state.theme);
  const setPrefs = useUIStore((state) => state.setDesignTokenPreferences);
  const resetPrefs = useUIStore((state) => state.resetDesignTokenPreferences);
  const applySystemDefaults = useUIStore((state) => state.applySystemDesignTokenDefaults);

  const [status, setStatus] = React.useState<string | null>(null);
  const [persistenceMode, setPersistenceMode] = React.useState<PersistenceMode>("local");
  const [showKeepDialog, setShowKeepDialog] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState(12);
  const [cloudPromptVisible, setCloudPromptVisible] = React.useState(false);
  const [cloudPromptStatus, setCloudPromptStatus] = React.useState<string | null>(null);
  const [cloudDecisionBusy, setCloudDecisionBusy] = React.useState(false);
  const [corruptionStatus, setCorruptionStatus] = React.useState<string | null>(null);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isCollapsing, setIsCollapsing] = React.useState(false);
  const [flowTransitioning, setFlowTransitioning] = React.useState(false);
  const [collapseRequested, setCollapseRequested] = React.useState<false | string>(false);
  const [localDiagnostics, setLocalDiagnostics] = React.useState(() => readLocalDesignTokenDiagnostics());
  const confirmedRef = React.useRef<DesignTokenPreferences>(prefs);
  const countdownIdRef = React.useRef<number | null>(null);
  const collapseAfterDialogRef = React.useRef(false);
  const collapseTimerRef = React.useRef<number | null>(null);
  const fibonacciContainerRef = React.useRef<HTMLDivElement>(null);
  const collapsedCardRef = React.useRef<HTMLElement | null>(null);
  const overlayContentRef = React.useRef<HTMLDivElement | null>(null);
  const harmonyWheelCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const sectionRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const wheelDragActiveRef = React.useRef(false);
  const baseHarmonyHex = React.useMemo(() => {
    return LOCKED_SEMANTIC_PALETTE.major;
  }, []);
  const brandHarmonyHex = React.useMemo(() => {
    return LOCKED_SEMANTIC_PALETTE.major;
  }, []);
  const [baseHexInput, setBaseHexInput] = React.useState(() => baseHarmonyHex);
  const [brandHexInput, setBrandHexInput] = React.useState(() => brandHarmonyHex);
  const [wheelTarget, setWheelTarget] = React.useState<"base" | "brand">("base");
  const [wheelHelperVisible, setWheelHelperVisible] = React.useState(false);
  const wheelHelperHideTimeoutRef = React.useRef<number | null>(null);
  const semanticPreviewEntries = React.useMemo(() => {
    return SEMANTIC_TOKEN_NAMES.map((tokenName) => ({
      tokenName,
      label: SEMANTIC_TOKEN_LABELS[tokenName],
      role: prefs.semanticAssignments[tokenName],
      color: tokens.color.resolved[tokenName],
    }));
  }, [prefs.semanticAssignments, tokens.color.resolved]);
  const paletteRoleEntries = React.useMemo(() => {
    return SEMANTIC_PALETTE_ROLES.map((role) => ({
      role,
      label: SEMANTIC_ROLE_LABELS[role],
      hue: Math.round(tokens.color.roles[role].hue),
      color: tokens.color.roles[role].shades[4],
    }));
  }, [tokens.color.roles]);

  React.useEffect(() => {
    setLocalDiagnostics(readLocalDesignTokenDiagnostics());
  }, [prefs]);

  React.useEffect(() => {
    void logDesignSystemDebugEvent("Design system controls title updated.", {
      title: "Design System Controls",
      removedSuffix: "(New)",
    });
  }, []);

  React.useEffect(() => {
    if (isExpanded || isCollapsing) {
      return;
    }

    const node = collapsedCardRef.current;
    if (!node) {
      return;
    }

    const container = node.closest(".settings-grid");
    if (!(container instanceof HTMLElement)) {
      void logDesignSystemDebugEvent("Design system layout fallback triggered: settings grid container missing.", {
        fallback: "card-remains-in-current-grid-slot",
      });
      return;
    }

    const cardRect = node.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    void logDesignSystemDebugEvent("Design system layout container detected for collapsed card.", {
      containerClassName: container.className,
      containerRect: {
        top: Math.round(containerRect.top),
        left: Math.round(containerRect.left),
        width: Math.round(containerRect.width),
        height: Math.round(containerRect.height),
      },
      cardRect: {
        top: Math.round(cardRect.top),
        left: Math.round(cardRect.left),
        width: Math.round(cardRect.width),
        height: Math.round(cardRect.height),
      },
    });
  }, [isCollapsing, isExpanded, prefs.directionalFlow]);

  React.useEffect(() => {
    if (!isExpanded && !isCollapsing) {
      return;
    }

    const overlayNode = document.querySelector<HTMLElement>(".cf-ds-card-overlay");
    const innerNode = document.querySelector<HTMLElement>(".cf-ds-card-overlay__inner");
    const pageNode = document.querySelector<HTMLElement>(".settings-page");
    const rootStyle = window.getComputedStyle(document.documentElement);
    const pageStyle = pageNode ? window.getComputedStyle(pageNode) : null;
    const overlayStyle = overlayNode ? window.getComputedStyle(overlayNode) : null;
    const innerStyle = innerNode ? window.getComputedStyle(innerNode) : null;

    void logDesignSystemDebugEvent("DSC overlay stacking and overflow calibrated to viewport.", {
      overlayMode: "viewport-fixed",
      rootOverflowX: rootStyle.overflowX,
      rootOverflowY: rootStyle.overflowY,
      pageOverflowX: pageStyle?.overflowX ?? "unknown",
      pageOverflowY: pageStyle?.overflowY ?? "unknown",
      overlayZIndex: overlayStyle?.zIndex ?? "unknown",
      overlayOverflowY: overlayStyle?.overflowY ?? "unknown",
      innerOverflow: innerStyle?.overflow ?? "unknown",
      clippingRiskMitigation: "bypass-settings-surface-bounds",
    });

    return () => {
    };
  }, [isCollapsing, isExpanded]);

  React.useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const captureLayoutDecision = (): void => {
      const containerWidth =
        fibonacciContainerRef.current?.offsetWidth ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
      const decision = selectTwoCardLayout(containerWidth);
      void logFibonacciLayoutDecision(decision, {
        directionalFlow: prefs.directionalFlow,
        containerWidth,
        responsiveFallbackApplied: decision.mode === "vertical",
      });
    };

    captureLayoutDecision();
    window.addEventListener("resize", captureLayoutDecision);

    return () => {
      window.removeEventListener("resize", captureLayoutDecision);
    };
  }, [isExpanded, prefs.directionalFlow]);

  React.useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    void logDesignSystemDebugEvent("Design system mode detection applied for preview contrast.", {
      theme,
      exampleCardSurfaceToken: "--bg-panel",
      organizerBorderToken: theme === "dark" ? "semantic + white mix" : "semantic base",
      organizerTextToken: theme === "dark" ? "--text-primary (light)" : "--text-primary (dark)",
    });
  }, [isExpanded, theme]);

  React.useEffect(() => {
    setBaseHexInput(baseHarmonyHex);
  }, [baseHarmonyHex]);

  React.useEffect(() => {
    setBrandHexInput(brandHarmonyHex);
  }, [brandHarmonyHex]);

  const setWheelHelperVisibleWithReason = React.useCallback((nextVisible: boolean, reason: string): void => {
    setWheelHelperVisible((current) => {
      if (current !== nextVisible) {
        void logDesignSystemDebugEvent("Color wheel helper visibility changed.", {
          visible: nextVisible,
          reason,
        });
      }

      return nextVisible;
    });
  }, []);

  const scheduleWheelHelperAutoHide = React.useCallback((delayMs: number, reason: string): void => {
    if (wheelHelperHideTimeoutRef.current !== null) {
      window.clearTimeout(wheelHelperHideTimeoutRef.current);
    }

    wheelHelperHideTimeoutRef.current = window.setTimeout(() => {
      setWheelHelperVisibleWithReason(false, reason);
      wheelHelperHideTimeoutRef.current = null;
    }, delayMs);
  }, [setWheelHelperVisibleWithReason]);

  const revealWheelHelper = React.useCallback((reason: string, holdMs: number): void => {
    setWheelHelperVisibleWithReason(true, reason);
    scheduleWheelHelperAutoHide(holdMs, `${reason}-auto-hide`);
  }, [scheduleWheelHelperAutoHide, setWheelHelperVisibleWithReason]);

  React.useEffect(() => {
    if (!isExpanded) {
      if (wheelHelperHideTimeoutRef.current !== null) {
        window.clearTimeout(wheelHelperHideTimeoutRef.current);
        wheelHelperHideTimeoutRef.current = null;
      }

      setWheelHelperVisibleWithReason(false, "overlay-collapsed");
      return;
    }

    revealWheelHelper("expanded-overlay-load", WHEEL_HELPER_VISIBLE_MS);

    return () => {
      if (wheelHelperHideTimeoutRef.current !== null) {
        window.clearTimeout(wheelHelperHideTimeoutRef.current);
        wheelHelperHideTimeoutRef.current = null;
      }
    };
  }, [isExpanded, revealWheelHelper, setWheelHelperVisibleWithReason]);

  const applyHueFromPointer = React.useCallback((clientX: number, clientY: number, reason: string): void => {
    const canvas = harmonyWheelCanvasRef.current;
    if (!canvas) {
      return;
    }

    const currentPrefs = useUIStore.getState().designTokenPreferences;
    const selection = pointerToHarmonySelection(
      canvas,
      clientX,
      clientY,
      wheelTarget === "base" ? currentPrefs.colorHarmonyBaseHue : currentPrefs.colorHarmonyBrandHue,
    );
    if (selection === null) {
      return;
    }

    const roundedHue = Math.round(selection.hue * 10) / 10;
    const roundedSaturation = Math.round(selection.saturation);
    const nextPatch: Partial<DesignTokenPreferences> = {
      ...(currentPrefs.colorHarmonySaturationMode === "free" ? { colorHarmonySaturation: roundedSaturation } : {}),
    };

    if (wheelTarget === "base") {
      nextPatch.colorHarmonyBaseHue = roundedHue;
      setPrefs(nextPatch);
      setBaseHexInput(LOCKED_SEMANTIC_PALETTE.major);
    } else {
      if (currentPrefs.colorHarmonyBrandMode !== "derived") {
        nextPatch.colorHarmonyBrandHue = roundedHue;
      }
      setPrefs(nextPatch);
      setBrandHexInput(LOCKED_SEMANTIC_PALETTE.major);
    }

    void logDesignSystemDebugEvent("Color wheel interaction applied.", {
      reason,
      target: wheelTarget,
      previousHue: wheelTarget === "base" ? currentPrefs.colorHarmonyBaseHue : currentPrefs.colorHarmonyBrandHue,
      selectedHue: roundedHue,
      selectedSaturation: roundedSaturation,
      selectedHex: harmonyTokenHex(
        roundedHue,
        currentPrefs.colorHarmonySaturationMode === "free" ? roundedSaturation : currentPrefs.colorHarmonySaturation,
        currentPrefs.gamma,
        theme === "dark",
      ),
      saturationMode: currentPrefs.colorHarmonySaturationMode,
      brandMode: currentPrefs.colorHarmonyBrandMode,
      colorHarmonyMode: currentPrefs.colorHarmonyMode,
    });
  }, [setPrefs, theme, wheelTarget]);

  const handleWheelPointerDown = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = harmonyWheelCanvasRef.current;
    if (!canvas) {
      return;
    }

    wheelDragActiveRef.current = true;
    void logDesignSystemDebugEvent("Color wheel pointer down.", {
      pointerId: event.pointerId,
      clientX: Math.round(event.clientX),
      clientY: Math.round(event.clientY),
      target: wheelTarget,
    });

    applyHueFromPointer(event.clientX, event.clientY, "pointer-down");

    if (typeof canvas.setPointerCapture === "function") {
      canvas.setPointerCapture(event.pointerId);
    }
  }, [applyHueFromPointer, wheelTarget]);

  const handleWheelPointerMove = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!wheelDragActiveRef.current) {
      return;
    }

    void logDesignSystemDebugEvent("Color wheel pointer move.", {
      pointerId: event.pointerId,
      clientX: Math.round(event.clientX),
      clientY: Math.round(event.clientY),
      dragging: true,
      target: wheelTarget,
    });

    applyHueFromPointer(event.clientX, event.clientY, "pointer-drag");
  }, [applyHueFromPointer, wheelTarget]);

  const handleWheelPointerUp = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = harmonyWheelCanvasRef.current;
    wheelDragActiveRef.current = false;

    void logDesignSystemDebugEvent("Color wheel pointer up.", {
      pointerId: event.pointerId,
      clientX: Math.round(event.clientX),
      clientY: Math.round(event.clientY),
      target: wheelTarget,
    });

    if (
      canvas
      && typeof canvas.hasPointerCapture === "function"
      && typeof canvas.releasePointerCapture === "function"
      && canvas.hasPointerCapture(event.pointerId)
    ) {
      canvas.releasePointerCapture(event.pointerId);
    }

    applyHueFromPointer(event.clientX, event.clientY, "pointer-up");
  }, [applyHueFromPointer, wheelTarget]);

  const handleWheelPointerLeave = React.useCallback((): void => {
    wheelDragActiveRef.current = false;
  }, []);

  React.useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const buttonDepthTrace = {
      mode: theme,
      depthIntensity: prefs.buttonDepthIntensity,
      depthRadius: prefs.buttonDepthRadius,
      primaryBase: tokens.color.primary[5] ?? tokens.color.primary[4],
      secondaryBase: tokens.color.primary[3] ?? tokens.color.primary[2],
      ghostBase: tokens.color.primary[4] ?? tokens.color.primary[3],
      destructiveBase: prefs.semanticColors.error,
      organizerNew: prefs.semanticColors.new,
      organizerActive: prefs.semanticColors.success,
      organizerPending: prefs.semanticColors.pending,
      organizerError: prefs.semanticColors.error,
    };

    void logDesignSystemDebugEvent("Button depth colors recalculated.", buttonDepthTrace);
  }, [
    isExpanded,
    prefs.buttonDepthIntensity,
    prefs.buttonDepthRadius,
    prefs.semanticColors.error,
    prefs.semanticColors.new,
    prefs.semanticColors.pending,
    prefs.semanticColors.success,
    theme,
    tokens.color.primary,
  ]);

  React.useEffect(() => {
    const canvas = harmonyWheelCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      void logDesignSystemDebugEvent("Color harmony wheel render skipped: canvas context unavailable.", {
        reason: "2d-context-null",
      });
      return;
    }

    const cssWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.getBoundingClientRect().width || 240));
    const cssHeight = Math.max(1, Math.round(canvas.clientHeight || canvas.getBoundingClientRect().height || 240));
    const devicePixelRatio = window.devicePixelRatio || 1;
    const renderWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
    const renderHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));

    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(devicePixelRatio, devicePixelRatio);

    const width = cssWidth;
    const height = cssHeight;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 12;
    const markerRadius = radius * (prefs.colorHarmonySaturation / 100);

    context.clearRect(0, 0, width, height);

    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > radius) {
          continue;
        }

        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
        const saturation = Math.max(0, Math.min(1, distance / radius));
        const hex = hueToHex(hue, saturation * 100);
        const offset = (y * width + x) * 4;
        image.data[offset] = Number.parseInt(hex.slice(1, 3), 16);
        image.data[offset + 1] = Number.parseInt(hex.slice(3, 5), 16);
        image.data[offset + 2] = Number.parseInt(hex.slice(5, 7), 16);
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);

    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.lineWidth = 2;
    context.strokeStyle = tokens.color.resolved.border;
    context.stroke();

    const markers = [
      { hue: prefs.colorHarmonyBaseHue, color: tokens.harmony.colors.major, label: "Base" },
      { hue: tokens.harmony.effectiveBrandHue, color: tokens.harmony.colors.highlight, label: "Brand" },
      { hue: tokens.harmony.majorHue, color: tokens.harmony.colors.major, label: "Major" },
      { hue: tokens.harmony.minorHue, color: tokens.harmony.colors.minor, label: "Minor" },
      { hue: tokens.harmony.accentHue, color: tokens.harmony.colors.accent, label: "Accent" },
    ];

    const markerPositions: Array<{ label: string; hue: number; x: number; y: number }> = [];
    for (const marker of markers) {
      const radians = ((marker.hue - 90) * Math.PI) / 180;
      const x = centerX + Math.cos(radians) * markerRadius;
      const y = centerY + Math.sin(radians) * markerRadius;
      markerPositions.push({
        label: marker.label,
        hue: Math.round(marker.hue),
        x: Math.round(x),
        y: Math.round(y),
      });

      context.beginPath();
      context.arc(x, y, marker.label === "Base" || marker.label === "Brand" ? 6 : 5, 0, Math.PI * 2);
      context.fillStyle = marker.color;
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = tokens.color.resolved.text;
      context.stroke();
    }

    void logDesignSystemDebugEvent("Color harmony wheel rendered.", {
      mode: prefs.colorHarmonyMode,
      canvasCssWidth: cssWidth,
      canvasCssHeight: cssHeight,
      devicePixelRatio,
      baseHue: prefs.colorHarmonyBaseHue,
      brandHue: tokens.harmony.effectiveBrandHue,
      saturation: prefs.colorHarmonySaturation,
      majorHue: tokens.harmony.majorHue,
      minorHue: tokens.harmony.minorHue,
      accentHue: tokens.harmony.accentHue,
      markerPositions,
    });
  }, [
    prefs.colorHarmonyBaseHue,
    prefs.colorHarmonyBrandHue,
    prefs.colorHarmonyMode,
    prefs.colorHarmonySaturation,
    theme,
    tokens.harmony.accentHue,
    tokens.harmony.colors.accent,
    tokens.harmony.colors.highlight,
    tokens.harmony.colors.major,
    tokens.harmony.colors.minor,
    tokens.harmony.effectiveBrandHue,
    tokens.harmony.majorHue,
    tokens.harmony.minorHue,
  ]);

  React.useLayoutEffect(() => {
    if (!isExpanded) {
      for (const pair of SECTION_PAIRS) {
        const controlNode = sectionRefs.current[pair.control];
        const previewNode = sectionRefs.current[pair.preview];
        controlNode?.style.removeProperty("min-height");
        previewNode?.style.removeProperty("min-height");
      }
      return;
    }

    let frameId: number | null = null;

    const runAlignment = (reason: string): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        const alignmentDetails: Array<{
          section: string;
          controlHeight: number;
          previewHeight: number;
          appliedHeight: number;
          aligned: boolean;
        }> = [];

        for (const pair of SECTION_PAIRS) {
          const controlNode = sectionRefs.current[pair.control];
          const previewNode = sectionRefs.current[pair.preview];
          if (!controlNode || !previewNode) {
            void logDesignSystemDebugEvent("Adaptive pair-height fallback: section ref missing.", {
              section: pair.key,
              control: pair.control,
              preview: pair.preview,
              reason,
            });
            continue;
          }

          controlNode.style.removeProperty("min-height");
          previewNode.style.removeProperty("min-height");

          const controlRect = controlNode.getBoundingClientRect();
          const previewRect = previewNode.getBoundingClientRect();
          const adaptiveHeight = Math.ceil(Math.max(controlRect.height, previewRect.height));
          controlNode.style.minHeight = `${adaptiveHeight}px`;
          previewNode.style.minHeight = `${adaptiveHeight}px`;

          const controlTop = controlNode.getBoundingClientRect().top;
          const previewTop = previewNode.getBoundingClientRect().top;
          const topDelta = Math.round(previewTop - controlTop);
          const aligned = Math.abs(topDelta) <= 2;

          alignmentDetails.push({
            section: pair.key,
            controlHeight: Math.round(controlRect.height),
            previewHeight: Math.round(previewRect.height),
            appliedHeight: adaptiveHeight,
            aligned,
          });
        }

        void logDesignSystemDebugEvent("DSC per-pair adaptive height and alignment completed.", {
          reason,
          pairCount: SECTION_PAIRS.length,
          alignmentDetails,
          failedPairs: alignmentDetails.filter((d) => !d.aligned).length,
        });
      });
    };

    void logDesignSystemDebugEvent("Adaptive section pairing initialized for expanded layout.", {
      pairCount: SECTION_PAIRS.length,
      pairs: SECTION_PAIRS.map((p) => ({ key: p.key, preview: p.preview, control: p.control })),
      mode: "per-pair-adaptive-height",
    });

    runAlignment("expanded-layout-initial");
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => runAlignment("resize-observer")) : null;

    if (observer) {
      for (const pair of SECTION_PAIRS) {
        const controlNode = sectionRefs.current[pair.control];
        const previewNode = sectionRefs.current[pair.preview];
        if (controlNode) {
          observer.observe(controlNode);
        }
        if (previewNode) {
          observer.observe(previewNode);
        }
      }

      if (fibonacciContainerRef.current) {
        observer.observe(fibonacciContainerRef.current);
      }
    }

    const handleResize = (): void => runAlignment("window-resize");
    window.addEventListener("resize", handleResize);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, [isExpanded, prefs.directionalFlow, prefs.gamma, prefs.motionTimingMs, prefs.spacingRatio, prefs.typeRatio,
      prefs.darkModeGlowIntensity, prefs.darkModeGlowRadius, prefs.lightModeShadowIntensity, prefs.lightModeShadowRadius,
      prefs.buttonHoverEnabled, prefs.buttonSquishEnabled, prefs.buttonPressEnabled, prefs.buttonRippleEnabled,
      prefs.buttonDepthIntensity, prefs.buttonDepthRadius,
      prefs.colorHarmonyMode, prefs.colorHarmonyBaseHue, prefs.colorHarmonyBrandHue,
      prefs.boxCornerRadius, prefs.buttonCornerRadius, prefs.useUnifiedCornerRadius]);

  React.useEffect(() => {
    if (!isExpanded || !overlayContentRef.current) {
      return;
    }

    const emailCard = overlayContentRef.current.querySelector<HTMLElement>('[aria-label="Email input example"]');
    const emailInput = overlayContentRef.current.querySelector<HTMLInputElement>("#cf-ds-email-input");
    if (!emailCard || !emailInput) {
      return;
    }

    const logEmailSizing = (reason: string): void => {
      const cardRect = emailCard.getBoundingClientRect();
      const inputRect = emailInput.getBoundingClientRect();
      const overflowDetected = inputRect.right > cardRect.right + 0.5 || inputRect.left < cardRect.left - 0.5;

      void logDesignSystemDebugEvent("Email input size calculated.", {
        reason,
        cardWidth: Math.round(cardRect.width),
        inputWidth: Math.round(inputRect.width),
        overflowDetected,
      });

      if (overflowDetected) {
        void logDesignSystemDebugEvent("Email input overflow detected and constrained by sizing rules.", {
          reason,
          cardWidth: Math.round(cardRect.width),
          inputWidth: Math.round(inputRect.width),
        });
      }
    };

    logEmailSizing("expanded-layout-initial");
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => logEmailSizing("resize-observer")) : null;
    observer?.observe(emailCard);
    observer?.observe(emailInput);

    const handleResize = (): void => logEmailSizing("window-resize");
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, [isExpanded, prefs.typeRatio, prefs.spacingRatio]);

  React.useEffect(() => {
    if (!isExpanded || !overlayContentRef.current) {
      return;
    }

    const motionSection = sectionRefs.current["motion-preview"];
    const motionRow = overlayContentRef.current.querySelector<HTMLElement>(".cf-motion-row--right");
    if (!motionSection || !motionRow) {
      return;
    }

    const logMotionSizing = (reason: string): void => {
      const sectionRect = motionSection.getBoundingClientRect();
      const rowRect = motionRow.getBoundingClientRect();
      const widthPercent = sectionRect.width > 0 ? Number(((rowRect.width / sectionRect.width) * 100).toFixed(2)) : 0;
      const overflowDetected = rowRect.right > sectionRect.right + 0.5 || rowRect.left < sectionRect.left - 0.5;

      void logDesignSystemDebugEvent("Motion preview container size detected.", {
        reason,
        sectionWidth: Math.round(sectionRect.width),
        rowWidth: Math.round(rowRect.width),
        appliedWidthPercent: widthPercent,
        overflowDetected,
      });
    };

    logMotionSizing("expanded-layout-initial");
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => logMotionSizing("resize-observer")) : null;
    observer?.observe(motionSection);
    observer?.observe(motionRow);

    const handleResize = (): void => logMotionSizing("window-resize");
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, [isExpanded, prefs.directionalFlow, prefs.motionTimingMs, prefs.typeRatio, prefs.spacingRatio]);

  React.useEffect(() => {
    if (!isExpanded) {
      return;
    }

    void logDesignSystemDebugEvent("Type scale preview grid layout created.", {
      layout: "2x3",
      ordering: ["text-5xl", "text-4xl", "text-3xl", "text-2xl", "text-lg", "base"],
      spacingToken: "--cf-ds-space-*",
    });

    void logDesignSystemDebugEvent("Type scale preview dynamic resizing applied.", {
      typeRatio: prefs.typeRatio,
      sizes: {
        text5xl: tokens.type.scale["text-5xl"],
        text4xl: tokens.type.scale["text-4xl"],
        text3xl: tokens.type.scale["text-3xl"],
        text2xl: tokens.type.scale["text-2xl"],
        textLg: tokens.type.scale["text-lg"],
        base: tokens.type.base,
      },
    });

    void logDesignSystemDebugEvent("Spacing scale preview grid layout created.", {
      layout: "2x2",
      spacingRatio: prefs.spacingRatio,
      spacingTokens: tokens.spacing.values.slice(1, 5),
    });

    void logDesignSystemDebugEvent("Harmony preview relocated to example color-scale section.", {
      source: "controls-color-system",
      destination: "example-color-scale",
      includesLabels: ["Major", "Minor", "Accent"],
      spacingToken: "--cf-ds-space-3",
    });

    void logDesignSystemDebugEvent("Color scale to harmony preview spacing applied.", {
      section: "example-color-scale",
      spacingToken: "--cf-ds-space-3",
    });
  }, [isExpanded, prefs.spacingRatio, prefs.typeRatio, tokens.spacing.values, tokens.type.base, tokens.type.scale]);

  React.useEffect(() => {
    if (!isExpanded || !overlayContentRef.current) {
      return;
    }

    const contrastTargets = [
      { selector: ".cf-ds-btn--ghost", label: "ghost-button" },
      { selector: ".cf-ds-btn--secondary.cf-ds-btn--sm", label: "secondary-sm-button" },
    ];

    for (const target of contrastTargets) {
      const node = overlayContentRef.current.querySelector<HTMLElement>(target.selector);
      if (!node) {
        continue;
      }

      const computed = window.getComputedStyle(node);
      const background = parseRgbChannels(computed.backgroundColor);
      const foreground = parseRgbChannels(computed.color);
      if (!background || !foreground) {
        continue;
      }

      const ratio = contrastRatio(background, foreground);
      void logDesignSystemDebugEvent("Button contrast validation computed.", {
        target: target.label,
        backgroundColor: computed.backgroundColor,
        textColor: computed.color,
        contrastRatio: Number(ratio.toFixed(2)),
        validContrast: ratio >= 4.5,
      });
    }
  }, [isExpanded, prefs.gamma, prefs.motionTimingMs, prefs.semanticColors.error, prefs.semanticColors.new, prefs.semanticColors.pending, prefs.semanticColors.success]);

  React.useEffect(() => {
    if (!isExpanded || !overlayContentRef.current) {
      return;
    }

    const cards = overlayContentRef.current.querySelectorAll<HTMLElement>(".cf-sample-card");
    cards.forEach((card, index) => {
      const computed = window.getComputedStyle(card);
      const background = parseRgbChannels(computed.backgroundColor);
      const foreground = parseRgbChannels(computed.color);
      if (!background || !foreground) {
        return;
      }

      const ratio = contrastRatio(background, foreground);
      const validContrast = ratio >= 4.5;
      void logDesignSystemDebugEvent("Card contrast validation computed.", {
        card: card.getAttribute("aria-label") ?? `sample-card-${index + 1}`,
        backgroundColor: computed.backgroundColor,
        textColor: computed.color,
        contrastRatio: Number(ratio.toFixed(2)),
        validContrast,
      });
    });
  }, [
    isExpanded,
    prefs.gamma,
    prefs.semanticColors.error,
    prefs.semanticColors.new,
    prefs.semanticColors.pending,
    prefs.semanticColors.success,
  ]);

  React.useEffect(() => {
    if (!isExpanded) {
      return;
    }

    void logDesignSystemDebugEvent("Compact base/brand color and hue rows applied.", {
      layout: "two-rows-paired",
      row1: ["base-color-hex", "base-hue"],
      row2: ["brand-color-hex", "brand-hue"],
      baseHue: prefs.colorHarmonyBaseHue,
      brandHue: prefs.colorHarmonyBrandHue,
      wheelTarget,
    });
  }, [isExpanded, prefs.colorHarmonyBaseHue, prefs.colorHarmonyBrandHue, wheelTarget]);

  React.useEffect(() => {
    if (!isExpanded || isCollapsing) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const overlayNode = overlayContentRef.current;
      if (!overlayNode) {
        return;
      }

      if (overlayNode.contains(target)) {
        return;
      }

      void logDesignSystemDebugEvent("Design system click-off detected.", {
        trigger: "pointerdown-outside-overlay",
      });
      requestCollapse("click-off-global");
      void logDesignSystemDebugEvent("Design system click-off collapse triggered.", {
        trigger: "click-off-global",
        easing: "ease-out",
      });
    };

    window.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isCollapsing, isExpanded]);

  React.useEffect(() => {
    if (!userId) {
      setCloudPromptVisible(false);
      return;
    }

    void (async () => {
      try {
        const cloudInfo = await inspectCloudDesignTokenPreferences(userId);
        if (!cloudInfo.exists) {
          setCloudPromptVisible(false);
          setCloudPromptStatus("No cloud design settings detected for this account.");
          void logDesignSystemDebugEvent("Cloud design settings lookup: not found.", { userId });
          return;
        }

        if (!cloudInfo.valid) {
          setCloudPromptVisible(true);
          setCloudPromptStatus(`Cloud design settings are corrupted (${cloudInfo.invalidFields.join(", ")}).`);
          void logDesignSystemDebugEvent("Cloud design settings lookup: corrupted.", {
            userId,
            invalidFields: cloudInfo.invalidFields,
          });
          return;
        }

        setCloudPromptVisible(true);
        setCloudPromptStatus("Cloud design settings found.");
        void logDesignSystemDebugEvent("Cloud design settings lookup: valid settings found.", { userId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_cloud_lookup_error";
        setCloudPromptStatus(`Unable to check cloud settings: ${message}`);
        void logDesignSystemDebugEvent("Cloud design settings lookup failed.", { userId, message });
      }
    })();
  }, [userId]);

  React.useEffect(() => {
    void logDesignSystemDebugEvent("Example card preview updated.", {
      gamma: prefs.gamma,
      typeRatio: prefs.typeRatio,
      spacingRatio: prefs.spacingRatio,
      strokePreset: prefs.strokePreset,
      motionTimingMs: prefs.motionTimingMs,
      motionEasing: prefs.motionEasing,
      cardBaseShade: prefs.cardBaseShade,
      cardShadowOffset: prefs.cardShadowOffset,
      cardShadowOffsetMode: prefs.cardShadowOffsetMode,
      cardGlowOffset: prefs.cardGlowOffset,
      cardGlowOffsetMode: prefs.cardGlowOffsetMode,
      cardStrokeSize: prefs.cardStrokeSize,
      cardStrokeRole: prefs.cardStrokeRole,
      cardGradientEnabled: prefs.cardGradientEnabled,
      cardGradientStart: prefs.cardGradientStart,
      cardGradientEnd: prefs.cardGradientEnd,
      cardGradientStrength: prefs.cardGradientStrength,
      cardGradientAngle: prefs.cardGradientAngle,
      cardGradientFocus: prefs.cardGradientFocus,
      cardGradientScale: prefs.cardGradientScale,
      cardOverlayEnabled: prefs.cardOverlayEnabled,
      cardOverlayStrength: prefs.cardOverlayStrength,
      cardOverlayRole: prefs.cardOverlayRole,
      settingsBaseLightLuminance: prefs.settingsBaseLightLuminance,
      settingsBaseDarkLuminance: prefs.settingsBaseDarkLuminance,
      cardCornerRadius: prefs.cardCornerRadius,
      cardPaddingIndex: prefs.cardPaddingIndex,
      cardHeight: prefs.cardHeight,
    });
    void logDesignSystemDebugEvent("Email input example rendered with tokenized styles.", {
      component: "email-input-preview",
      typeToken: "--cf-ds-type-base",
      spacingToken: "--cf-ds-space-*",
      strokeToken: "--cf-ds-stroke-*",
      colorTokens: ["--bg-panel", "--text-primary", "--cf-ds-primary-3"],
      motionTokens: ["--cf-ds-motion-ms", "--cf-ds-motion-easing"],
    });
  }, [
    prefs.cardBaseShade,
    prefs.cardCornerRadius,
    prefs.cardGlowOffset,
    prefs.cardGlowOffsetMode,
    prefs.cardGradientEnabled,
    prefs.cardGradientStart,
    prefs.cardGradientEnd,
    prefs.cardGradientStrength,
    prefs.cardGradientAngle,
    prefs.cardGradientFocus,
    prefs.cardGradientFocusX,
    prefs.cardGradientFocusY,
    prefs.cardGradientScale,
    prefs.cardHeight,
    prefs.cardOverlayEnabled,
    prefs.cardOverlayStrength,
    prefs.cardOverlayRole,
    prefs.cardPaddingIndex,
    prefs.cardShadowOffset,
    prefs.cardShadowOffsetMode,
    prefs.cardStrokeSize,
    prefs.cardStrokeRole,
    prefs.settingsBaseLightLuminance,
    prefs.settingsBaseDarkLuminance,
    prefs.gamma,
    prefs.motionEasing,
    prefs.motionTimingMs,
    prefs.spacingRatio,
    prefs.strokePreset,
    prefs.typeRatio,
    prefs.darkModeGlowIntensity,
    prefs.darkModeGlowRadius,
    prefs.lightModeShadowIntensity,
    prefs.lightModeShadowRadius,
    prefs.buttonHoverEnabled,
    prefs.buttonSquishEnabled,
    prefs.buttonPressEnabled,
    prefs.buttonRippleEnabled,
    prefs.colorHarmonyMode,
    prefs.colorHarmonyBaseHue,
  ]);

  React.useEffect(() => {
    if (!showKeepDialog) {
      if (countdownIdRef.current !== null) {
        window.clearInterval(countdownIdRef.current);
      }
      countdownIdRef.current = null;
      return;
    }

    countdownIdRef.current = window.setInterval(() => {
      setSecondsLeft((previous) => {
        return previous <= 1 ? 0 : previous - 1;
      });
    }, 1000);

    return () => {
      if (countdownIdRef.current !== null) {
        window.clearInterval(countdownIdRef.current);
      }
      countdownIdRef.current = null;
    };
  }, [setPrefs, showKeepDialog]);

  React.useEffect(() => {
    if (!showKeepDialog || secondsLeft > 0) {
      return;
    }

    if (countdownIdRef.current !== null) {
      window.clearInterval(countdownIdRef.current);
      countdownIdRef.current = null;
    }

    setShowKeepDialog(false);
    setPrefs(confirmedRef.current);
    setStatus("Changes reverted automatically for safety.");
    setSecondsLeft(12);
    void logDesignSystemDebugEvent("Design token safety auto-revert triggered.");
    if (collapseAfterDialogRef.current) {
      requestCollapse("auto-revert");
    }
  }, [secondsLeft, setPrefs, showKeepDialog]);

  // ─── Collapse animation effect ────────────────────────────────────────
  React.useEffect(() => {
    if (!collapseRequested) {
      return;
    }

    void logDesignSystemDebugEvent("Design system controls: collapse animation started.", {
      trigger: collapseRequested,
      easing: "ease-out",
      timingMs: prefs.motionTimingMs,
    });
    setIsCollapsing(true);

    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
    }

    collapseTimerRef.current = window.setTimeout(() => {
      setIsCollapsing(false);
      setIsExpanded(false);
      setCollapseRequested(false);
      void logDesignSystemDebugEvent("Design system controls: collapsed state restored.", {
        trigger: collapseRequested,
        returnedToBottomRight: true,
      });
    }, prefs.motionTimingMs + 30);

    return () => {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, [collapseRequested, prefs.motionTimingMs]);

  function requestCollapse(trigger: string): void {
    setCollapseRequested(trigger);
    void logDesignSystemDebugEvent("Design system collapse trigger received.", {
      trigger,
      easing: "ease-out",
    });
  }

  async function handleSave(): Promise<void> {
    collapseAfterDialogRef.current = true;
    setShowKeepDialog(true);
    setSecondsLeft(12);

    if (!userId || persistenceMode === "local") {
      setStatus("Design settings saved locally.");
      void logDesignSystemDebugEvent("Design tokens saved locally.");
      return;
    }

    try {
      if (persistenceMode === "cloud") {
        await saveDesignTokenPreferencesToCloud(userId, prefs);
        setStatus("Design settings saved to cloud.");
      } else {
        const cloud = await loadDesignTokenPreferencesFromCloud(userId);
        const merged = sanitizeDesignTokenPreferences({
          ...(cloud ?? {}),
          ...prefs,
        });
        setPrefs(merged);
        await saveDesignTokenPreferencesToCloud(userId, merged);
        setStatus("Design settings merged and synced to cloud.");
      }

      void logDesignSystemDebugEvent("Design token persistence completed.", {
        mode: persistenceMode,
        userId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown cloud sync error.";
      setStatus(`Unable to sync design settings: ${message}`);
      void logDesignSystemDebugEvent("Design token persistence failed.", { mode: persistenceMode, message });
    }
  }

  async function handleLoadCloudSettings(): Promise<void> {
    if (!userId) {
      setStatus("Sign in to load cloud settings.");
      return;
    }

    try {
      const cloud = await loadDesignTokenPreferencesFromCloud(userId);
      if (!cloud) {
        setStatus("No cloud design settings were found for this account.");
        return;
      }

      setPrefs(cloud);
      setStatus("Loaded cloud design settings.");
      void logDesignSystemDebugEvent("Design token cloud settings loaded.", { userId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown cloud load error.";
      setStatus(`Unable to load cloud settings: ${message}`);
      void logDesignSystemDebugEvent("Design token cloud load failed.", { message, userId });
    }
  }

  async function handleCloudDecision(decision: CloudSettingsDecision): Promise<void> {
    if (!userId) {
      setCloudPromptStatus("Sign in is required for cloud settings decisions.");
      return;
    }

    setCloudDecisionBusy(true);
    try {
      const cloud = await loadDesignTokenPreferencesFromCloud(userId);
      const outcome = resolveCloudSettingsDecision({
        local: prefs,
        cloud,
        decision,
      });

      if (decision === "delete-cloud-use-local-defaults") {
        await deleteCloudDesignTokenPreferences(userId);
      } else if (outcome.cloudTarget) {
        await saveDesignTokenPreferencesToCloud(userId, outcome.cloudTarget);
      }

      setPrefs(outcome.nextLocal);
      setCloudPromptStatus(outcome.trace);
      setCloudPromptVisible(false);

      void logDesignSystemDebugEvent("Cloud settings decision applied.", {
        userId,
        decision,
        trace: outcome.trace,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_cloud_decision_error";
      setCloudPromptStatus(`Cloud settings action failed: ${message}`);
      void logDesignSystemDebugEvent("Cloud settings decision failed.", {
        userId,
        decision,
        message,
      });
    } finally {
      setCloudDecisionBusy(false);
    }
  }

  async function handleDeleteOldSettings(): Promise<void> {
    try {
      resetPrefs();
      setCorruptionStatus("Deleted old settings and reset to defaults.");
      void logDesignSystemDebugEvent("Corrupted settings deleted and defaults restored.", {
        invalidFields: localDiagnostics.invalidFields,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_delete_settings_error";
      setCorruptionStatus(`Unable to delete old settings: ${message}`);
      void logDesignSystemDebugEvent("Failed to delete corrupted settings.", { message });
    }
  }

  async function handleRepairSettings(): Promise<void> {
    const repair = tryRepairCorruptedLocalDesignSettings();
    if (!repair.success) {
      resetPrefs();
      setCorruptionStatus("Repair failed. Defaults restored.");
      void logDesignSystemDebugEvent("Corrupted settings repair failed. Defaults restored.", {
        invalidFields: repair.invalidFields,
      });
      return;
    }

    setPrefs(repair.repaired);
    setCorruptionStatus(`Repaired settings with fallback values (${repair.invalidFields.length} corrected fields).`);
    void logDesignSystemDebugEvent("Corrupted settings repaired.", {
      invalidFields: repair.invalidFields,
    });
  }

  function handleConfirmKeepChanges(): void {
    confirmedRef.current = prefs;
    setShowKeepDialog(false);
    setSecondsLeft(12);
    setStatus("Changes confirmed.");
    void logDesignSystemDebugEvent("Design token changes confirmed by user.");
    if (collapseAfterDialogRef.current) {
      requestCollapse("save-confirmed");
    }
  }

  function setSemanticColor(key: keyof DesignTokenPreferences["semanticColors"], value: string): void {
    setPrefs({
      semanticColors: {
        ...prefs.semanticColors,
        [key]: value,
      },
    });
  }

  function triggerPreviewRipple(target: HTMLElement): void {
    target.classList.remove("cf-ds-btn--ripple-active");
    void target.getBoundingClientRect();
    target.classList.add("cf-ds-btn--ripple-active");
    window.setTimeout(() => {
      target.classList.remove("cf-ds-btn--ripple-active");
    }, Math.max(240, prefs.motionTimingMs));
  }

  function handleOrganizerButtonHover(role: string): void {
    void logDesignSystemDebugEvent("Organizer behavior preview: hover.", {
      role,
      buttonHoverEnabled: prefs.buttonHoverEnabled,
      buttonSquishEnabled: prefs.buttonSquishEnabled,
      buttonPressEnabled: prefs.buttonPressEnabled,
      buttonRippleEnabled: prefs.buttonRippleEnabled,
    });
  }

  function handleOrganizerButtonPress(role: string, event: React.PointerEvent<HTMLButtonElement>): void {
    if (prefs.buttonRippleEnabled) {
      triggerPreviewRipple(event.currentTarget);
    }

    void logDesignSystemDebugEvent("Organizer behavior preview: press.", {
      role,
      buttonHoverEnabled: prefs.buttonHoverEnabled,
      buttonSquishEnabled: prefs.buttonSquishEnabled,
      buttonPressEnabled: prefs.buttonPressEnabled,
      buttonRippleEnabled: prefs.buttonRippleEnabled,
    });
  }

  function applyHarmonyToOrganizer(role: "major" | "minor" | "accent"): void {
    const color = role === "major"
      ? tokens.harmony.colors.major
      : role === "minor"
        ? tokens.harmony.colors.minor
        : tokens.harmony.colors.accent;

    const nextSemantic = {
      ...prefs.semanticColors,
      ...(role === "major" ? { new: color, success: color } : {}),
      ...(role === "minor" ? { pending: color } : {}),
      ...(role === "accent" ? { error: color } : {}),
    };

    setPrefs({ semanticColors: nextSemantic });
    void logDesignSystemDebugEvent("Organizer quick-apply harmony color.", {
      role,
      color,
      semanticColors: nextSemantic,
    });
  }

  function handleHarmonyHexInput(kind: "base" | "brand", value: string): void {
    if (kind === "base") {
      setBaseHexInput(value);
    } else {
      setBrandHexInput(value);
    }

    const parsed = hexToHsl(value);
    if (parsed === null) {
      return;
    }

    if (kind === "base") {
      setPrefs({
        colorHarmonyBaseHue: parsed.hue,
        ...(prefs.colorHarmonySaturationMode === "free" ? { colorHarmonySaturation: parsed.saturation } : {}),
      });
      void logDesignSystemDebugEvent("Color harmony base hex input applied.", {
        colorHarmonyBaseHue: parsed.hue,
        colorHarmonySaturation: parsed.saturation,
        value,
      });
      return;
    }

    if (prefs.colorHarmonyBrandMode === "derived") {
      return;
    }

    setPrefs({
      colorHarmonyBrandHue: parsed.hue,
      ...(prefs.colorHarmonySaturationMode === "free" ? { colorHarmonySaturation: parsed.saturation } : {}),
    });
    void logDesignSystemDebugEvent("Color harmony brand hex input applied.", {
      colorHarmonyBrandHue: parsed.hue,
      colorHarmonySaturation: parsed.saturation,
      value,
    });
  }

  function handleApplySystemDefaults(): void {
    const result = applySystemDefaults();
    setStatus(result.message);
    void logDesignSystemDebugEvent("Use system defaults action completed.", {
      applied: result.applied,
      detected: result.detected,
      failed: result.failed,
    });
  }

  function handleExpandToggle(): void {
    if (isExpanded || isCollapsing) {
      requestCollapse("toggle-button");
      return;
    }

    setIsExpanded(true);
    void logDesignSystemDebugEvent("Design system controls: collapsed state initialized.", {
      collapsed: false,
      expanding: true,
      cardOrder: "last",
    });
    void logDesignSystemDebugEvent("Design system controls expanded.", {
      zHeight: 1050,
      easing: "ease-in",
      directionalFlow: prefs.directionalFlow,
      fibonacciRatioBig: 3,
      fibonacciRatioSmall: 2,
      exampleCardSide: prefs.directionalFlow === "right-to-left" ? "right" : "left",
      controlsCardSide: prefs.directionalFlow === "right-to-left" ? "left" : "right",
    });
  }

  function setSectionRef(key: string): (node: HTMLElement | null) => void {
    return (node) => {
      sectionRefs.current[key] = node;
    };
  }

  function handleTypeRatioChange(rawValue: number): void {
    const closest = resolveClosestPreset(rawValue, TYPE_RATIO_PRESETS);
    const distance = Math.abs(closest.value - rawValue);

    setPrefs({ typeRatio: rawValue });

    if (distance <= RATIO_PRESET_SNAP_EPSILON) {
      void logDesignSystemDebugEvent("Type ratio snapped to preset.", {
        rawValue,
        preset: closest.label,
        descriptor: closest.description,
      });
      return;
    }

    void logDesignSystemDebugEvent("Type ratio manually adjusted.", {
      rawValue,
      nearestPreset: closest.label,
      descriptor: closest.description,
    });
  }

  function handleSpacingRatioChange(rawValue: number): void {
    const closest = resolveClosestPreset(rawValue, SPACING_PRESETS);
    const distance = Math.abs(closest.value - rawValue);

    setPrefs({ spacingRatio: rawValue });

    if (distance <= RATIO_PRESET_SNAP_EPSILON) {
      void logDesignSystemDebugEvent("Spacing ratio snapped to preset.", {
        rawValue,
        preset: closest.label,
        descriptor: closest.description,
      });
      return;
    }

    void logDesignSystemDebugEvent("Spacing ratio manually adjusted.", {
      rawValue,
      nearestPreset: closest.label,
      descriptor: closest.description,
    });
  }

  return (
    <>
      {/* Collapsed trigger card — in Settings grid layout */}
      <article
        ref={collapsedCardRef}
        className={`settings-card settings-card--tokenized cf-ds-card settings-card--design-system ${isExpanded || isCollapsing ? "cf-ds-card--expanded settings-card--active" : ""} ${placementClassName ?? ""}`.trim()}
        aria-live="polite"
      >
        <div className="settings-card__head cf-ds-card__head">
          <div>
            <h3>Design System Controls</h3>
            {!isExpanded && !isCollapsing ? (
              <p className="settings-meta">Single source of truth for color, type, stroke, spacing, and motion tokens.</p>
            ) : null}
          </div>
          <button
            type="button"
            data-button-type={isExpanded || isCollapsing ? "new" : "active"}
            className={getUnifiedButtonClass(isExpanded || isCollapsing ? "new" : "active", "standard", ["settings-card__toggle"])}
            onClick={handleExpandToggle}
          >
            {isExpanded || isCollapsing ? "Collapse" : "Expand"}
          </button>
        </div>

        {!isExpanded && !isCollapsing ? (
          <p className="settings-meta">Collapsed by default. Expand to edit live design controls.</p>
        ) : null}
      </article>

      {/* Full-screen expanded overlay — portaled to document.body */}
      {(isExpanded || isCollapsing) ? createPortal(
        <>
          {/* Backdrop scrim — click-outside collapses */}
          <div
            className={`cf-ds-card-backdrop${isCollapsing ? " cf-ds-card-backdrop--collapsing" : ""}`}
            onClick={() => { requestCollapse("click-outside"); }}
            aria-hidden="true"
          />

          {/* Expanded overlay panel */}
          <div className={`cf-ds-card-overlay${isCollapsing ? " cf-ds-card-overlay--collapsing" : ""}`}>
            <div ref={overlayContentRef} className="cf-ds-card-overlay__inner">
              {/* Overlay header */}
              <div className="settings-card__head cf-ds-card__head">
                <div>
                  <h3>Design System Controls</h3>
                  <p className="settings-meta">Single source of truth for color, type, stroke, spacing, and motion tokens.</p>
                </div>
                <button
                  type="button"
                  data-button-type="new"
                  className={getUnifiedButtonClass("new", "standard", ["settings-card__toggle"])}
                  onClick={() => { requestCollapse("toggle-button"); }}
                >
                  Collapse
                </button>
              </div>

              {cloudPromptVisible ? (
                <div className="cf-keep-dialog" role="group" aria-label="Cloud settings choices">
                  <p>Cloud settings were detected for this account. Choose how to proceed.</p>
                  <div className="form-actions">
                    <button type="button" data-button-type="active" className={getUnifiedButtonClass("active")} disabled={cloudDecisionBusy} onClick={() => { void handleCloudDecision("apply-cloud"); }}>Apply Cloud Settings</button>
                    <button type="button" data-button-type="new" className={getUnifiedButtonClass("new")} disabled={cloudDecisionBusy} onClick={() => { void handleCloudDecision("keep-local"); }}>Keep Local Settings</button>
                    <button type="button" data-button-type="new" className={getUnifiedButtonClass("new")} disabled={cloudDecisionBusy} onClick={() => { void handleCloudDecision("merge-local-into-cloud"); }}>Merge Local Into Cloud</button>
                    <button type="button" data-button-type="error" className={getUnifiedButtonClass("error")} disabled={cloudDecisionBusy} onClick={() => { void handleCloudDecision("delete-cloud-use-local-defaults"); }}>Delete Cloud Settings and Use Local Defaults</button>
                  </div>
                </div>
              ) : null}

              {cloudPromptStatus ? <p className="settings-meta">{cloudPromptStatus}</p> : null}

              {localDiagnostics.corrupted ? (
                <div className="cf-keep-dialog" role="group" aria-label="Corrupted settings recovery">
                  <p>Saved settings appear invalid. Choose a recovery option.</p>
                  <p className="settings-meta">Invalid fields: {localDiagnostics.invalidFields.join(", ") || "unknown"}</p>
                  <div className="form-actions">
                    <button type="button" data-button-type="error" className={getUnifiedButtonClass("error")} onClick={() => { void handleDeleteOldSettings(); }}>Delete Old Settings</button>
                    <button type="button" data-button-type="error" className={getUnifiedButtonClass("error")} onClick={() => resetPrefs()}>Reset to Defaults</button>
                    <button type="button" data-button-type="pending" className={getUnifiedButtonClass("pending")} onClick={() => { void handleRepairSettings(); }}>Try to Repair Settings</button>
                    <button
                      type="button"
                      data-button-type="pending"
                      className={getUnifiedButtonClass("pending")}
                      onClick={() => {
                        setCorruptionStatus(`Debug details: ${JSON.stringify(localDiagnostics.raw).slice(0, 260)}`);
                      }}
                    >
                      View Debug Details
                    </button>
                  </div>
                  {corruptionStatus ? <p className="settings-meta">{corruptionStatus}</p> : null}
                </div>
              ) : null}

              {/* Two-card Fibonacci layout: Example (flex:3) | Controls (flex:2) */}
              <div
                ref={fibonacciContainerRef}
                className={`cf-ds-fibonacci-layout${flowTransitioning ? " cf-ds-fibonacci-layout--swapping" : ""}`}
                data-flow={prefs.directionalFlow}
              >
                {/* Example Card */}
                <div
                  className="cf-ds-fibonacci-layout__example"
                  data-slot={prefs.directionalFlow === "right-to-left" ? "secondary" : "primary"}
                >
                  <div className="cf-example-card" aria-label="example card preview">
                    <div className="cf-example-card__row" ref={setSectionRef("color-harmony-preview")}>
                      <h4 className="cf-ds-section-title">Color Harmony</h4>
                      <div className="cf-harmony-role-strip" aria-label="harmony role palette preview">
                        {paletteRoleEntries.map((entry) => (
                          <div key={entry.role} className="cf-harmony-role-card">
                            <svg className="cf-harmony-role-card__swatch" viewBox="0 0 100 24" aria-hidden="true" focusable="false">
                              <rect x="0" y="0" width="100" height="24" rx="8" fill={entry.color} />
                            </svg>
                            <strong>{entry.label}</strong>
                            <span>{entry.hue}°</span>
                          </div>
                        ))}
                      </div>
                      <div className="cf-harmony-stat-grid" aria-label="harmony hue details">
                        <span>Base: {tokens.harmony.baseHue.toFixed(1)}°</span>
                        <span>Brand: {tokens.harmony.effectiveBrandHue.toFixed(1)}°</span>
                        <span>Saturation: {Math.round(tokens.harmony.saturation)}%</span>
                        <span>Major: {Math.round(tokens.harmony.majorHue)}°</span>
                        <span>Minor: {Math.round(tokens.harmony.minorHue)}°</span>
                        <span>Accent: {Math.round(tokens.harmony.accentHue)}°</span>
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("color-curve-preview")}>
                      <h4 className="cf-ds-section-title">Color Curve (Gamma)</h4>
                      <p className="settings-meta">Perceptual Brightness Curve: {prefs.gamma.toFixed(2)}</p>
                      <div className="cf-gamma-ramp-grid" aria-label="gamma shade ramps">
                        {paletteRoleEntries.slice(0, 4).map((entry) => (
                          <div key={`curve-${entry.role}`} className="cf-gamma-ramp-card">
                            <span>{entry.label}</span>
                            <div className="cf-gamma-ramp-card__swatches">
                              {tokens.color.roles[entry.role].shades.map((shade, index) => (
                                <svg
                                  key={`${entry.role}-shade-${index + 1}`}
                                  className="cf-gamma-ramp-card__swatch"
                                  viewBox="0 0 24 20"
                                  aria-hidden="true"
                                  focusable="false"
                                >
                                  <title>{`${entry.label} shade ${index + 1}`}</title>
                                  <rect x="0" y="0" width="24" height="20" rx="6" fill={shade} />
                                </svg>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("token-assignment-preview")}>
                      <h4 className="cf-ds-section-title">Token Assignment</h4>
                      <div className="cf-token-assignment-preview" aria-label="semantic token assignment preview">
                        {semanticPreviewEntries.map((entry) => (
                          <div key={entry.tokenName} className="cf-token-assignment-preview__item">
                            <svg className="cf-token-assignment-preview__swatch" viewBox="0 0 100 24" aria-hidden="true" focusable="false">
                              <rect x="0" y="0" width="100" height="24" rx="8" fill={entry.color} />
                            </svg>
                            <span>{entry.label}</span>
                            <strong>{SEMANTIC_ROLE_LABELS[entry.role]}</strong>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("card-styling-preview")}>
                      <h4 className="cf-ds-section-title">Card Styling</h4>
                      <article className="cf-sample-card cf-sample-card--style-preview cf-card-style-preview" aria-label="card styling preview example">
                        <h5 className="cf-ds-card-subtitle">Styled Surface Card</h5>
                        <p>Card stroke, gradient, shadow, glow offsets, ambient overlay, padding, radius, and height all come from semantic tokens and card styling tokens.</p>
                        <div className="cf-radius-preview" aria-label="card styling token summary">
                          <span className="cf-radius-preview__chip cf-radius-preview__chip--box">Base shade: {shadeLabel(prefs.cardBaseShade)}</span>
                          <span className="cf-radius-preview__chip cf-radius-preview__chip--box">Shadow: {prefs.cardShadowOffsetMode === "auto" ? "Auto (base -2 dark / -1 light)" : formatOffsetLabel(prefs.cardShadowOffset)}</span>
                          <span className="cf-radius-preview__chip cf-radius-preview__chip--box">Glow: {prefs.cardGlowOffsetMode === "auto" ? "Auto (base +2 dark / +1 light)" : formatOffsetLabel(prefs.cardGlowOffset)}</span>
                          <span className="cf-radius-preview__chip cf-radius-preview__chip--box">Stroke: {prefs.cardStrokeSize.toFixed(1)}px {SEMANTIC_ROLE_LABELS[prefs.cardStrokeRole]}</span>
                          <span className="cf-radius-preview__chip cf-radius-preview__chip--box">Gradient: {prefs.cardGradientEnabled ? `${prefs.cardGradientStrength.toFixed(1)}%` : "Off"}</span>
                          <span className="cf-radius-preview__chip cf-radius-preview__chip--box">Overlay: {prefs.cardOverlayEnabled ? `${prefs.cardOverlayStrength.toFixed(1)}%` : "Off"}</span>
                          <span className="cf-radius-preview__chip cf-radius-preview__chip--button">Radius: {prefs.cardCornerRadius}px</span>
                        </div>
                      </article>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("component-previews-preview")}>
                      <h4 className="cf-ds-section-title">Component Previews</h4>
                      <div className="cf-component-preview-suite" aria-label="component preview suite">
                        <div className="cf-component-preview-suite__swatches">
                          <div className="cf-component-swatch-card">
                            <span className="cf-component-swatch-card__title">Background</span>
                            <span className="cf-component-swatch-card__swatch cf-component-swatch-card__swatch--background" />
                          </div>
                          <div className="cf-component-swatch-card">
                            <span className="cf-component-swatch-card__title">Surface</span>
                            <span className="cf-component-swatch-card__swatch cf-component-swatch-card__swatch--surface" />
                          </div>
                          <div className="cf-component-swatch-card">
                            <span className="cf-component-swatch-card__title">Border</span>
                            <span className="cf-component-swatch-card__swatch cf-component-swatch-card__swatch--border" />
                          </div>
                          <div className="cf-component-swatch-card">
                            <span className="cf-component-swatch-card__title">Focus Ring</span>
                            <span className="cf-component-swatch-card__swatch cf-component-swatch-card__swatch--focus" />
                          </div>
                        </div>
                        <div className="cf-component-preview-suite__row">
                          <div className="cf-component-preview-suite__text-block">
                            <h5>Text Example</h5>
                            <p>Primary text and subtle text consume semantic tokens only.</p>
                            <span className="cf-component-preview-suite__text-subtle">Subtle supporting text</span>
                          </div>
                          <div className="cf-component-preview-suite__state-stack">
                            <span className="cf-state-pill cf-state-pill--hover">Hover</span>
                            <span className="cf-state-pill cf-state-pill--active">Active</span>
                            <span className="cf-state-pill cf-state-pill--focus">Focus</span>
                          </div>
                        </div>
                        <div className="cf-example-card__button-grid">
                          <DemoButton variant="primary" size="md" />
                          <DemoButton variant="secondary" size="md" />
                          <DemoButton variant="ghost" size="md" />
                        </div>
                        <label className="cf-ds-email-field" htmlFor="cf-ds-email-input">
                          Input field
                          <input id="cf-ds-email-input" type="email" placeholder="teacher@school.org" className="cf-ds-input" />
                        </label>
                        <div className="cf-component-preview-suite__toggle-tabs">
                          <button type="button" data-button-type="new" className={getUnifiedButtonClass("new", "standard", ["cf-toggle-preview"])} aria-pressed="true"><span /><span>Toggle switch</span></button>
                          <div className="cf-tabs-preview" role="tablist" aria-label="Tabs preview">
                            <button type="button" role="tab" aria-selected="true" tabIndex={0} data-button-type="active" className={getUnifiedButtonClass("active", "standard", ["cf-tabs-preview__tab", "cf-tabs-preview__tab--active"])}>Overview</button>
                            <button type="button" role="tab" aria-selected="false" tabIndex={-1} data-button-type="new" className={getUnifiedButtonClass("new", "standard", ["cf-tabs-preview__tab"])}>Scale</button>
                            <button type="button" role="tab" aria-selected="false" tabIndex={-1} data-button-type="new" className={getUnifiedButtonClass("new", "standard", ["cf-tabs-preview__tab"])}>States</button>
                          </div>
                        </div>
                        <div className="cf-example-card__organizers">
                          <button type="button" data-button-type="new" className={getUnifiedButtonClass("new", "standard", ["cf-ds-btn", "cf-ds-btn--sm", "cf-ds-btn--organizer", "cf-organizer", "cf-organizer--new"])}>New</button>
                          <button type="button" data-button-type="active" className={getUnifiedButtonClass("active", "standard", ["cf-ds-btn", "cf-ds-btn--sm", "cf-ds-btn--organizer", "cf-organizer", "cf-organizer--active"])}>Active</button>
                          <button type="button" data-button-type="pending" className={getUnifiedButtonClass("pending", "standard", ["cf-ds-btn", "cf-ds-btn--sm", "cf-ds-btn--organizer", "cf-organizer", "cf-organizer--pending"])}>Pending</button>
                          <button type="button" data-button-type="error" className={getUnifiedButtonClass("error", "standard", ["cf-ds-btn", "cf-ds-btn--sm", "cf-ds-btn--organizer", "cf-organizer", "cf-organizer--error"])}>Error</button>
                        </div>
                        <article className="cf-sample-card cf-sample-card--style-preview cf-sample-card--gradient-preview">
                          <h5 className="cf-ds-card-subtitle">Gradient + Shadow + Glow</h5>
                          <p>Component recipes pull from semantic tokens and the card recipe in real time.</p>
                        </article>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Controls Card — aligned with Example Card rows */}
                <div
                  className="cf-ds-fibonacci-layout__controls"
                  data-slot={prefs.directionalFlow === "right-to-left" ? "primary" : "secondary"}
                >
                  <div className="cf-ds-settings-grid">
                    <section className="cf-ds-control-group" ref={setSectionRef("color-harmony-controls")}>
                      <h4 className="cf-ds-section-title">Color Harmony</h4>
                      <label>
                        Harmony Mode
                        <select
                          value={prefs.colorHarmonyMode}
                          onChange={(event) => {
                            const colorHarmonyMode = event.target.value as HarmonyMode;
                            setPrefs({ colorHarmonyMode });
                          }}
                        >
                          {HARMONY_MODES.map((mode) => (
                            <option key={mode} value={mode}>{mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-/g, " ")}</option>
                          ))}
                        </select>
                      </label>
                      <p className="settings-meta">{HARMONY_MODE_HELP_TEXT[prefs.colorHarmonyMode]}</p>
                      <label>
                        Brand Color Mode
                        <select
                          value={prefs.colorHarmonyBrandMode}
                          onChange={(event) => setPrefs({ colorHarmonyBrandMode: event.target.value as DesignTokenPreferences["colorHarmonyBrandMode"] })}
                        >
                          <option value="independent">Independent</option>
                          <option value="derived">Derived</option>
                        </select>
                      </label>
                      <label>
                        Saturation Mode
                        <select
                          value={prefs.colorHarmonySaturationMode}
                          onChange={(event) => setPrefs({ colorHarmonySaturationMode: event.target.value as DesignTokenPreferences["colorHarmonySaturationMode"] })}
                        >
                          <option value="free">Free</option>
                          <option value="locked">Locked</option>
                        </select>
                      </label>
                      <label>
                        Saturation Slider (0-100%): {Math.round(prefs.colorHarmonySaturation)}%
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={prefs.colorHarmonySaturation}
                          disabled={prefs.colorHarmonySaturationMode !== "locked"}
                          onChange={(event) => setPrefs({ colorHarmonySaturation: Number(event.target.value) })}
                        />
                      </label>
                      <div className="cf-color-harmony-row" role="group" aria-label="Base color and hue controls">
                        <label>
                          Base Color
                          <div className="cf-color-input-pair">
                            <input
                              type="color"
                              aria-label="base harmony color"
                              value={baseHarmonyHex}
                              onChange={(event) => { handleHarmonyHexInput("base", event.target.value); }}
                            />
                            <input type="text" aria-label="base harmony hex" value={baseHexInput} maxLength={7} onChange={(event) => { handleHarmonyHexInput("base", event.target.value); }} />
                          </div>
                        </label>
                        <label>
                          Base Hue: {prefs.colorHarmonyBaseHue.toFixed(1)}°
                          <input type="range" min={0} max={360} step={0.1} value={prefs.colorHarmonyBaseHue} onChange={(event) => setPrefs({ colorHarmonyBaseHue: Number(event.target.value) })} />
                        </label>
                      </div>
                      <div className="cf-color-harmony-row" role="group" aria-label="Brand color and hue controls">
                        <label>
                          Brand Color
                          <div className="cf-color-input-pair">
                            <input
                              type="color"
                              aria-label="brand harmony color"
                              value={brandHarmonyHex}
                              disabled={prefs.colorHarmonyBrandMode === "derived"}
                              onChange={(event) => { handleHarmonyHexInput("brand", event.target.value); }}
                            />
                            <input type="text" aria-label="brand harmony hex" value={brandHexInput} maxLength={7} disabled={prefs.colorHarmonyBrandMode === "derived"} onChange={(event) => { handleHarmonyHexInput("brand", event.target.value); }} />
                          </div>
                        </label>
                        <label>
                          Brand Hue: {tokens.harmony.effectiveBrandHue.toFixed(1)}°
                          <input
                            type="range"
                            min={0}
                            max={360}
                            step={0.1}
                            value={prefs.colorHarmonyBrandMode === "derived" ? Number(tokens.harmony.effectiveBrandHue.toFixed(1)) : prefs.colorHarmonyBrandHue}
                            disabled={prefs.colorHarmonyBrandMode === "derived"}
                            onChange={(event) => setPrefs({ colorHarmonyBrandHue: Number(event.target.value) })}
                          />
                        </label>
                      </div>
                      <div className="cf-wheel-target-toggle" role="group" aria-label="Wheel target selector">
                        <button type="button" data-button-type="new" className={getUnifiedButtonClass("new", "standard", [wheelTarget === "base" ? "cf-wheel-target-toggle__button--active" : ""])} onClick={() => { setWheelTarget("base"); }}>Wheel edits base</button>
                        <button type="button" data-button-type="new" className={getUnifiedButtonClass("new", "standard", [wheelTarget === "brand" ? "cf-wheel-target-toggle__button--active" : ""])} disabled={prefs.colorHarmonyBrandMode === "derived"} onClick={() => { setWheelTarget("brand"); }}>Wheel edits brand</button>
                      </div>
                      <div className="cf-harmony-wheel-with-helper" aria-label="harmony wheel preview">
                        <p className={`cf-harmony-wheel-helper ${wheelHelperVisible ? "cf-harmony-wheel-helper--visible" : ""}`} aria-live="polite">Click or drag anywhere in the wheel to set hue and saturation</p>
                        <div className="cf-harmony-wheel" onPointerEnter={() => { revealWheelHelper("wheel-hover-reveal", WHEEL_HELPER_HOVER_VISIBLE_MS); }}>
                          <canvas
                            ref={harmonyWheelCanvasRef}
                            className="cf-harmony-wheel__canvas"
                            width={240}
                            height={240}
                            onPointerDown={handleWheelPointerDown}
                            onPointerMove={handleWheelPointerMove}
                            onPointerUp={handleWheelPointerUp}
                            onPointerCancel={handleWheelPointerUp}
                            onPointerLeave={handleWheelPointerLeave}
                          />
                        </div>
                        <p className={`cf-harmony-wheel-helper ${wheelHelperVisible ? "cf-harmony-wheel-helper--visible" : ""}`} aria-live="polite">All harmony markers stay on the same radius unless saturation is locked</p>
                      </div>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("color-curve-controls")}>
                      <h4 className="cf-ds-section-title">Color Curve (Gamma)</h4>
                      <label title="Perceptual Brightness Curve">
                        Color Curve (Gamma): {prefs.gamma.toFixed(2)}
                        <input
                          type="range"
                          min={1.6}
                          max={2.6}
                          step={0.05}
                          value={prefs.gamma}
                          list="cf-gamma-snap-points"
                          onChange={(event) => setPrefs({ gamma: Number(event.target.value) })}
                        />
                      </label>
                      <datalist id="cf-gamma-snap-points">
                        {GAMMA_SNAP_POINTS.map((point) => (
                          <option key={point} value={point} label={point.toFixed(1)} />
                        ))}
                      </datalist>
                      <div className="cf-gamma-marker-strip" aria-label="gamma snap markers">
                        {GAMMA_SNAP_POINTS.map((point) => (
                          <span key={`gamma-${point}`}>{point.toFixed(1)}</span>
                        ))}
                      </div>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("token-assignment-controls")}>
                      <h4 className="cf-ds-section-title">Token Assignment</h4>
                      <div className="cf-token-assignment-matrix" aria-label="semantic token assignment matrix">
                        {SEMANTIC_TOKEN_NAMES.map((tokenName) => (
                          <label key={tokenName}>
                            {SEMANTIC_TOKEN_LABELS[tokenName]}
                            <select
                              aria-label={`${SEMANTIC_TOKEN_LABELS[tokenName]} assignment`}
                              value={prefs.semanticAssignments[tokenName]}
                              onChange={(event) => {
                                setPrefs({
                                  semanticAssignments: {
                                    ...prefs.semanticAssignments,
                                    [tokenName]: event.target.value as SemanticPaletteRole,
                                  },
                                });
                              }}
                            >
                              {SEMANTIC_PALETTE_ROLES.map((role) => (
                                <option key={`${tokenName}-${role}`} value={role}>{SEMANTIC_ROLE_LABELS[role]}</option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("card-styling-controls")}>
                      <h4 className="cf-ds-section-title">Card Styling</h4>
                      <label>
                        Card Base Shade
                        <select
                          value={prefs.cardBaseShade}
                          onChange={(event) => {
                            const cardBaseShade = Number(event.target.value);
                            setPrefs({ cardBaseShade });
                          }}
                        >
                          {SHADE_OPTIONS.map((shade) => (
                            <option key={`card-base-${shade}`} value={shade}>{shadeLabel(shade)}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Shadow Offset
                        <select
                          value={prefs.cardShadowOffsetMode === "auto" ? "auto" : String(prefs.cardShadowOffset)}
                          onChange={(event) => {
                            if (event.target.value === "auto") {
                              setPrefs({ cardShadowOffsetMode: "auto" });
                              return;
                            }

                            setPrefs({
                              cardShadowOffsetMode: "manual",
                              cardShadowOffset: Number(event.target.value),
                            });
                          }}
                        >
                          <option value="auto">Auto (base -2 in dark mode)</option>
                          {SHADOW_OFFSET_OPTIONS.map((offset) => (
                            <option key={`card-shadow-offset-${offset}`} value={offset}>{formatOffsetLabel(offset)}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Glow Offset
                        <select
                          value={prefs.cardGlowOffsetMode === "auto" ? "auto" : String(prefs.cardGlowOffset)}
                          onChange={(event) => {
                            if (event.target.value === "auto") {
                              setPrefs({ cardGlowOffsetMode: "auto" });
                              return;
                            }

                            setPrefs({
                              cardGlowOffsetMode: "manual",
                              cardGlowOffset: Number(event.target.value),
                            });
                          }}
                        >
                          <option value="auto">Auto (base +2 in dark mode)</option>
                          {GLOW_OFFSET_OPTIONS.map((offset) => (
                            <option key={`card-glow-offset-${offset}`} value={offset}>{formatOffsetLabel(offset)}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Stroke Size (px): {prefs.cardStrokeSize.toFixed(1)}
                        <input
                          type="range"
                          min={0}
                          max={3}
                          step={0.5}
                          list="cf-card-stroke-size-snap-points"
                          value={prefs.cardStrokeSize}
                          onChange={(event) => {
                            setPrefs({ cardStrokeSize: Number(event.target.value) });
                          }}
                        />
                      </label>
                      <datalist id="cf-card-stroke-size-snap-points">
                        {STROKE_SIZE_SNAP_POINTS.map((point) => (
                          <option key={`card-stroke-size-${point}`} value={point} />
                        ))}
                      </datalist>

                      <label>
                        Stroke Color
                        <select
                          value={prefs.cardStrokeRole}
                          onChange={(event) => {
                            setPrefs({ cardStrokeRole: event.target.value as SemanticPaletteRole });
                          }}
                        >
                          {SEMANTIC_PALETTE_ROLES.map((role) => (
                            <option key={`card-stroke-role-${role}`} value={role}>{SEMANTIC_ROLE_LABELS[role]}</option>
                          ))}
                        </select>
                      </label>

                      <label className="cf-ds-checkbox-label">
                        <input
                          type="checkbox"
                          checked={prefs.cardGradientEnabled}
                          onChange={(event) => {
                            setPrefs({ cardGradientEnabled: event.target.checked });
                          }}
                        />
                        Gradient Enabled
                      </label>

                      <label>
                        Gradient Start Color
                        <select
                          value={prefs.cardGradientStart}
                          onChange={(event) => {
                            setPrefs({ cardGradientStart: event.target.value });
                          }}
                        >
                          {CARD_TOKEN_REFERENCE_OPTIONS.map((option) => (
                            <option key={`card-gradient-start-${option}`} value={option}>{formatRoleTokenLabel(option)}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Gradient End Color
                        <select
                          value={prefs.cardGradientEnd}
                          onChange={(event) => {
                            setPrefs({ cardGradientEnd: event.target.value });
                          }}
                        >
                          {CARD_TOKEN_REFERENCE_OPTIONS.map((option) => (
                            <option key={`card-gradient-end-${option}`} value={option}>{formatRoleTokenLabel(option)}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Card Gradient Strength: {prefs.cardGradientStrength.toFixed(1)}%
                        <input
                          type="range"
                          min={0}
                          max={20}
                          step={0.5}
                          value={prefs.cardGradientStrength}
                          onChange={(event) => {
                            setPrefs({ cardGradientStrength: Number(event.target.value) });
                          }}
                        />
                      </label>

                      <label>
                        Gradient Angle: {prefs.cardGradientAngle} deg
                        <input
                          type="range"
                          min={0}
                          max={360}
                          step={1}
                          value={prefs.cardGradientAngle}
                          onChange={(event) => {
                            setPrefs({ cardGradientAngle: Number(event.target.value) });
                          }}
                        />
                      </label>

                      <label>
                        Gradient Focus Point
                        <select
                          value={prefs.cardGradientFocus}
                          onChange={(event) => {
                            setPrefs({ cardGradientFocus: event.target.value as DesignTokenPreferences["cardGradientFocus"] });
                          }}
                        >
                          {CARD_GRADIENT_FOCUS_OPTIONS.map((option) => (
                            <option key={`card-gradient-focus-${option.value}`} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>

                      {prefs.cardGradientFocus === "custom" ? (
                        <div className="cf-ds-settings-grid" role="group" aria-label="Custom gradient focus point controls">
                          <label>
                            Focus X: {prefs.cardGradientFocusX}%
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={prefs.cardGradientFocusX}
                              onChange={(event) => {
                                setPrefs({ cardGradientFocusX: Number(event.target.value) });
                              }}
                            />
                          </label>
                          <label>
                            Focus Y: {prefs.cardGradientFocusY}%
                            <input
                              type="range"
                              min={0}
                              max={100}
                              step={1}
                              value={prefs.cardGradientFocusY}
                              onChange={(event) => {
                                setPrefs({ cardGradientFocusY: Number(event.target.value) });
                              }}
                            />
                          </label>
                        </div>
                      ) : null}

                      <label>
                        Gradient Scale: {prefs.cardGradientScale.toFixed(2)}x
                        <input
                          type="range"
                          min={0.5}
                          max={3}
                          step={0.05}
                          value={prefs.cardGradientScale}
                          onChange={(event) => {
                            setPrefs({ cardGradientScale: Number(event.target.value) });
                          }}
                        />
                      </label>

                      <label className="cf-ds-checkbox-label">
                        <input
                          type="checkbox"
                          checked={prefs.cardOverlayEnabled}
                          onChange={(event) => {
                            setPrefs({ cardOverlayEnabled: event.target.checked });
                          }}
                        />
                        Ambient Overlay Enabled
                      </label>

                      <label>
                        Ambient Overlay Strength: {prefs.cardOverlayStrength.toFixed(1)}%
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={0.5}
                          value={prefs.cardOverlayStrength}
                          onChange={(event) => {
                            setPrefs({ cardOverlayStrength: Number(event.target.value) });
                          }}
                        />
                      </label>

                      <label>
                        Ambient Overlay Color
                        <select
                          value={prefs.cardOverlayRole}
                          onChange={(event) => {
                            setPrefs({ cardOverlayRole: event.target.value as SemanticPaletteRole });
                          }}
                        >
                          {SEMANTIC_PALETTE_ROLES.map((role) => (
                            <option key={`card-overlay-role-${role}`} value={role}>{SEMANTIC_ROLE_LABELS[role]}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Settings Base Luminance (Light): {prefs.settingsBaseLightLuminance.toFixed(1)}%
                        <input
                          type="range"
                          min={92}
                          max={100}
                          step={0.5}
                          value={prefs.settingsBaseLightLuminance}
                          onChange={(event) => {
                            setPrefs({ settingsBaseLightLuminance: Number(event.target.value) });
                          }}
                        />
                      </label>

                      <label>
                        Settings Base Luminance (Dark): {prefs.settingsBaseDarkLuminance.toFixed(1)}%
                        <input
                          type="range"
                          min={0}
                          max={8}
                          step={0.5}
                          value={prefs.settingsBaseDarkLuminance}
                          onChange={(event) => {
                            setPrefs({ settingsBaseDarkLuminance: Number(event.target.value) });
                          }}
                        />
                      </label>

                      <label>
                        Card Padding
                        <select
                          value={prefs.cardPaddingIndex}
                          onChange={(event) => {
                            setPrefs({ cardPaddingIndex: Number(event.target.value) });
                          }}
                        >
                          {CARD_PADDING_OPTIONS.map((option) => (
                            <option key={`card-padding-${option.value}`} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Card Height (px)
                        <input
                          type="number"
                          min={140}
                          max={460}
                          step={5}
                          value={prefs.cardHeight}
                          onChange={(event) => {
                            setPrefs({ cardHeight: Number(event.target.value) });
                          }}
                        />
                      </label>
                      <label>
                        Dark Mode Glow Intensity: {prefs.darkModeGlowIntensity.toFixed(1)}
                        <input
                          type="range" min={0} max={10} step={0.5}
                          value={prefs.darkModeGlowIntensity}
                          onChange={(event) => {
                            const darkModeGlowIntensity = Number(event.target.value);
                            setPrefs({ darkModeGlowIntensity });
                            void logDesignSystemDebugEvent("Dark mode glow intensity changed.", { darkModeGlowIntensity });
                          }}
                        />
                      </label>
                      <label>
                        Dark Mode Glow Radius (px): {prefs.darkModeGlowRadius}
                        <input
                          type="range" min={4} max={48} step={1}
                          value={prefs.darkModeGlowRadius}
                          onChange={(event) => {
                            const darkModeGlowRadius = Number(event.target.value);
                            setPrefs({ darkModeGlowRadius });
                            void logDesignSystemDebugEvent("Dark mode glow radius changed.", { darkModeGlowRadius });
                          }}
                        />
                      </label>
                      <label>
                        Light Mode Shadow Intensity: {prefs.lightModeShadowIntensity.toFixed(1)}
                        <input
                          type="range" min={0} max={10} step={0.5}
                          value={prefs.lightModeShadowIntensity}
                          onChange={(event) => {
                            const lightModeShadowIntensity = Number(event.target.value);
                            setPrefs({ lightModeShadowIntensity });
                            void logDesignSystemDebugEvent("Light mode shadow intensity changed.", { lightModeShadowIntensity });
                          }}
                        />
                      </label>
                      <label>
                        Light Mode Shadow Radius (px): {prefs.lightModeShadowRadius}
                        <input
                          type="range" min={4} max={48} step={1}
                          value={prefs.lightModeShadowRadius}
                          onChange={(event) => {
                            const lightModeShadowRadius = Number(event.target.value);
                            setPrefs({ lightModeShadowRadius });
                            void logDesignSystemDebugEvent("Light mode shadow radius changed.", { lightModeShadowRadius });
                          }}
                        />
                      </label>
                      <label>
                        Card Corner Radius (px): {prefs.cardCornerRadius}
                        <input type="range" min={4} max={40} step={1} value={prefs.cardCornerRadius} onChange={(event) => setPrefs({ cardCornerRadius: Number(event.target.value) })} />
                      </label>
                      <label>
                        Box Corner Radius (px): {prefs.boxCornerRadius}
                        <input type="range" min={4} max={40} step={1} value={prefs.boxCornerRadius} onChange={(event) => setPrefs({ boxCornerRadius: Number(event.target.value) })} />
                      </label>
                      <label>
                        Button Corner Radius (px): {prefs.buttonCornerRadius}
                        <input type="range" min={4} max={40} step={1} value={prefs.buttonCornerRadius} onChange={(event) => setPrefs({ buttonCornerRadius: Number(event.target.value) })} />
                      </label>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("component-previews-controls")}>
                      <h4 className="cf-ds-section-title">Component Previews</h4>
                      <label>
                        Stroke preset
                        <select value={prefs.strokePreset} onChange={(event) => setPrefs({ strokePreset: event.target.value as DesignTokenPreferences["strokePreset"] })}>
                          {STROKE_PRESET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label} - {option.descriptor}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Type ratio: {prefs.typeRatio.toFixed(3)}
                        <input type="range" min={1.067} max={1.5} step={0.001} value={prefs.typeRatio} onChange={(event) => handleTypeRatioChange(Number(event.target.value))} />
                      </label>
                      <label>
                        Spacing ratio: {prefs.spacingRatio.toFixed(3)}
                        <input type="range" min={1.25} max={2} step={0.001} value={prefs.spacingRatio} onChange={(event) => handleSpacingRatioChange(Number(event.target.value))} />
                      </label>
                      <div className="cf-ds-checkbox-grid">
                        <label className="cf-ds-checkbox-label"><input type="checkbox" checked={prefs.buttonHoverEnabled} onChange={(event) => setPrefs({ buttonHoverEnabled: event.target.checked })} />Hover opacity</label>
                        <label className="cf-ds-checkbox-label"><input type="checkbox" checked={prefs.buttonSquishEnabled} onChange={(event) => setPrefs({ buttonSquishEnabled: event.target.checked })} />Squish on press</label>
                        <label className="cf-ds-checkbox-label"><input type="checkbox" checked={prefs.buttonPressEnabled} onChange={(event) => setPrefs({ buttonPressEnabled: event.target.checked })} />Press depth</label>
                        <label className="cf-ds-checkbox-label"><input type="checkbox" checked={prefs.buttonRippleEnabled} onChange={(event) => setPrefs({ buttonRippleEnabled: event.target.checked })} />Ripple preview</label>
                      </div>
                      <label>
                        Depth Intensity: {prefs.buttonDepthIntensity.toFixed(1)}
                        <input type="range" min={0} max={10} step={0.5} value={prefs.buttonDepthIntensity} onChange={(event) => setPrefs({ buttonDepthIntensity: Number(event.target.value) })} />
                      </label>
                      <label>
                        Depth Radius (px): {prefs.buttonDepthRadius}
                        <input type="range" min={4} max={32} step={1} value={prefs.buttonDepthRadius} onChange={(event) => setPrefs({ buttonDepthRadius: Number(event.target.value) })} />
                      </label>
                      <button
                        type="button"
                        data-button-type="new"
                        className={getUnifiedButtonClass("new", "standard", [`theme-toggle flow-toggle ${prefs.directionalFlow === "right-to-left" ? "flow-toggle--right" : "flow-toggle--left"}`])}
                        onClick={() => {
                          const nextFlow = prefs.directionalFlow === "left-to-right" ? "right-to-left" : "left-to-right";
                          setFlowTransitioning(true);
                          setPrefs({ directionalFlow: nextFlow });
                          window.setTimeout(() => { setFlowTransitioning(false); }, prefs.motionTimingMs + 30);
                        }}
                        aria-label="Toggle directional flow"
                      >
                        <span className="theme-toggle__label">{prefs.directionalFlow === "left-to-right" ? "Left" : "Right"}</span>
                        <span className="theme-toggle__track" aria-hidden="true"><span className="theme-toggle__thumb" /></span>
                      </button>
                    </section>
                  </div>
                </div>
              </div>

              <label>
                Save mode
                <select value={persistenceMode} onChange={(event) => setPersistenceMode(event.target.value as PersistenceMode)}>
                  <option value="local">Use Local Settings</option>
                  <option value="cloud" disabled={!userId}>Use Cloud Settings</option>
                  <option value="merge" disabled={!userId}>Merge and Update Cloud</option>
                </select>
              </label>

              <div className="form-actions">
                <button type="button" data-button-type="active" className={getUnifiedButtonClass("active")} onClick={() => { void handleSave(); }}>Save</button>
                <button type="button" data-button-type="new" className={getUnifiedButtonClass("new")} onClick={() => { void handleLoadCloudSettings(); }} disabled={!userId}>Load Cloud Settings</button>
                <button
                  type="button"
                  data-button-type="error"
                  className={getUnifiedButtonClass("error")}
                  onClick={() => {
                    resetPrefs();
                    requestCollapse("reset");
                    void logDesignSystemDebugEvent("Design token reset to defaults. Collapsing.", { trigger: "reset" });
                  }}
                >
                  Reset to defaults
                </button>
                <button type="button" data-button-type="new" className={getUnifiedButtonClass("new")} onClick={handleApplySystemDefaults}>Use System Defaults</button>
                <button
                  type="button"
                  data-button-type="error"
                  className={getUnifiedButtonClass("error")}
                  onClick={() => {
                    requestCollapse("cancel");
                    void logDesignSystemDebugEvent("Design system controls cancelled. Collapsing.", { trigger: "cancel" });
                  }}
                >
                  Cancel
                </button>
              </div>

              {status ? <p className="settings-meta">{status}</p> : null}

              {showKeepDialog ? (
                <div className="cf-keep-dialog" role="dialog" aria-modal="true" aria-label="Keep Changes">
                  <p>Keep Changes? Reverting in {secondsLeft}s if not confirmed.</p>
                  <div className="form-actions">
                    <button type="button" data-button-type="active" data-button-size="large" className={getUnifiedButtonClass("active", "large")} onClick={handleConfirmKeepChanges}>Keep Changes</button>
                    <button
                      type="button"
                      data-button-type="error"
                      data-button-size="large"
                      className={getUnifiedButtonClass("error", "large")}
                      onClick={() => {
                        setPrefs(confirmedRef.current);
                        setShowKeepDialog(false);
                        setSecondsLeft(12);
                        setStatus("Changes reverted.");
                        void logDesignSystemDebugEvent("Design token changes reverted manually.");
                        if (collapseAfterDialogRef.current) {
                          requestCollapse("save-reverted");
                        }
                      }}
                    >
                      Revert Now
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>,
        document.body,
      ) : null}
    </>
  );
}


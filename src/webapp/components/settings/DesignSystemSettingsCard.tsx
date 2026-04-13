import React from "react";
import { createPortal } from "react-dom";

import {
  type CloudSettingsDecision,
  type DesignTokenPreferences,
  type HarmonyMode,
  HARMONY_MODES,
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

const CARD_PADDING_OPTIONS = [
  { label: "Space 0", value: 0 },
  { label: "Space 1", value: 1 },
  { label: "Space 2", value: 2 },
  { label: "Space 3", value: 3 },
  { label: "Space 4", value: 4 },
  { label: "Space 5", value: 5 },
];

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
  if (state !== "default") {
    classes.push(`cf-ds-btn--${state}`);
  }

  return (
    <button type="button" className={classes.join(" ")} disabled={state === "disabled"}>
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

export function DesignSystemSettingsCard({ userId, placementClassName }: DesignSystemSettingsCardProps): React.JSX.Element {
  const prefs = useUIStore((state) => state.designTokenPreferences);
  const tokens = useUIStore((state) => state.designTokens);
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
  const sectionRefs = React.useRef<Record<string, HTMLElement | null>>({});

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

    const updateBounds = (): void => {
      const root = document.documentElement;
      const cardNode = collapsedCardRef.current;
      const settingsSurface = cardNode?.closest(".settings-page");
      if (!(settingsSurface instanceof HTMLElement)) {
        root.style.removeProperty("--cf-ds-overlay-top");
        root.style.removeProperty("--cf-ds-overlay-left");
        root.style.removeProperty("--cf-ds-overlay-width");
        root.style.removeProperty("--cf-ds-overlay-height");
        return;
      }

      const rect = settingsSurface.getBoundingClientRect();
      root.style.setProperty("--cf-ds-overlay-top", `${Math.round(rect.top)}px`);
      root.style.setProperty("--cf-ds-overlay-left", `${Math.round(rect.left)}px`);
      root.style.setProperty("--cf-ds-overlay-width", `${Math.round(rect.width)}px`);
      root.style.setProperty("--cf-ds-overlay-height", `${Math.round(rect.height)}px`);
    };

    updateBounds();
    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, true);

    return () => {
      const root = document.documentElement;
      root.style.removeProperty("--cf-ds-overlay-top");
      root.style.removeProperty("--cf-ds-overlay-left");
      root.style.removeProperty("--cf-ds-overlay-width");
      root.style.removeProperty("--cf-ds-overlay-height");
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds, true);
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
  }, [isExpanded]);

  React.useLayoutEffect(() => {
    const alignmentPairs = [
      { control: "button-controls", preview: "buttons" },
      { control: "button-behaviors", preview: "buttons" },
      { control: "card-styling", preview: "cards" },
      { control: "dual-mode-card-rules", preview: "cards" },
      { control: "organizer-colors", preview: "organizers" },
      { control: "motion-controls", preview: "motion-preview" },
      { control: "type-ratio", preview: "type-scale" },
      { control: "spacing-scale", preview: "spacing-preview" },
      { control: "color-system", preview: "color-scale" },
      { control: "gamma", preview: "color-scale" },
    ];

    if (!isExpanded) {
      for (const pair of alignmentPairs) {
        const controlNode = sectionRefs.current[pair.control];
        if (controlNode) {
          controlNode.style.removeProperty("margin-top");
        }
      }
      return;
    }

    let frameId: number | null = null;

    const runAlignment = (reason: string): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        for (const pair of alignmentPairs) {
          const controlNode = sectionRefs.current[pair.control];
          const previewNode = sectionRefs.current[pair.preview];
          if (!controlNode || !previewNode) {
            void logDesignSystemDebugEvent("Alignment check fallback: section ref missing.", {
              control: pair.control,
              preview: pair.preview,
              reason,
            });
            continue;
          }

          controlNode.style.removeProperty("margin-top");
          const controlTop = controlNode.getBoundingClientRect().top;
          const previewTop = previewNode.getBoundingClientRect().top;
          const topDelta = Math.round(previewTop - controlTop);

          if (Math.abs(topDelta) <= 8) {
            void logDesignSystemDebugEvent("Alignment check passed.", {
              control: pair.control,
              preview: pair.preview,
              topDelta,
              reason,
            });
            continue;
          }

          if (topDelta > 8) {
            controlNode.style.marginTop = `${topDelta}px`;
            void logDesignSystemDebugEvent("Dynamic control repositioning applied.", {
              control: pair.control,
              preview: pair.preview,
              topDelta,
              reason,
              correction: "control-margin-top",
            });
            continue;
          }

          void logDesignSystemDebugEvent("Alignment drift detected with fallback applied.", {
            control: pair.control,
            preview: pair.preview,
            topDelta,
            reason,
            correction: "layout-order-preserved-no-negative-margin",
          });
        }
      });
    };

    void logDesignSystemDebugEvent("Control relocation map applied.", {
      controlsByPreviewOrder: ["button-controls", "button-behaviors", "card-styling", "dual-mode-card-rules", "organizer-colors", "motion-controls", "type-ratio", "spacing-scale", "color-system", "gamma"],
    });

    void logDesignSystemDebugEvent("Motion preview boxes repositioned to right-side cluster.", {
      section: "motion-preview",
      alignmentTarget: "motion-controls",
      orientation: "horizontal",
    });

    void logDesignSystemDebugEvent("Spacing scale controls relocated below type ratio controls.", {
      section: "spacing-scale",
      relation: "follows-type-ratio",
      alignmentTarget: "spacing-preview",
    });

    runAlignment("expanded-layout-initial");
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => runAlignment("resize-observer")) : null;

    if (observer) {
      for (const pair of alignmentPairs) {
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
      prefs.colorHarmonyMode, prefs.colorHarmonyBaseHue]);

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
      cardShadowShade: prefs.cardShadowShade,
      cardShadowShadeMode: prefs.cardShadowShadeMode,
      cardGlowShade: prefs.cardGlowShade,
      cardGlowShadeMode: prefs.cardGlowShadeMode,
      cardGradientStrength: prefs.cardGradientStrength,
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
    prefs.cardGlowShade,
    prefs.cardGlowShadeMode,
    prefs.cardGradientStrength,
    prefs.cardHeight,
    prefs.cardPaddingIndex,
    prefs.cardShadowShade,
    prefs.cardShadowShadeMode,
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
          <button type="button" className="btn-secondary settings-card__toggle" onClick={handleExpandToggle}>
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
                  className="btn-secondary settings-card__toggle"
                  onClick={() => { requestCollapse("toggle-button"); }}
                >
                  Collapse
                </button>
              </div>

              {cloudPromptVisible ? (
                <div className="cf-keep-dialog" role="group" aria-label="Cloud settings choices">
                  <p>Cloud settings were detected for this account. Choose how to proceed.</p>
                  <div className="form-actions">
                    <button type="button" disabled={cloudDecisionBusy} onClick={() => { void handleCloudDecision("apply-cloud"); }}>Apply Cloud Settings</button>
                    <button type="button" className="btn-secondary" disabled={cloudDecisionBusy} onClick={() => { void handleCloudDecision("keep-local"); }}>Keep Local Settings</button>
                    <button type="button" className="btn-secondary" disabled={cloudDecisionBusy} onClick={() => { void handleCloudDecision("merge-local-into-cloud"); }}>Merge Local Into Cloud</button>
                    <button type="button" className="btn-secondary" disabled={cloudDecisionBusy} onClick={() => { void handleCloudDecision("delete-cloud-use-local-defaults"); }}>Delete Cloud Settings and Use Local Defaults</button>
                  </div>
                </div>
              ) : null}

              {cloudPromptStatus ? <p className="settings-meta">{cloudPromptStatus}</p> : null}

              {localDiagnostics.corrupted ? (
                <div className="cf-keep-dialog" role="group" aria-label="Corrupted settings recovery">
                  <p>Saved settings appear invalid. Choose a recovery option.</p>
                  <p className="settings-meta">Invalid fields: {localDiagnostics.invalidFields.join(", ") || "unknown"}</p>
                  <div className="form-actions">
                    <button type="button" onClick={() => { void handleDeleteOldSettings(); }}>Delete Old Settings</button>
                    <button type="button" className="btn-secondary" onClick={() => resetPrefs()}>Reset to Defaults</button>
                    <button type="button" className="btn-secondary" onClick={() => { void handleRepairSettings(); }}>Try to Repair Settings</button>
                    <button
                      type="button"
                      className="btn-secondary"
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
                <div className="cf-ds-fibonacci-layout__example">
                  <div className="cf-example-card" aria-label="example card preview">
                    <div className="cf-example-card__row" ref={setSectionRef("buttons")}>
                      <h4 className="cf-ds-section-title">Buttons</h4>
                      <div className="cf-example-card__button-grid">
                        <DemoButton variant="primary" size="sm" />
                        <DemoButton variant="primary" size="md" state="hover" />
                        <DemoButton variant="primary" size="lg" state="active" />
                        <DemoButton variant="secondary" size="md" />
                        <DemoButton variant="ghost" size="md" />
                        <DemoButton variant="destructive" size="md" />
                        <DemoButton variant="secondary" size="sm" state="disabled" />
                        <DemoButton variant="secondary" size="lg" state="loading" />
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("cards")}>
                      <h4 className="cf-ds-section-title">Cards</h4>
                      <div className="cf-example-card__cards">
                        <article className="cf-sample-card cf-sample-card--style-preview" aria-label="Email input example">
                          <h5 className="cf-ds-card-subtitle">Email</h5>
                          <label className="cf-ds-email-field" htmlFor="cf-ds-email-input">
                            Email
                            <input id="cf-ds-email-input" type="email" placeholder="teacher@school.org" className="cf-ds-input" />
                          </label>
                          <button type="button" className="cf-ds-btn cf-ds-btn--primary cf-ds-btn--sm">Submit</button>
                        </article>
                        <article className="cf-sample-card cf-sample-card--style-preview cf-sample-card--disabled">
                          <h5 className="cf-ds-card-subtitle">Disabled card</h5>
                          <p>This section is not available yet.</p>
                        </article>
                        <article className="cf-sample-card cf-sample-card--style-preview cf-sample-card--default">
                          <h5 className="cf-ds-card-subtitle">Default card</h5>
                          <p>Color, title, description, and action all follow tokens.</p>
                          <button type="button" className="cf-ds-btn cf-ds-btn--secondary cf-ds-btn--sm">Action</button>
                        </article>
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("organizers")}>
                      <h4 className="cf-ds-section-title">Organizer Buttons</h4>
                      <div className="cf-example-card__organizers">
                        <span className="cf-organizer cf-organizer--new">New</span>
                        <span className="cf-organizer cf-organizer--active">Active</span>
                        <span className="cf-organizer cf-organizer--pending">Pending</span>
                        <span className="cf-organizer cf-organizer--error">Error</span>
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("motion-preview")}>
                      <h4 className="cf-ds-section-title">Motion Preview</h4>
                      <div className="cf-motion-preview-layout">
                        <p className="settings-meta">Hover a box to preview. Timing: {prefs.motionTimingMs}ms | Flow: {prefs.directionalFlow}</p>
                        <div className="cf-motion-row cf-motion-row--right">
                          <div
                            className="cf-motion-box__item"
                            onMouseEnter={() => {
                              void logDesignSystemDebugEvent("Motion preview: enter box hovered.", {
                                role: "enter",
                                motionTimingMs: prefs.motionTimingMs,
                                motionEasing: prefs.motionEasing,
                                directionalFlow: prefs.directionalFlow,
                              });
                            }}
                          >
                            <span className="cf-motion-box cf-motion-box--enter" title="Enter - ease-in" />
                            <span className="cf-motion-box__label">Ease In</span>
                          </div>
                          <div
                            className="cf-motion-box__item"
                            onMouseEnter={() => {
                              void logDesignSystemDebugEvent("Motion preview: move box hovered.", {
                                role: "move",
                                motionTimingMs: prefs.motionTimingMs,
                                motionEasing: prefs.motionEasing,
                                directionalFlow: prefs.directionalFlow,
                              });
                            }}
                          >
                            <span className="cf-motion-box cf-motion-box--move" title="Move - ease-in-out" />
                            <span className="cf-motion-box__label">Ease In-Out</span>
                          </div>
                          <div
                            className="cf-motion-box__item"
                            onMouseEnter={() => {
                              void logDesignSystemDebugEvent("Motion preview: exit box hovered.", {
                                role: "exit",
                                motionTimingMs: prefs.motionTimingMs,
                                motionEasing: prefs.motionEasing,
                                directionalFlow: prefs.directionalFlow,
                              });
                            }}
                          >
                            <span className="cf-motion-box cf-motion-box--exit" title="Exit - ease-out" />
                            <span className="cf-motion-box__label">Ease Out</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("type-scale")}>
                      <h4 className="cf-ds-section-title">Type Scale</h4>
                      <div className="cf-type-scale-grid" aria-label="type scale preview">
                        <p className="cf-type-scale-grid__item cf-type-5xl">text-5xl</p>
                        <p className="cf-type-scale-grid__item cf-type-2xl">Heading text (text-2xl)</p>
                        <p className="cf-type-scale-grid__item cf-type-4xl">text-4xl</p>
                        <p className="cf-type-scale-grid__item cf-type-lg">Subheading text (text-lg)</p>
                        <p className="cf-type-scale-grid__item cf-type-3xl">Title text (text-3xl)</p>
                        <p className="cf-type-scale-grid__item cf-type-base">Body text (base)</p>
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("spacing-preview")}>
                      <h4 className="cf-ds-section-title">Spacing Scale Preview</h4>
                      <div className="cf-spacing-preview" aria-label="spacing scale preview">
                        <span className="cf-spacing-preview__item cf-spacing-preview__item--1">space-1</span>
                        <span className="cf-spacing-preview__item cf-spacing-preview__item--2">space-2</span>
                        <span className="cf-spacing-preview__item cf-spacing-preview__item--3">space-3</span>
                        <span className="cf-spacing-preview__item cf-spacing-preview__item--4">space-4</span>
                      </div>
                    </div>

                    <div className="cf-example-card__row" ref={setSectionRef("color-scale")}>
                      <h4 className="cf-ds-section-title">Color Scale</h4>
                      <div className="cf-ds-swatches" aria-label="primary color swatches">
                        {tokens.color.primary.map((_, index) => (
                          <span key={`shade-${index}`} className={`cf-ds-swatch cf-ds-swatch--${index + 1}`} title={`Shade ${index + 1}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Controls Card — aligned with Example Card rows */}
                <div className="cf-ds-fibonacci-layout__controls">
                  <div className="cf-ds-settings-grid">
                    <section className="cf-ds-control-group" ref={setSectionRef("button-controls")}>
                      <h4 className="cf-ds-section-title">Button Controls</h4>
                      <label>
                        Stroke preset
                        <select value={prefs.strokePreset} onChange={(event) => setPrefs({ strokePreset: event.target.value as DesignTokenPreferences["strokePreset"] })}>
                          {STROKE_PRESET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label} - {option.descriptor}</option>
                          ))}
                        </select>
                      </label>
                      <p className="settings-meta">Buttons inherit stroke, spacing, and color token scales.</p>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("card-styling")}>
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
                        Card Shadow Shade
                        <select
                          value={prefs.cardShadowShadeMode === "auto" ? "auto" : String(prefs.cardShadowShade)}
                          onChange={(event) => {
                            if (event.target.value === "auto") {
                              setPrefs({ cardShadowShadeMode: "auto" });
                              return;
                            }

                            setPrefs({
                              cardShadowShadeMode: "manual",
                              cardShadowShade: Number(event.target.value),
                            });
                          }}
                        >
                          <option value="auto">Auto (base - 1)</option>
                          {SHADE_OPTIONS.map((shade) => (
                            <option key={`card-shadow-${shade}`} value={shade}>{shadeLabel(shade)}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Card Glow Shade
                        <select
                          value={prefs.cardGlowShadeMode === "auto" ? "auto" : String(prefs.cardGlowShade)}
                          onChange={(event) => {
                            if (event.target.value === "auto") {
                              setPrefs({ cardGlowShadeMode: "auto" });
                              return;
                            }

                            setPrefs({
                              cardGlowShadeMode: "manual",
                              cardGlowShade: Number(event.target.value),
                            });
                          }}
                        >
                          <option value="auto">Auto (base + 1)</option>
                          {SHADE_OPTIONS.map((shade) => (
                            <option key={`card-glow-${shade}`} value={shade}>{shadeLabel(shade)}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Card Gradient Strength: {prefs.cardGradientStrength.toFixed(1)}%
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={0.5}
                          value={prefs.cardGradientStrength}
                          onChange={(event) => {
                            setPrefs({ cardGradientStrength: Number(event.target.value) });
                          }}
                        />
                      </label>

                      <label>
                        Card Corner Radius (px)
                        <input
                          type="number"
                          min={4}
                          max={40}
                          step={1}
                          value={prefs.cardCornerRadius}
                          onChange={(event) => {
                            setPrefs({ cardCornerRadius: Number(event.target.value) });
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
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("dual-mode-card-rules")}>
                      <h4 className="cf-ds-section-title">Card Depth — Dual Mode</h4>
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
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("organizer-colors")}>
                      <h4 className="cf-ds-section-title">Organizer Colors</h4>
                      <p className="settings-meta">Organizer colors (aligned with preview order)</p>
                      <div className="cf-ds-semantic-grid">
                        <label>New
                          <input type="color" aria-label="new color" value={prefs.semanticColors.new} onChange={(event) => setSemanticColor("new", event.target.value)} />
                        </label>
                        <label>Active
                          <input type="color" aria-label="active color" value={prefs.semanticColors.success} onChange={(event) => setSemanticColor("success", event.target.value)} />
                        </label>
                        <label>Pending
                          <input type="color" aria-label="pending color" value={prefs.semanticColors.pending} onChange={(event) => setSemanticColor("pending", event.target.value)} />
                        </label>
                        <label>Error
                          <input type="color" aria-label="error color" value={prefs.semanticColors.error} onChange={(event) => setSemanticColor("error", event.target.value)} />
                        </label>
                      </div>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("button-behaviors")}>
                      <h4 className="cf-ds-section-title">Button Behaviors</h4>
                      <label className="cf-ds-checkbox-label">
                        <input
                          type="checkbox"
                          checked={prefs.buttonHoverEnabled}
                          onChange={(event) => {
                            const buttonHoverEnabled = event.target.checked;
                            setPrefs({ buttonHoverEnabled });
                            void logDesignSystemDebugEvent("Button hover effect toggled.", { buttonHoverEnabled });
                          }}
                        />
                        Hover Opacity Effect
                      </label>
                      <label className="cf-ds-checkbox-label">
                        <input
                          type="checkbox"
                          checked={prefs.buttonSquishEnabled}
                          onChange={(event) => {
                            const buttonSquishEnabled = event.target.checked;
                            setPrefs({ buttonSquishEnabled });
                            void logDesignSystemDebugEvent("Button squish effect toggled.", { buttonSquishEnabled });
                          }}
                        />
                        Squish on Press (scale)
                      </label>
                      <label className="cf-ds-checkbox-label">
                        <input
                          type="checkbox"
                          checked={prefs.buttonPressEnabled}
                          onChange={(event) => {
                            const buttonPressEnabled = event.target.checked;
                            setPrefs({ buttonPressEnabled });
                            void logDesignSystemDebugEvent("Button press depth toggled.", { buttonPressEnabled });
                          }}
                        />
                        Press Depth (translateY)
                      </label>
                      <label className="cf-ds-checkbox-label">
                        <input
                          type="checkbox"
                          checked={prefs.buttonRippleEnabled}
                          onChange={(event) => {
                            const buttonRippleEnabled = event.target.checked;
                            setPrefs({ buttonRippleEnabled });
                            void logDesignSystemDebugEvent("Button ripple effect toggled.", { buttonRippleEnabled });
                          }}
                        />
                        Ripple Effect (experimental)
                      </label>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("motion-controls")}>
                      <h4 className="cf-ds-section-title">Motion Controls</h4>
                      <label>
                        Motion timing: {prefs.motionTimingMs}ms ({motionDescription(prefs.motionTimingMs)})
                        <input
                          type="range"
                          min={100}
                          max={500}
                          step={10}
                          value={prefs.motionTimingMs}
                          onChange={(event) => {
                            const motionTimingMs = Number(event.target.value);
                            setPrefs({ motionTimingMs });
                            void logDesignSystemDebugEvent("Motion timing changed.", { motionTimingMs });
                          }}
                        />
                      </label>

                      <label>
                        Motion easing
                        <select
                          value={prefs.motionEasing}
                          onChange={(event) => {
                            const motionEasing = event.target.value as DesignTokenPreferences["motionEasing"];
                            setPrefs({ motionEasing });
                            void logDesignSystemDebugEvent("Motion easing changed.", { motionEasing });
                          }}
                        >
                          <option value="ease-in">ease-in</option>
                          <option value="ease-in-out">ease-in-out</option>
                          <option value="ease-out">ease-out</option>
                        </select>
                      </label>

                      <button
                        type="button"
                        className={`theme-toggle flow-toggle ${prefs.directionalFlow === "right-to-left" ? "flow-toggle--right" : "flow-toggle--left"}`}
                        onClick={() => {
                          const nextFlow = prefs.directionalFlow === "left-to-right" ? "right-to-left" : "left-to-right";
                          setFlowTransitioning(true);
                          setPrefs({ directionalFlow: nextFlow });
                          window.setTimeout(() => { setFlowTransitioning(false); }, prefs.motionTimingMs + 30);
                          void logDesignSystemDebugEvent("Directional flow changed.", {
                            directionalFlow: nextFlow,
                            exampleCardSide: nextFlow === "left-to-right" ? "left" : "right",
                            controlsCardSide: nextFlow === "left-to-right" ? "right" : "left",
                            motionTimingMs: prefs.motionTimingMs,
                            motionEasing: prefs.motionEasing,
                            thumbAnimation: "fade-slide",
                            swapInEasing: "ease-in",
                            swapOutEasing: "ease-out",
                          });
                        }}
                        aria-label="Toggle directional flow"
                      >
                        <span className="theme-toggle__label">{prefs.directionalFlow === "left-to-right" ? "Left" : "Right"}</span>
                        <span className="theme-toggle__track" aria-hidden="true">
                          <span className="theme-toggle__thumb" />
                        </span>
                      </button>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("type-ratio")}>
                      <h4 className="cf-ds-section-title">Type Ratio</h4>
                      <p className="settings-meta">Type ratio preset: {describePreset(prefs.typeRatio, TYPE_RATIO_PRESETS)}</p>
                      <label>
                        Type ratio: {prefs.typeRatio.toFixed(3)}
                        <input
                          type="range"
                          min={1.067}
                          max={1.5}
                          step={0.001}
                          value={prefs.typeRatio}
                          list="cf-type-ratio-presets"
                          onChange={(event) => {
                            const rawValue = Number(event.target.value);
                            handleTypeRatioChange(rawValue);
                            void logDesignSystemDebugEvent("Type ratio descriptor changed.", {
                              descriptor: describePreset(rawValue, TYPE_RATIO_PRESETS),
                            });
                          }}
                        />
                      </label>
                      <datalist id="cf-type-ratio-presets">
                        {TYPE_RATIO_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value} label={preset.label} />
                        ))}
                      </datalist>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("spacing-scale")}>
                      <h4 className="cf-ds-section-title">Spacing Scale</h4>
                      <p className="settings-meta">Spacing ratio preset: {describePreset(prefs.spacingRatio, SPACING_PRESETS)}</p>
                      <label>
                        Spacing ratio: {prefs.spacingRatio.toFixed(3)}
                        <input
                          type="range"
                          min={1.25}
                          max={2}
                          step={0.001}
                          value={prefs.spacingRatio}
                          list="cf-spacing-ratio-presets"
                          onChange={(event) => {
                            const rawValue = Number(event.target.value);
                            handleSpacingRatioChange(rawValue);
                          }}
                        />
                      </label>
                      <datalist id="cf-spacing-ratio-presets">
                        {SPACING_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value} label={preset.label} />
                        ))}
                      </datalist>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("color-system")}>
                      <h4 className="cf-ds-section-title">Color Harmony</h4>
                      <label>
                        Harmony Mode
                        <select
                          value={prefs.colorHarmonyMode}
                          onChange={(event) => {
                            const colorHarmonyMode = event.target.value as HarmonyMode;
                            setPrefs({ colorHarmonyMode });
                            void logDesignSystemDebugEvent("Color harmony mode changed.", { colorHarmonyMode });
                          }}
                        >
                          {HARMONY_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {mode.charAt(0).toUpperCase() + mode.slice(1).replace(/-/g, " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Base Hue: {prefs.colorHarmonyBaseHue}°
                        <input
                          type="range" min={0} max={360} step={1}
                          value={prefs.colorHarmonyBaseHue}
                          onChange={(event) => {
                            const colorHarmonyBaseHue = Number(event.target.value);
                            setPrefs({ colorHarmonyBaseHue });
                            void logDesignSystemDebugEvent("Color harmony base hue changed.", { colorHarmonyBaseHue, mode: prefs.colorHarmonyMode });
                          }}
                        />
                      </label>
                      <p className="settings-meta">Accent and highlight hues derived from harmony mode and base hue.</p>
                      <div className="cf-ds-harmony-swatches" aria-label="harmony color preview">
                        <span className="cf-harmony-swatch cf-harmony-swatch--accent" title="Accent color" style={{ display: "inline-block", width: 24, height: 24, borderRadius: 4 }} />
                        <span className="cf-harmony-swatch cf-harmony-swatch--highlight" title="Highlight color" style={{ display: "inline-block", width: 24, height: 24, borderRadius: 4 }} />
                      </div>
                    </section>

                    <section className="cf-ds-control-group" ref={setSectionRef("gamma")}>
                      <h4 className="cf-ds-section-title">Color Curve</h4>
                      <label>
                        Gamma: {prefs.gamma.toFixed(2)}
                        <input
                          type="range"
                          min={2}
                          max={2.4}
                          step={0.05}
                          value={prefs.gamma}
                          onChange={(event) => {
                            const gamma = Number(event.target.value);
                            setPrefs({ gamma });
                            void logDesignSystemDebugEvent("Gamma changed.", { gamma });
                          }}
                        />
                      </label>
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
                <button type="button" onClick={() => { void handleSave(); }}>Save</button>
                <button type="button" className="btn-secondary" onClick={() => { void handleLoadCloudSettings(); }} disabled={!userId}>Load Cloud Settings</button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    resetPrefs();
                    requestCollapse("reset");
                    void logDesignSystemDebugEvent("Design token reset to defaults. Collapsing.", { trigger: "reset" });
                  }}
                >
                  Reset to defaults
                </button>
                <button type="button" className="btn-secondary" onClick={() => applySystemDefaults()}>Use System Defaults</button>
                <button
                  type="button"
                  className="btn-secondary"
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
                    <button type="button" onClick={handleConfirmKeepChanges}>Keep Changes</button>
                    <button
                      type="button"
                      className="btn-secondary"
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


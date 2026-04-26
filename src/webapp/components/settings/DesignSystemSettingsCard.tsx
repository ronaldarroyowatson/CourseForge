import React from "react";

import {
  type CloudSettingsDecision,
  type ColorHarmony,
  type ColorMode,
  type DesignTokenPreferences,
  type RoundingPreset,
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
  logDscMasonryLayoutDecision,
  selectDscMasonryLayout,
} from "../../../core/services/masonryLayoutService";
import { useUIStore } from "../../store/uiStore";

interface DesignSystemSettingsCardProps {
  userId: string | null;
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

const STROKE_PRESET_OPTIONS: Array<{ label: string; value: DesignTokenPreferences["strokePreset"]; descriptor: string }> = [
  { label: "Common", value: "common", descriptor: "1 -> 1.5 -> 2" },
  { label: "Doubling", value: "doubling", descriptor: "1 -> 2 -> 4" },
  { label: "Soft", value: "soft", descriptor: "1 -> 1.25 -> 1.5" },
  { label: "Ultra Thin", value: "ultra-thin", descriptor: "0.5 -> 1 -> 2 -> 3" },
  { label: "Sweet Spot", value: "sweet-spot", descriptor: "1 -> 1.5 -> 2 -> 3" },
];

const ROUNDING_OPTIONS: Array<{ label: string; value: RoundingPreset; descriptor: string }> = [
  { label: "Sharp", value: "sharp", descriptor: "0 / 2 / 4 px" },
  { label: "Soft", value: "soft", descriptor: "4 / 8 / 12 px" },
  { label: "Round", value: "round", descriptor: "8 / 16 / 24 px" },
  { label: "Pill", value: "pill", descriptor: "full radius" },
];

const COLOR_HARMONY_OPTIONS: Array<{ label: string; value: ColorHarmony }> = [
  { label: "System Default", value: "system-default" },
  { label: "Monochromatic", value: "monochromatic" },
  { label: "Analogous", value: "analogous" },
  { label: "Complementary", value: "complementary" },
  { label: "Triadic", value: "triadic" },
  { label: "Split-Complementary", value: "split-complementary" },
  { label: "Tetradic", value: "tetradic" },
];

const COLOR_MODE_OPTIONS: Array<{ label: string; value: ColorMode }> = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System Default", value: "system" },
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

function normalizeHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

function circularHueDistance(h1: number, h2: number): number {
  const diff = Math.abs(normalizeHue(h1) - normalizeHue(h2));
  return Number(Math.min(diff, 360 - diff).toFixed(1));
}

function harmonyAngles(primaryHue: number, harmony: ColorHarmony): { accentHue: number; altHue: number; brandHue: number } {
  const base = normalizeHue(primaryHue);
  switch (harmony) {
    case "monochromatic":
      return { accentHue: base, altHue: normalizeHue(base + 18), brandHue: normalizeHue(base + 12) };
    case "analogous":
      return { accentHue: normalizeHue(base + 30), altHue: normalizeHue(base + 60), brandHue: normalizeHue(base + 330) };
    case "complementary":
      return { accentHue: normalizeHue(base + 180), altHue: normalizeHue(base + 210), brandHue: normalizeHue(base + 30) };
    case "triadic":
      return { accentHue: normalizeHue(base + 120), altHue: normalizeHue(base + 240), brandHue: normalizeHue(base + 120) };
    case "split-complementary":
      return { accentHue: normalizeHue(base + 150), altHue: normalizeHue(base + 210), brandHue: normalizeHue(base + 150) };
    case "tetradic":
      return { accentHue: normalizeHue(base + 90), altHue: normalizeHue(base + 180), brandHue: normalizeHue(base + 90) };
    case "system-default":
    default:
      return { accentHue: normalizeHue(base + 24), altHue: normalizeHue(base + 48), brandHue: normalizeHue(base + 12) };
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const safe = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#4f87ff";
  return [
    parseInt(safe.slice(1, 3), 16),
    parseInt(safe.slice(3, 5), 16),
    parseInt(safe.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHue(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((value) => value / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) {
    return 0;
  }

  let hue = 0;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return normalizeHue(hue * 60);
}

function hueToHex(hue: number, saturation: number, lightness = 0.52): string {
  const h = normalizeHue(hue);
  const s = Math.max(0, Math.min(1, saturation / 100));
  const l = Math.max(0, Math.min(1, lightness));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** A paired row in the DSC workspace — example cell left, control cell right. */
function PairedRow({
  children,
  id,
}: {
  children: [React.ReactNode, React.ReactNode];
  id?: string;
}): React.JSX.Element {
  return (
    <>
      <div className="cf-ds-pair__example" id={id ? `${id}-example` : undefined}>
        {children[0]}
      </div>
      <div className="cf-ds-pair__control" aria-labelledby={id ? `${id}-example` : undefined}>
        {children[1]}
      </div>
    </>
  );
}

export function DesignSystemSettingsCard({ userId }: DesignSystemSettingsCardProps): React.JSX.Element {
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
  const [distanceDirection, setDistanceDirection] = React.useState<1 | -1>(1);
  const [draggingMarker, setDraggingMarker] = React.useState<"primary" | "brand" | "accent" | "alt" | null>(null);
  const [brandColorManualOverride, setBrandColorManualOverride] = React.useState(false);
  const [localDiagnostics, setLocalDiagnostics] = React.useState(() => readLocalDesignTokenDiagnostics());
  const confirmedRef = React.useRef<DesignTokenPreferences>(prefs);
  const countdownIdRef = React.useRef<number | null>(null);
  const layoutContainerRef = React.useRef<HTMLDivElement>(null);
  const wheelRef = React.useRef<HTMLDivElement | null>(null);
  const [layoutWidth, setLayoutWidth] = React.useState(1024);
  const layout = React.useMemo(() => selectDscMasonryLayout(layoutWidth, {
    directionalFlow: prefs.directionalFlow,
    optionalFibonacciSpacing: true,
  }), [layoutWidth, prefs.directionalFlow]);

  React.useEffect(() => {
    setLocalDiagnostics(readLocalDesignTokenDiagnostics());
  }, [prefs]);

  React.useEffect(() => {
    const node = layoutContainerRef.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = node.offsetWidth || (typeof window !== "undefined" ? window.innerWidth : 1024);
      setLayoutWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    void logDscMasonryLayoutDecision(layout, {
      directionalFlow: prefs.directionalFlow,
      containerWidth: layoutWidth,
    });
  }, [layout, layoutWidth, prefs.directionalFlow]);

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
    const wheel = wheelRef.current;
    if (!wheel) {
      return;
    }

    wheel.style.setProperty("--cf-ds-wheel-primary", `${normalizeHue(prefs.primaryHue)}deg`);
    wheel.style.setProperty("--cf-ds-wheel-brand", `${normalizeHue(prefs.brandHue)}deg`);
    wheel.style.setProperty("--cf-ds-wheel-accent", `${normalizeHue(prefs.accentHue)}deg`);
    wheel.style.setProperty("--cf-ds-wheel-alt", `${normalizeHue(prefs.altHue)}deg`);

    const brandDistance = Math.max(10, Math.min(48, prefs.brandDistance));
    const accentDistance = Math.max(10, Math.min(48, prefs.accentDistance));
    wheel.style.setProperty("--cf-ds-wheel-brand-distance", `${brandDistance}%`);
    wheel.style.setProperty("--cf-ds-wheel-accent-distance", `${accentDistance}%`);
    wheel.style.setProperty("--cf-ds-wheel-alt-distance", `${accentDistance}%`);
  }, [prefs.primaryHue, prefs.brandHue, prefs.accentHue, prefs.altHue, prefs.brandDistance, prefs.accentDistance]);

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
  }, [secondsLeft, setPrefs, showKeepDialog]);

  async function handleSave(): Promise<void> {
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
  }

  function setSemanticColor(key: keyof DesignTokenPreferences["semanticColors"], value: string): void {
    setPrefs({
      semanticColors: {
        ...prefs.semanticColors,
        [key]: value,
      },
    });
  }

  const applyPrimaryHue = React.useCallback((nextPrimaryHue: number) => {
    const normalizedPrimaryHue = Math.round(normalizeHue(nextPrimaryHue));

    if (prefs.colorHarmony !== "system-default") {
      const derived = harmonyAngles(normalizedPrimaryHue, prefs.colorHarmony);
      setBrandColorManualOverride(false);
      setPrefs({
        primaryHue: normalizedPrimaryHue,
        accentHue: derived.accentHue,
        altHue: derived.altHue,
        brandHue: derived.brandHue,
      });
      return;
    }

    setPrefs({ primaryHue: normalizedPrimaryHue });
  }, [prefs.colorHarmony, setPrefs]);

  const applyHarmonyToHues = React.useCallback((harmony: ColorHarmony) => {
    const next = harmonyAngles(prefs.primaryHue, harmony);
    if (harmony !== "system-default") {
      setBrandColorManualOverride(false);
    }
    setPrefs({
      colorHarmony: harmony,
      accentHue: next.accentHue,
      altHue: next.altHue,
      ...(harmony === "system-default" && brandColorManualOverride ? {} : { brandHue: next.brandHue }),
    });
  }, [brandColorManualOverride, prefs.primaryHue, setPrefs]);

  const updateWheelMarkerFromPointer = React.useCallback((event: PointerEvent | React.PointerEvent<HTMLElement>, marker: "primary" | "brand" | "accent" | "alt") => {
    const wheel = wheelRef.current;
    if (!wheel) {
      return;
    }

    const rect = wheel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const angle = normalizeHue((Math.atan2(dy, dx) * 180) / Math.PI + 90);
    const radius = Math.sqrt(dx * dx + dy * dy);
    const radial = Math.round(Math.max(10, Math.min(48, (radius / (rect.width / 2)) * 48)));

    if (marker === "primary") {
      applyPrimaryHue(angle);
      return;
    }

    if (marker === "brand") {
      if (prefs.colorHarmony !== "system-default") {
        applyPrimaryHue(angle);
        return;
      }

      setPrefs({ brandHue: Math.round(angle), brandDistance: radial });
      setBrandColorManualOverride(true);
      return;
    }
    if (marker === "accent") {
      setPrefs({ accentHue: Math.round(angle), accentDistance: radial });
      return;
    }
    setPrefs({ altHue: Math.round(angle), accentDistance: radial });
  }, [applyPrimaryHue, prefs.colorHarmony, setPrefs]);

  React.useEffect(() => {
    if (!draggingMarker) {
      return;
    }

    const move = (event: PointerEvent) => updateWheelMarkerFromPointer(event, draggingMarker);
    const up = () => setDraggingMarker(null);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [draggingMarker, updateWheelMarkerFromPointer]);

  function flipHueDirection(): void {
    const nextDirection: 1 | -1 = distanceDirection === 1 ? -1 : 1;
    setDistanceDirection(nextDirection);
    setPrefs({
      brandHue: Math.round(normalizeHue(prefs.primaryHue + nextDirection * prefs.brandDistance)),
      altHue: Math.round(normalizeHue(prefs.accentHue + nextDirection * prefs.accentDistance)),
    });
  }

  function onBrandHexChange(value: string): void {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      return;
    }

    if (prefs.colorHarmony !== "system-default") {
      applyPrimaryHue(hexToHue(value));
      return;
    }

    setBrandColorManualOverride(true);
    setPrefs({ brandHue: Math.round(hexToHue(value)) });
  }

  function onBrandRgbChange(value: string): void {
    const parts = value.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
      return;
    }

    if (prefs.colorHarmony !== "system-default") {
      applyPrimaryHue(hexToHue(rgbToHex(parts[0], parts[1], parts[2])));
      return;
    }

    setBrandColorManualOverride(true);
    setPrefs({ brandHue: Math.round(hexToHue(rgbToHex(parts[0], parts[1], parts[2]))) });
  }

  function buildSemanticGlowShadow(color: string): string {
    const softRadius = Math.round(prefs.glowRadius * 0.75);
    const wideRadius = Math.round(prefs.glowRadius * 1.45);
    const intensity = Math.max(0.1, Math.min(1, prefs.glowIntensity));

    return `0 0 0 1px ${color}44, 0 0 ${softRadius}px color-mix(in srgb, ${color} ${Math.round(intensity * 100)}%, transparent), 0 0 ${wideRadius}px color-mix(in srgb, ${color} ${Math.round(intensity * 72)}%, transparent), ${tokens.glow.shadow}`;
  }
  const layoutClassName = layout.columnCount === 12
    ? "cf-ds-masonry-layout--wide"
    : layout.columnCount === 10
      ? "cf-ds-masonry-layout--medium"
      : "cf-ds-masonry-layout--single";

  const roundingValues: Record<string, string> = {
    sharp: "0px / 2px / 4px",
    soft: "4px / 8px / 12px",
    round: "8px / 16px / 24px",
    pill: "16px / 32px / 9999px",
  };

  const typeSnapPreset = React.useMemo(
    () => TYPE_RATIO_PRESETS.find((preset) => Math.abs(preset.value - prefs.typeRatio) < 0.0015) ?? null,
    [prefs.typeRatio],
  );
  const spacingSnapPreset = React.useMemo(
    () => SPACING_PRESETS.find((preset) => Math.abs(preset.value - prefs.spacingRatio) < 0.0015) ?? null,
    [prefs.spacingRatio],
  );
  const errorSemanticGlowShadow = React.useMemo(() => buildSemanticGlowShadow(prefs.semanticColors.error), [prefs.glowIntensity, prefs.glowRadius, prefs.semanticColors.error, tokens.glow.shadow]);
  const successSemanticGlowShadow = React.useMemo(() => buildSemanticGlowShadow(prefs.semanticColors.success), [prefs.glowIntensity, prefs.glowRadius, prefs.semanticColors.success, tokens.glow.shadow]);
  const pendingSemanticGlowShadow = React.useMemo(() => buildSemanticGlowShadow(prefs.semanticColors.pending), [prefs.glowIntensity, prefs.glowRadius, prefs.semanticColors.pending, tokens.glow.shadow]);
  const newSemanticGlowShadow = React.useMemo(() => buildSemanticGlowShadow(prefs.semanticColors.new), [prefs.glowIntensity, prefs.glowRadius, prefs.semanticColors.new, tokens.glow.shadow]);
  const brandColorHex = React.useMemo(() => hueToHex(prefs.brandHue, prefs.saturation), [prefs.brandHue, prefs.saturation]);
  const brandColorRgb = React.useMemo(() => {
    const [r, g, b] = hexToRgb(brandColorHex);
    return `${r}, ${g}, ${b}`;
  }, [brandColorHex]);
  const effectiveMode: "light" | "dark" = React.useMemo(() => {
    if (prefs.colorMode === "dark") return "dark";
    if (prefs.colorMode === "light") return "light";
    // "system" — resolve against the OS preference at render time
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }, [prefs.colorMode]);
  const semanticSurfaceClass = effectiveMode === "dark" ? "cf-ds-semantic-chip--glow" : "cf-ds-semantic-chip--shadow";

  return (
    <article className="settings-card cf-ds-card settings-card--full cf-ds-card--masonry" aria-live="polite">
      <h3>Design System Controls</h3>
      <p className="settings-meta">Single source of truth for color, type, stroke, spacing, motion, rounding, and glow tokens.</p>
      <div className="cf-ds-layout-meta" aria-label="Layout engine summary">
        <span className="cf-ds-layout-meta__chip">Engine: Masonry</span>
        <span className="cf-ds-layout-meta__chip">Columns: {layout.columnCount}</span>
        <span className="cf-ds-layout-meta__chip">Spacing: Fib {layout.spacingToken}px</span>
        <span className="cf-ds-layout-meta__chip">Adaptive Reflow: On</span>
        <span className="cf-ds-layout-meta__chip">Motion Preview: Hover</span>
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

      <div
        ref={layoutContainerRef}
        className={`cf-ds-masonry-layout ${layoutClassName} cf-ds-paired-workspace`}
        data-flow={prefs.directionalFlow}
        data-columns={layout.columnCount}
        aria-label="Design System Controls workspace"
      >
        <div className="cf-ds-pair__header cf-ds-pair__example" aria-label="Example Card" data-card-order={layout.placements.examples.order}>
          <h4>Example Card</h4>
          <p className="settings-meta">Visual previews of every token in action.</p>
        </div>
        <div className="cf-ds-pair__header cf-ds-pair__control" aria-label="Controls Card" data-card-order={layout.placements.controls.order}>
          <h4>Controls Card</h4>
          <p className="settings-meta">Controls aligned horizontally with each example.</p>
        </div>

        <PairedRow id="cf-dsc-colors">
          <div>
            <h5>Primary Color Scale</h5>
            <div className="cf-ds-swatches" aria-label="primary color swatches">
              {tokens.color.primary.map((shade, index) => (
                <span
                  key={`primary-${index}`}
                  className={`cf-ds-swatch cf-ds-swatch--${index + 1}`}
                  title={`Primary shade ${index + 1}: ${shade}`}
                />
              ))}
            </div>
          </div>
          <div>
            <label>
              Primary hue: {prefs.primaryHue}&deg;
              <input type="range" min={0} max={359} step={1} value={prefs.primaryHue} onChange={(event) => {
                applyPrimaryHue(Number(event.target.value));
              }} />
            </label>
            <label>
              Saturation: {prefs.saturation}%
              <input type="range" min={0} max={100} step={1} value={prefs.saturation} onChange={(event) => setPrefs({ saturation: Number(event.target.value) })} />
            </label>
            <label>
              Gamma: {prefs.gamma.toFixed(2)}
              <input type="range" min={2} max={2.4} step={0.05} value={prefs.gamma} onChange={(event) => setPrefs({ gamma: Number(event.target.value) })} />
            </label>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-accent">
          <div>
            <h5>Accent &amp; Brand Colors</h5>
            <div className="cf-ds-swatches" aria-label="accent color swatches">
              {tokens.color.accent.map((shade, index) => (
                <span
                  key={`accent-${index}`}
                  className={`cf-ds-swatch ${index === 0 ? "cf-ds-swatch--accent-brand" : index === 1 ? "cf-ds-swatch--accent-main" : "cf-ds-swatch--accent-alt"}`}
                  title={`Accent shade ${index + 1}: ${shade}`}
                />
              ))}
            </div>
            <div
              ref={wheelRef}
              className="cf-ds-color-wheel"
              aria-label="accent derivation wheel"
              data-render-key={`${prefs.saturation}-${prefs.glowIntensity}-${prefs.gamma}`}
            >
              <button
                type="button"
                aria-label="primary wheel marker"
                data-hue={Math.round(prefs.primaryHue)}
                className="cf-ds-color-wheel__dot cf-ds-color-wheel__dot--primary"
                onPointerDown={(event) => {
                  setDraggingMarker("primary");
                  updateWheelMarkerFromPointer(event, "primary");
                }}
              />
              <button
                type="button"
                aria-label="brand wheel marker"
                data-hue={Math.round(prefs.brandHue)}
                className="cf-ds-color-wheel__dot cf-ds-color-wheel__dot--brand"
                onPointerDown={(event) => {
                  setDraggingMarker("brand");
                  updateWheelMarkerFromPointer(event, "brand");
                }}
              />
              <button
                type="button"
                aria-label="accent wheel marker"
                data-hue={Math.round(prefs.accentHue)}
                className="cf-ds-color-wheel__dot cf-ds-color-wheel__dot--accent"
                onPointerDown={(event) => {
                  setDraggingMarker("accent");
                  updateWheelMarkerFromPointer(event, "accent");
                }}
              />
              <button
                type="button"
                aria-label="alt wheel marker"
                data-hue={Math.round(prefs.altHue)}
                className="cf-ds-color-wheel__dot cf-ds-color-wheel__dot--alt"
                onPointerDown={(event) => {
                  setDraggingMarker("alt");
                  updateWheelMarkerFromPointer(event, "alt");
                }}
              />
            </div>
            <div className="cf-ds-accent-pair">
              <span className="cf-ds-accent-chip cf-ds-accent-chip--brand">Brand</span>
              <span className="cf-ds-accent-chip cf-ds-accent-chip--accent">Accent</span>
              <span className="cf-ds-accent-chip cf-ds-accent-chip--alt">Alt</span>
            </div>
          </div>
          <div>
            <label>
              Brand hue: {prefs.brandHue}&deg;
              <input type="range" min={0} max={359} step={1} value={prefs.brandHue} onChange={(event) => { setBrandColorManualOverride(true); setPrefs({ brandHue: Number(event.target.value) }); }} />
            </label>
            <label>
              Accent hue: {prefs.accentHue}&deg;
              <input type="range" min={0} max={359} step={1} value={prefs.accentHue} onChange={(event) => setPrefs({ accentHue: Number(event.target.value) })} />
            </label>
            <label>
              Alt hue: {prefs.altHue}&deg;
              <input type="range" min={0} max={359} step={1} value={prefs.altHue} onChange={(event) => setPrefs({ altHue: Number(event.target.value) })} />
            </label>
            <label>
              Brand radial distance: {prefs.brandDistance.toFixed(0)}&deg;
              <input type="range" min={10} max={48} step={1} value={prefs.brandDistance} onChange={(event) => setPrefs({ brandDistance: Number(event.target.value), brandHue: Math.round(normalizeHue(prefs.primaryHue + distanceDirection * Number(event.target.value))) })} />
            </label>
            <label>
              Accent radial distance: {prefs.accentDistance.toFixed(0)}&deg;
              <input type="range" min={10} max={48} step={1} value={prefs.accentDistance} onChange={(event) => setPrefs({ accentDistance: Number(event.target.value), altHue: Math.round(normalizeHue(prefs.accentHue + distanceDirection * Number(event.target.value))) })} />
            </label>
            <button type="button" className="btn-secondary" onClick={flipHueDirection}>Flip direction</button>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-harmony">
          <div>
            <h5>Color Harmony &mdash; {tokens.color.harmony.label}</h5>
            <div className="cf-ds-harmony-swatches" aria-label="color harmony swatches">
              {tokens.color.harmony.colors.map((color, index) => (
                <span key={`harmony-${index}`} className="cf-ds-harmony-swatch" title={`Harmony color ${index + 1}: ${color}`} />
              ))}
            </div>
            <p className="settings-meta">Primary↔Accent hue distance: {circularHueDistance(prefs.primaryHue, prefs.accentHue)}&deg;</p>
            <div className="cf-ds-harmony-brand-suggestion">
              <span className="cf-ds-harmony-swatch cf-ds-harmony-swatch--suggested" title={`Suggested brand color: ${tokens.color.harmony.suggestedBrandColor}`} />
              <span className="settings-meta">Suggested brand color</span>
            </div>
          </div>
          <div>
            <label>
              Color harmony
              <select value={prefs.colorHarmony} onChange={(event) => { applyHarmonyToHues(event.target.value as ColorHarmony); void logDesignSystemDebugEvent("Color harmony changed.", { colorHarmony: event.target.value }); }}>
                {COLOR_HARMONY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Brand color hex
              <input aria-label="Brand color hex" type="text" value={brandColorHex} onChange={(event) => onBrandHexChange(event.target.value)} />
            </label>
            <label>
              Brand color rgb
              <input aria-label="Brand color rgb" type="text" value={brandColorRgb} onChange={(event) => onBrandRgbChange(event.target.value)} />
            </label>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-colormode">
          <div>
            <h5>Light / Dark Mode</h5>
            <div className="cf-ds-mode-pair">
              <div
                className="cf-ds-mode-sample cf-ds-mode-sample--light"
                aria-label="Light mode sample"
              >
                <span className="cf-ds-mode-sample__label">Light</span>
                <span className="cf-ds-mode-sample__card">Card</span>
              </div>
              <div className="cf-ds-mode-sample cf-ds-mode-sample--dark" aria-label="Dark mode sample"><span className="cf-ds-mode-sample__label">Dark</span><span className="cf-ds-mode-sample__card">Card</span></div>
              <div className={`cf-ds-mode-sample cf-ds-mode-sample--active cf-ds-mode-sample--${prefs.colorMode === "system" ? "system" : prefs.colorMode}`} aria-label="Active mode sample"><span className="cf-ds-mode-sample__label">Active</span><span className="cf-ds-mode-sample__card">{prefs.colorMode}</span></div>
            </div>
          </div>
          <div>
            <label>
              Color mode
              <select value={prefs.colorMode} onChange={(event) => { setPrefs({ colorMode: event.target.value as ColorMode }); void logDesignSystemDebugEvent("Color mode changed.", { colorMode: event.target.value }); }}>
                {COLOR_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-glow">
          <div>
            <h5>Glow &amp; Shadow</h5>
            <div className="cf-ds-glow-row" aria-label="glow and shadow examples">
              <span className="cf-ds-light-shadow-pad"><span className="cf-ds-shadow-box" aria-label="light mode shadow sample" data-shadow-style={tokens.glow.shadow} /></span>
              <span className={`cf-ds-glow-box ${effectiveMode === "dark" || prefs.glowEnabled ? "cf-ds-glow-box--enabled" : "cf-ds-glow-box--disabled"}`} aria-label={prefs.glowEnabled ? "glow enabled" : "glow disabled"} data-glow-style={tokens.glow.boxShadow} />
            </div>
          </div>
          <div>
            <label>
              Glow radius: {prefs.glowRadius}px
              <input type="range" min={4} max={48} step={1} value={prefs.glowRadius} onChange={(event) => setPrefs({ glowRadius: Number(event.target.value) })} />
            </label>
            <label>
              Glow intensity: {prefs.glowIntensity.toFixed(2)}
              <input type="range" min={0.1} max={1} step={0.05} value={prefs.glowIntensity} onChange={(event) => setPrefs({ glowIntensity: Number(event.target.value) })} />
            </label>
            <label>
              Shadow strength: {prefs.shadowStrength.toFixed(2)}
              <input type="range" min={0.1} max={1} step={0.05} value={prefs.shadowStrength} onChange={(event) => setPrefs({ shadowStrength: Number(event.target.value) })} />
            </label>
            <label>
              Shadow distance: {prefs.shadowDistance.toFixed(0)}px
              <input type="range" min={0} max={40} step={1} value={prefs.shadowDistance} onChange={(event) => setPrefs({ shadowDistance: Number(event.target.value) })} />
            </label>
            <label>
              Shadow blur: {prefs.shadowBlur.toFixed(0)}px
              <input type="range" min={2} max={80} step={1} value={prefs.shadowBlur} onChange={(event) => setPrefs({ shadowBlur: Number(event.target.value) })} />
            </label>
            <label>
              Shadow spread: {prefs.shadowSpread.toFixed(0)}px
              <input type="range" min={-12} max={20} step={1} value={prefs.shadowSpread} onChange={(event) => setPrefs({ shadowSpread: Number(event.target.value) })} />
            </label>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-rounding">
          <div>
            <h5>Rounding &mdash; {prefs.rounding}</h5>
            <div className="cf-ds-rounding-row" aria-label="rounding examples">
              <span className="cf-ds-rounding-box" data-rounding="sharp" data-size="sm" />
              <span className="cf-ds-rounding-box" data-rounding="soft" data-size="md" />
              <span className="cf-ds-rounding-box" data-rounding="round" data-size="lg" />
              <span className="cf-ds-rounding-box cf-ds-rounding-box--pill" data-rounding="pill" />
            </div>
            <p className="settings-meta">{roundingValues[prefs.rounding]}</p>
          </div>
          <div>
            <div className="cf-ds-chip-row" role="group" aria-label="Rounding preset">
              {ROUNDING_OPTIONS.map((option) => (
                <button key={option.value} type="button" className="btn-secondary cf-ds-rounding-button" aria-label={`${option.label} rounding`} data-rounding={option.value} onClick={() => setPrefs({ rounding: option.value })}>{option.label}</button>
              ))}
            </div>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-type">
          <div>
            <h5>Type Scale</h5>
            <div className="cf-ds-type-columns">
              <div>
                <p className="cf-type-5xl">text-5xl</p>
                <p className="cf-type-4xl">text-4xl</p>
                <p className="cf-type-3xl">Title text (text-3xl)</p>
              </div>
              <div>
                <p className="cf-type-2xl">Heading text (text-2xl)</p>
                <p className="cf-type-lg">Subheading text (text-lg)</p>
                <p className="cf-type-base">Body text (base)</p>
              </div>
            </div>
          </div>
          <div>
            <label>
              Type ratio: {prefs.typeRatio.toFixed(3)}
              <input type="range" min={1.067} max={1.5} step={0.001} value={prefs.typeRatio} onChange={(event) => setPrefs({ typeRatio: Number(event.target.value) })} />
            </label>
            {typeSnapPreset ? <p className="settings-meta">Type preset: {typeSnapPreset.label}</p> : null}
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-spacing">
          <div>
            <h5>Spacing Scale</h5>
            <div className="cf-ds-spacing-row" aria-label="spacing scale examples">
              {tokens.spacing.values.map((value, index) => (
                <div key={`spacing-${index}`} className="cf-ds-spacing-item">
                  <span className="cf-ds-spacing-bar" title={`Space-${index}: ${value}px`} data-value={value} />
                  <span className="cf-ds-spacing-label">{value}px</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label>
              Spacing ratio: {prefs.spacingRatio.toFixed(3)}
              <input type="range" min={1.25} max={2} step={0.001} value={prefs.spacingRatio} onChange={(event) => setPrefs({ spacingRatio: Number(event.target.value) })} />
            </label>
            {spacingSnapPreset ? <p className="settings-meta">Spacing preset: {spacingSnapPreset.label}</p> : null}
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-stroke">
          <div>
            <h5>Stroke Weights</h5>
            <div className="cf-ds-stroke-row" aria-label="stroke weight examples">
              {tokens.stroke.values.map((value, index) => (
                <div key={`stroke-${index}`} className="cf-ds-stroke-item">
                  <span className="cf-ds-stroke-bar" title={`Stroke ${index + 1}: ${value}px`} data-value={value} />
                  <span className="cf-ds-stroke-label">{value}px</span>
                </div>
              ))}
            </div>
            <p className="settings-meta">Preset: {prefs.strokePreset}</p>
          </div>
          <div>
            <label>
              Stroke preset
              <select value={prefs.strokePreset} onChange={(event) => setPrefs({ strokePreset: event.target.value as DesignTokenPreferences["strokePreset"] })}>
                {STROKE_PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label} &mdash; {option.descriptor}</option>
                ))}
              </select>
            </label>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-motion">
          <div>
            <h5>Motion Preview</h5>
            <div className="cf-motion-row" aria-label="motion preview - hover to animate">
              <div className="cf-motion-box__item">
                <span className="cf-motion-box cf-motion-box--enter" title="Enter - ease-in. Hover to preview." />
                <span className="cf-motion-box__label">Ease In</span>
              </div>
              <div className="cf-motion-box__item">
                <span className="cf-motion-box cf-motion-box--move" title="Move - ease-in-out. Hover to preview." />
                <span className="cf-motion-box__label">Ease In-Out</span>
              </div>
              <div className="cf-motion-box__item">
                <span className="cf-motion-box cf-motion-box--exit" title="Exit - ease-out. Hover to preview." />
                <span className="cf-motion-box__label">Ease Out</span>
              </div>
            </div>
          </div>
          <div>
            <label>
              Motion timing: {prefs.motionTimingMs}ms ({motionDescription(prefs.motionTimingMs)})
              <input type="range" min={100} max={500} step={10} value={prefs.motionTimingMs} onChange={(event) => setPrefs({ motionTimingMs: Number(event.target.value) })} />
            </label>
            <label>
              Motion easing
              <select value={prefs.motionEasing} onChange={(event) => setPrefs({ motionEasing: event.target.value as DesignTokenPreferences["motionEasing"] })}>
                <option value="ease-in">ease-in</option>
                <option value="ease-out">ease-out</option>
                <option value="ease-in-out">ease-in-out</option>
              </select>
            </label>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-components">
          <div>
            <h5>Buttons &amp; Cards</h5>
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
            <div className="cf-example-card__cards">
              <article className="cf-sample-card">
                <h6>Email card</h6>
                <p>Subject: Weekly curriculum update</p>
                <button type="button" className="cf-ds-btn cf-ds-btn--primary cf-ds-btn--sm">Open</button>
              </article>
              <article className="cf-sample-card cf-sample-card--disabled">
                <h6>Disabled card</h6>
                <p>This section is not available yet.</p>
              </article>
            </div>
          </div>
          <div>
            <label>
              Directional flow
              <select value={prefs.directionalFlow} onChange={(event) => { setPrefs({ directionalFlow: event.target.value as DesignTokenPreferences["directionalFlow"] }); void logDesignSystemDebugEvent("Directional flow changed.", { directionalFlow: event.target.value }); }}>
                <option value="left-to-right">Left to Right (LTR)</option>
                <option value="right-to-left">Right to Left (RTL)</option>
              </select>
            </label>
          </div>
        </PairedRow>

        <PairedRow id="cf-dsc-semantic">
          <div>
            <h5>Semantic Colors</h5>
            <div className="cf-ds-semantic-examples" aria-label="semantic color examples">
              <span className={`cf-ds-semantic-chip cf-ds-semantic-chip--error ${semanticSurfaceClass}`} data-rounding={prefs.rounding} data-semantic-glow-color={prefs.semanticColors.error} data-semantic-glow-shadow={errorSemanticGlowShadow}>Error</span>
              <span className={`cf-ds-semantic-chip cf-ds-semantic-chip--success ${semanticSurfaceClass}`} data-rounding={prefs.rounding} data-semantic-glow-color={prefs.semanticColors.success} data-semantic-glow-shadow={successSemanticGlowShadow}>Success</span>
              <span className={`cf-ds-semantic-chip cf-ds-semantic-chip--pending ${semanticSurfaceClass}`} data-rounding={prefs.rounding} data-semantic-glow-color={prefs.semanticColors.pending} data-semantic-glow-shadow={pendingSemanticGlowShadow}>Pending</span>
              <span className={`cf-ds-semantic-chip cf-ds-semantic-chip--new ${semanticSurfaceClass}`} data-rounding={prefs.rounding} data-semantic-glow-color={prefs.semanticColors.new} data-semantic-glow-shadow={newSemanticGlowShadow}>New</span>
            </div>
          </div>
          <div>
            <div className="cf-ds-semantic-grid">
              <label>Error<input type="color" aria-label="error color" value={prefs.semanticColors.error} onChange={(event) => setSemanticColor("error", event.target.value)} /></label>
              <label>Success<input type="color" aria-label="success color" value={prefs.semanticColors.success} onChange={(event) => setSemanticColor("success", event.target.value)} /></label>
              <label>Pending<input type="color" aria-label="pending color" value={prefs.semanticColors.pending} onChange={(event) => setSemanticColor("pending", event.target.value)} /></label>
              <label>New<input type="color" aria-label="new color" value={prefs.semanticColors.new} onChange={(event) => setSemanticColor("new", event.target.value)} /></label>
            </div>
          </div>
        </PairedRow>
      </div>

      <div className="cf-ds-settings-footer">
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
          <button type="button" className="btn-secondary" onClick={() => resetPrefs()}>Reset to defaults</button>
          <button type="button" className="btn-secondary" onClick={() => applySystemDefaults()}>Use System Defaults</button>
        </div>
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
              }}
            >
              Revert Now
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
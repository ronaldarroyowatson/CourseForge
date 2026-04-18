import { appendDebugLogEntry } from "./debugLogService";

export type MotionEasing = "ease-in" | "ease-out" | "ease-in-out";
export type DirectionalFlow = "left-to-right" | "right-to-left";
export type StrokePreset = "common" | "doubling" | "soft" | "ultra-thin" | "sweet-spot";

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
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

export function sanitizeDesignTokenPreferences(input: Partial<DesignTokenPreferences> | null | undefined): DesignTokenPreferences {
  const next = input ?? {};
  const semantic = next.semanticColors ?? DEFAULT_DESIGN_TOKEN_PREFERENCES.semanticColors;

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
  const primary = buildPrimaryScale(preferences.primaryHue, preferences.gamma);
  const typeScale = buildTypeScale(12, preferences.typeRatio);

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
      values: buildSpacingScale(4, preferences.spacingRatio),
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

  const values: Partial<DesignTokenPreferences> = {
    motionTimingMs: detected.prefersReducedMotion === true ? 100 : DEFAULT_DESIGN_TOKEN_PREFERENCES.motionTimingMs,
    gamma: detected.prefersHighContrast === true ? 2.35 : DEFAULT_DESIGN_TOKEN_PREFERENCES.gamma,
    primaryHue: detected.prefersDarkMode === true ? 220 : DEFAULT_DESIGN_TOKEN_PREFERENCES.primaryHue,
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
  if (typeof window === "undefined") {
    return {};
  }

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const prefersHighContrast = window.matchMedia?.("(prefers-contrast: more)").matches;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  return {
    motionTimingMs: prefersReducedMotion ? 100 : DEFAULT_DESIGN_TOKEN_PREFERENCES.motionTimingMs,
    gamma: prefersHighContrast ? 2.35 : DEFAULT_DESIGN_TOKEN_PREFERENCES.gamma,
    primaryHue: prefersDark ? 220 : DEFAULT_DESIGN_TOKEN_PREFERENCES.primaryHue,
  };
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

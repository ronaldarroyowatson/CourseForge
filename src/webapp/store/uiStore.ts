import { create } from "zustand";
import type { Textbook } from "../../core/models";
import {
  applyAuthoritativeSemanticPalette,
} from "../../core/services/designTokenDebugService";
import {
  type DesignTokenPreferences,
  type DesignTokens,
  applyDesignTokensToDocument,
  DEFAULT_DESIGN_TOKEN_PREFERENCES,
  detectSystemDesignDefaults,
  generateDesignTokens,
  initializeDesignTokenPreferencesOnFirstRun,
  logDesignSystemDebugEvent,
  sanitizeDesignTokenPreferences,
  saveLocalDesignTokenPreferences,
} from "../../core/services/designSystemService";

export type ThemeMode = "light" | "dark";
export type SupportedLanguage = "en" | "es" | "pt" | "zm" | "fr" | "de";
export type ColorBlindMode = "protanopia" | "deuteranopia" | "tritanopia" | "none";

export interface AccessibilityPreferences {
  colorBlindMode?: ColorBlindMode;
  dyslexiaMode?: boolean;
  dyscalculiaMode?: boolean;
  highContrastMode?: boolean;
  fontScale?: number;
  uiScale?: number;
}

const THEME_STORAGE_KEY = "courseforge.theme";
const AUTO_RETRIES_STORAGE_KEY = "courseforge.automaticRetriesEnabled";
const LANGUAGE_STORAGE_KEY = "courseforge.language";
const ACCESSIBILITY_STORAGE_KEY = "courseforge.accessibility";

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["en", "es", "pt", "zm", "fr", "de"];

function normalizeLanguageTag(input: string | null | undefined): SupportedLanguage {
  const trimmed = (input ?? "").trim().toLowerCase();
  if (!trimmed) {
    return "en";
  }

  const primary = trimmed.split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(primary as SupportedLanguage)
    ? (primary as SupportedLanguage)
    : "en";
}

function detectInitialLanguage(): SupportedLanguage {
  if (typeof window === "undefined") {
    return "en";
  }

  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (saved) {
    return normalizeLanguageTag(saved);
  }

  const browserPreferred = window.navigator.languages?.[0] ?? window.navigator.language;
  return normalizeLanguageTag(browserPreferred);
}

function getInitialAccessibilityPreferences(): AccessibilityPreferences {
  if (typeof window === "undefined") {
    return {
      colorBlindMode: "none",
      dyslexiaMode: false,
      dyscalculiaMode: false,
      highContrastMode: false,
      fontScale: 1,
      uiScale: 1,
    };
  }

  const raw = window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
  if (!raw) {
    return {
      colorBlindMode: "none",
      dyslexiaMode: false,
      dyscalculiaMode: false,
      highContrastMode: false,
      fontScale: 1,
      uiScale: 1,
    };
  }

  try {
    const parsed = JSON.parse(raw) as AccessibilityPreferences;
    return {
      colorBlindMode: parsed.colorBlindMode ?? "none",
      dyslexiaMode: Boolean(parsed.dyslexiaMode),
      dyscalculiaMode: Boolean(parsed.dyscalculiaMode),
      highContrastMode: Boolean(parsed.highContrastMode),
      fontScale: typeof parsed.fontScale === "number" ? Math.min(1.8, Math.max(0.8, parsed.fontScale)) : 1,
      uiScale: typeof parsed.uiScale === "number" ? Math.min(1.3, Math.max(0.85, parsed.uiScale)) : 1,
    };
  } catch {
    return {
      colorBlindMode: "none",
      dyslexiaMode: false,
      dyscalculiaMode: false,
      highContrastMode: false,
      fontScale: 1,
      uiScale: 1,
    };
  }
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

const initialDesignResolution = initializeDesignTokenPreferencesOnFirstRun();
const initialDesignPreferences = sanitizeDesignTokenPreferences(initialDesignResolution.preferences);
const initialDesignTokens = generateDesignTokens(initialDesignPreferences);

if (typeof document !== "undefined") {
  applyDesignTokensToDocument(initialDesignTokens);
  applyAuthoritativeSemanticPalette();
}

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", theme);
  applyAuthoritativeSemanticPalette();
}

function applyLanguage(language: SupportedLanguage): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.setAttribute("lang", language);
}

function applyAccessibilityPreferences(preferences: AccessibilityPreferences): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.setAttribute("data-colorblind-mode", preferences.colorBlindMode ?? "none");
  root.setAttribute("data-dyslexia-mode", preferences.dyslexiaMode ? "enabled" : "disabled");
  root.setAttribute("data-dyscalculia-mode", preferences.dyscalculiaMode ? "enabled" : "disabled");
  root.setAttribute("data-high-contrast", preferences.highContrastMode ? "enabled" : "disabled");
  root.style.setProperty("--cf-font-scale", String(preferences.fontScale ?? 1));
  root.style.setProperty("--cf-ui-scale", String(preferences.uiScale ?? 1));
}

function getInitialAutomaticRetriesEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const saved = window.localStorage.getItem(AUTO_RETRIES_STORAGE_KEY);
  return saved === "true";
}

/**
 * Global UI store for CourseForge.
 * Manages sync state, selected textbook for editing, and other global UI state.
 */
interface UIStore {
  // Sync state
  isSyncing: boolean;
  syncStatus: "idle" | "syncing" | "synced" | "error";
  syncMessage: string | null;
  lastSyncTime: string | null;
  lastSyncError: string | null;
  lastSyncErrorCode: string | null;
  pendingSyncCount: number;
  pendingChangesCount: number;
  writeCount: number;
  readCount: number;
  retryCount: number;
  writeBudgetLimit: number;
  readBudgetLimit: number;
  retryLimit: number;
  writeBudgetExceeded: boolean;
  readBudgetExceeded: boolean;
  automaticRetriesEnabled: boolean;
  permissionDeniedSyncBlocked: boolean;
  writeLoopBlocked: boolean;
  localChangeVersion: number;
  syncDebugEvents: string[];
  setIsSyncing: (value: boolean) => void;
  setSyncStatus: (status: "idle" | "syncing" | "synced" | "error", message?: string | null) => void;
  setPendingSyncCount: (count: number) => void;
  setLastSyncErrorCode: (code: string | null) => void;
  setWriteCount: (count: number) => void;
  setReadCount: (count: number) => void;
  setRetryCount: (count: number) => void;
  setWriteBudget: (count: number, limit: number, exceeded: boolean) => void;
  setReadBudget: (count: number, limit: number, exceeded: boolean) => void;
  setRetryLimit: (limit: number) => void;
  setAutomaticRetriesEnabled: (enabled: boolean) => void;
  setPermissionDeniedSyncBlocked: (value: boolean) => void;
  setWriteLoopBlocked: (value: boolean) => void;
  markLocalChange: () => void;
  addSyncDebugEvent: (event: string) => void;

  // Theme state
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
  accessibility: AccessibilityPreferences;
  setAccessibility: (next: AccessibilityPreferences) => void;
  patchAccessibility: (partial: Partial<AccessibilityPreferences>) => void;
  designTokenPreferences: DesignTokenPreferences;
  designTokens: DesignTokens;
  setDesignTokenPreferences: (next: Partial<DesignTokenPreferences>) => void;
  resetDesignTokenPreferences: () => void;
  applySystemDesignTokenDefaults: () => void;

  // Selected textbook for editing
  selectedTextbookId: string | null;
  selectedTextbook: Textbook | null;
  setSelectedTextbook: (textbook: Textbook | null) => void;

  // Helpers
  clearSync: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  // Sync state defaults
  isSyncing: false,
  syncStatus: "idle",
  syncMessage: null,
  lastSyncTime: null,
  lastSyncError: null,
  lastSyncErrorCode: null,
  pendingSyncCount: 0,
  pendingChangesCount: 0,
  writeCount: 0,
  readCount: 0,
  retryCount: 0,
  writeBudgetLimit: 500,
  readBudgetLimit: 5000,
  retryLimit: 3,
  writeBudgetExceeded: false,
  readBudgetExceeded: false,
  automaticRetriesEnabled: getInitialAutomaticRetriesEnabled(),
  permissionDeniedSyncBlocked: false,
  writeLoopBlocked: false,
  localChangeVersion: 0,
  syncDebugEvents: [],
  setIsSyncing: (value: boolean) =>
    set((state) => ({
      isSyncing: value,
      syncStatus: value ? "syncing" : state.syncStatus,
    })),
  setSyncStatus: (status: "idle" | "syncing" | "synced" | "error", message: string | null = null) =>
    set((state) => {
      const nextSyncEvents =
        status === "error" && message
          ? [`[${new Date().toISOString()}] sync:error - ${message}`, ...state.syncDebugEvents].slice(0, 40)
          : state.syncDebugEvents;

      return {
        syncStatus: status,
        syncMessage: message,
        isSyncing: status === "syncing",
        lastSyncTime: status === "synced" ? new Date().toISOString() : state.lastSyncTime,
        lastSyncError: status === "error" ? message : status === "synced" ? null : state.lastSyncError,
        lastSyncErrorCode: status === "synced" ? null : state.lastSyncErrorCode,
        syncDebugEvents: nextSyncEvents,
      };
    }),
  setPendingSyncCount: (count: number) => set({ pendingSyncCount: count, pendingChangesCount: count }),
  setLastSyncErrorCode: (code: string | null) => set({ lastSyncErrorCode: code }),
  setWriteCount: (count: number) => set({ writeCount: count }),
  setReadCount: (count: number) => set({ readCount: count }),
  setRetryCount: (count: number) => set({ retryCount: count }),
  setWriteBudget: (count: number, limit: number, exceeded: boolean) =>
    set({
      writeCount: count,
      writeBudgetLimit: limit,
      writeBudgetExceeded: exceeded,
    }),
  setReadBudget: (count: number, limit: number, exceeded: boolean) =>
    set({
      readCount: count,
      readBudgetLimit: limit,
      readBudgetExceeded: exceeded,
    }),
  setRetryLimit: (limit: number) => set({ retryLimit: limit }),
  setAutomaticRetriesEnabled: (enabled: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTO_RETRIES_STORAGE_KEY, String(enabled));
    }
    set({ automaticRetriesEnabled: enabled });
  },
  setPermissionDeniedSyncBlocked: (value: boolean) => set({ permissionDeniedSyncBlocked: value }),
  setWriteLoopBlocked: (value: boolean) => set({ writeLoopBlocked: value }),
  markLocalChange: () =>
    set((state) => ({
      localChangeVersion: state.localChangeVersion + 1,
      pendingSyncCount: state.pendingSyncCount + 1,
      pendingChangesCount: state.pendingChangesCount + 1,
    })),
  addSyncDebugEvent: (event: string) =>
    set((state) => ({
      syncDebugEvents: [`[${new Date().toISOString()}] ${event}`, ...state.syncDebugEvents].slice(0, 40),
    })),

  // Theme defaults and actions
  theme: getInitialTheme(),
  setTheme: (theme: ThemeMode) =>
    set(() => {
      applyTheme(theme);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      }
      return { theme };
    }),
  toggleTheme: () =>
    set((state) => {
      const nextTheme: ThemeMode = state.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }
      return { theme: nextTheme };
    }),
  designTokenPreferences: initialDesignPreferences,
  designTokens: initialDesignTokens,
  setDesignTokenPreferences: (next: Partial<DesignTokenPreferences>) =>
    set((state) => {
      const merged = sanitizeDesignTokenPreferences({
        ...state.designTokenPreferences,
        ...next,
      });
      const generated = generateDesignTokens(merged);
      applyDesignTokensToDocument(generated);
      saveLocalDesignTokenPreferences(merged);
      void logDesignSystemDebugEvent("Design tokens updated.", {
        gamma: merged.gamma,
        typeRatio: merged.typeRatio,
        spacingRatio: merged.spacingRatio,
        strokePreset: merged.strokePreset,
        motionTimingMs: merged.motionTimingMs,
      });
      return {
        designTokenPreferences: merged,
        designTokens: generated,
      };
    }),
  resetDesignTokenPreferences: () =>
    set(() => {
      const next = sanitizeDesignTokenPreferences(DEFAULT_DESIGN_TOKEN_PREFERENCES);
      const generated = generateDesignTokens(next);
      applyDesignTokensToDocument(generated);
      saveLocalDesignTokenPreferences(next);
      void logDesignSystemDebugEvent("Design tokens reset to defaults.");
      return {
        designTokenPreferences: next,
        designTokens: generated,
      };
    }),
  applySystemDesignTokenDefaults: () =>
    set((state) => {
      const systemDefaults = detectSystemDesignDefaults();
      const next = sanitizeDesignTokenPreferences({
        ...state.designTokenPreferences,
        ...systemDefaults,
        useSystemDefaults: true,
      });
      const generated = generateDesignTokens(next);
      applyDesignTokensToDocument(generated);
      saveLocalDesignTokenPreferences(next);
      void logDesignSystemDebugEvent("System defaults applied to design tokens.", systemDefaults as Record<string, unknown>);
      return {
        designTokenPreferences: next,
        designTokens: generated,
      };
    }),
  language: detectInitialLanguage(),
  setLanguage: (language: SupportedLanguage) => {
    const normalized = normalizeLanguageTag(language);
    applyLanguage(normalized);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    }
    set({ language: normalized });
  },
  accessibility: getInitialAccessibilityPreferences(),
  setAccessibility: (next: AccessibilityPreferences) => {
    const normalized: AccessibilityPreferences = {
      colorBlindMode: next.colorBlindMode ?? "none",
      dyslexiaMode: Boolean(next.dyslexiaMode),
      dyscalculiaMode: Boolean(next.dyscalculiaMode),
      highContrastMode: Boolean(next.highContrastMode),
      fontScale: typeof next.fontScale === "number" ? Math.min(1.8, Math.max(0.8, next.fontScale)) : 1,
      uiScale: typeof next.uiScale === "number" ? Math.min(1.3, Math.max(0.85, next.uiScale)) : 1,
    };
    applyAccessibilityPreferences(normalized);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(normalized));
    }
    set({ accessibility: normalized });
  },
  patchAccessibility: (partial: Partial<AccessibilityPreferences>) =>
    set((state) => {
      const next: AccessibilityPreferences = {
        ...state.accessibility,
        ...partial,
      };
      applyAccessibilityPreferences(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(next));
      }
      return { accessibility: next };
    }),

  // Selected textbook defaults
  selectedTextbookId: null,
  selectedTextbook: null,
  setSelectedTextbook: (textbook: Textbook | null) =>
    set({
      selectedTextbook: textbook,
      selectedTextbookId: textbook?.id ?? null,
    }),

  // Helpers
  clearSync: () =>
    set({
      syncStatus: "idle",
      syncMessage: null,
      isSyncing: false,
      lastSyncError: null,
      lastSyncErrorCode: null,
      pendingSyncCount: 0,
      pendingChangesCount: 0,
      retryCount: 0,
      permissionDeniedSyncBlocked: false,
      writeLoopBlocked: false,
      syncDebugEvents: [],
    }),
}));

// Ensure startup render uses the stored theme even before any user interaction.
applyTheme(getInitialTheme());
applyLanguage(detectInitialLanguage());
applyAccessibilityPreferences(getInitialAccessibilityPreferences());

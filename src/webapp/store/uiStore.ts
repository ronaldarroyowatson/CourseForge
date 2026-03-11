import { create } from "zustand";
import type { Textbook } from "../../core/models";

export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "courseforge.theme";
const AUTO_RETRIES_STORAGE_KEY = "courseforge.automaticRetriesEnabled";

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "dark" || savedTheme === "light") {
    return savedTheme;
  }

  return "light";
}

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", theme);
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
  retryCount: number;
  writeBudgetLimit: number;
  retryLimit: number;
  writeBudgetExceeded: boolean;
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
  setRetryCount: (count: number) => void;
  setWriteBudget: (count: number, limit: number, exceeded: boolean) => void;
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
  retryCount: 0,
  writeBudgetLimit: 500,
  retryLimit: 3,
  writeBudgetExceeded: false,
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
  setRetryCount: (count: number) => set({ retryCount: count }),
  setWriteBudget: (count: number, limit: number, exceeded: boolean) =>
    set({
      writeCount: count,
      writeBudgetLimit: limit,
      writeBudgetExceeded: exceeded,
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
  setTheme: (theme: ThemeMode) => {
    applyTheme(theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
    set({ theme });
  },
  toggleTheme: () =>
    set((state) => {
      const nextTheme: ThemeMode = state.theme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      }
      return { theme: nextTheme };
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

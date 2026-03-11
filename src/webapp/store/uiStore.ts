import { create } from "zustand";
import type { Textbook } from "../../core/models";

/**
 * Global UI store for CourseForge.
 * Manages sync state, selected textbook for editing, and other global UI state.
 */
interface UIStore {
  // Sync state
  isSyncing: boolean;
  syncStatus: "idle" | "syncing" | "synced" | "error";
  syncMessage: string | null;
  setIsSyncing: (value: boolean) => void;
  setSyncStatus: (status: "idle" | "syncing" | "synced" | "error", message?: string | null) => void;

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
  setIsSyncing: (value: boolean) =>
    set((state) => ({
      isSyncing: value,
      syncStatus: value ? "syncing" : state.syncStatus,
    })),
  setSyncStatus: (status: "idle" | "syncing" | "synced" | "error", message: string | null = null) =>
    set({
      syncStatus: status,
      syncMessage: message,
      isSyncing: status === "syncing",
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
    }),
}));

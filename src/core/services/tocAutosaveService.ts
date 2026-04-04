import type { ParsedTocResult } from "./textbookAutoExtractionService";
import { initDB, STORE_NAMES } from "./db";
import type { TocAutosaveRecord } from "../models";

// Toast/debug event types for autosave notifications
export interface AutosaveEvent {
  type: "autosave_started" | "autosave_completed" | "autosave_failed" | "autosave_restored";
  timestamp: string;
  message?: string;
}

const AUTOSAVE_DEBOUNCE_MS = 1500;

let autosaveTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize autosave: ensure IndexedDB store exists
 */
export async function initializeTocAutosave(): Promise<void> {
  // Store is created during DB initialization;
  // this is a safety function for future compatibility
  await initDB();
}

/**
 * Autosave TOC changes with debounce
 * Intended to be called frequently during user edits
 */
export async function autosaveToc(
  sessionId: string,
  draftId: string,
  tocResult: ParsedTocResult,
  tocPages: any[]
): Promise<void> {
  // Clear any pending autosave
  if (autosaveTimeout) {
    clearTimeout(autosaveTimeout);
  }

  // Schedule new autosave after debounce delay
  autosaveTimeout = setTimeout(async () => {
    try {
      const db = await initDB();
      const data: TocAutosaveRecord = {
        id: `toc-autosave-${sessionId}`,
        draftId,
        tocResult,
        tocPages,
        lastSavedAt: new Date().toISOString(),
        sessionId,
      };

      // Write to IndexedDB
      await db.put(STORE_NAMES.tocAutosaves, data);

      // Emit debug event
      emitAutosaveEvent({
        type: "autosave_completed",
        timestamp: new Date().toISOString(),
        message: `TOC autosaved for session ${sessionId} (${tocResult.units?.length ?? 0} units, ${tocResult.chapters.length} chapters)`,
      });
    } catch (error) {
      console.error("[TOC Autosave] Failed to autosave:", error);
      emitAutosaveEvent({
        type: "autosave_failed",
        timestamp: new Date().toISOString(),
        message: `TOC autosave failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Restore a saved TOC autosave by session ID
 */
export async function restoreTocAutosave(sessionId: string): Promise<TocAutosaveRecord | null> {
  try {
    const db = await initDB();
    const result = await db.get(STORE_NAMES.tocAutosaves, `toc-autosave-${sessionId}`);

    if (result) {
      emitAutosaveEvent({
        type: "autosave_restored",
        timestamp: new Date().toISOString(),
        message: `TOC restored from autosave (saved at ${result.lastSavedAt})`,
      });
      return result;
    }

    return null;
  } catch (error) {
    console.error("[TOC Autosave] Failed to restore autosave:", error);
    return null;
  }
}

/**
 * Clear TOC autosave for a session (e.g., after successful upload)
 */
export async function clearTocAutosave(sessionId: string): Promise<void> {
  try {
    const db = await initDB();
    await db.delete(STORE_NAMES.tocAutosaves, `toc-autosave-${sessionId}`);
  } catch (error) {
    console.error("[TOC Autosave] Failed to clear autosave:", error);
  }
}

/**
 * List all saved TOC autosaves (for debugging or recovery UI)
 */
export async function listTocAutosaves(): Promise<TocAutosaveRecord[]> {
  try {
    const db = await initDB();
    const results = await db.getAll(STORE_NAMES.tocAutosaves);
    return results.sort((a, b) => 
      new Date(b.lastSavedAt).getTime() - new Date(a.lastSavedAt).getTime()
    );
  } catch (error) {
    console.error("[TOC Autosave] Failed to list autosaves:", error);
    return [];
  }
}

/**
 * Clear all TOC autosaves (useful for "Delete All" functionality)
 */
export async function clearAllTocAutosaves(): Promise<void> {
  try {
    const db = await initDB();
    const allAutosaves = await db.getAll(STORE_NAMES.tocAutosaves);
    for (const record of allAutosaves) {
      await db.delete(STORE_NAMES.tocAutosaves, record.id);
    }
  } catch (error) {
    console.error("[TOC Autosave] Failed to clear all autosaves:", error);
  }
}

/**
 * Emit autosave event for UI notifications and debug logs
 */
function emitAutosaveEvent(event: AutosaveEvent): void {
  // Emit to debug service if available
  if (typeof window !== "undefined" && window.dispatchEvent) {
    window.dispatchEvent(
      new CustomEvent("toc:autosave", {
        detail: event,
      })
    );
  }
  
  // Also log for debugging
  const prefix = event.type === "autosave_failed" ? "❌" : "✓";
  console.log(`[TOC Autosave] ${prefix} ${event.message}`);
}

/**
 * Cancel any pending autosave (useful on unmount or explicit cancel)
 */
export function cancelPendingAutosave(): void {
  if (autosaveTimeout) {
    clearTimeout(autosaveTimeout);
    autosaveTimeout = null;
  }
}

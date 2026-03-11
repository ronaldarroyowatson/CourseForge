import React from "react";

import { syncNow } from "../../core/services/syncService";
import { useAuthStore } from "../store/authStore";
import { useUIStore } from "../store/uiStore";

const AUTO_SYNC_INTERVAL_MS = 17000;
const NETWORK_RETRY_MS = 5000;
const RETRIES_STOPPED_MESSAGE = "Automatic retries stopped due to repeated failures.";
const WRITE_BUDGET_WARNING = "Cloud sync paused to prevent excessive writes. Please review your data or try again later.";

function shouldSkipAutoSyncRun(): boolean {
  const ui = useUIStore.getState();

  if (ui.isSyncing || ui.permissionDeniedSyncBlocked || ui.writeLoopBlocked || ui.writeBudgetExceeded) {
    return true;
  }

  if (!ui.automaticRetriesEnabled && ui.syncStatus === "error") {
    return true;
  }

  if (ui.lastSyncErrorCode === "permission-denied") {
    return true;
  }

  return false;
}

function applySyncMetrics(result: {
  pendingCount: number;
  writeCount: number;
  writeBudgetLimit: number;
  writeBudgetExceeded: boolean;
  retryLimit: number;
  errorCode: string | null;
}): void {
  const ui = useUIStore.getState();
  ui.setPendingSyncCount(result.pendingCount);
  ui.setWriteBudget(result.writeCount, result.writeBudgetLimit, result.writeBudgetExceeded);
  ui.setRetryLimit(result.retryLimit);
  ui.setLastSyncErrorCode(result.errorCode);
}

/**
 * Handles periodic/background sync behavior for authenticated sessions.
 * Retry policy:
 * - network errors: retry once after 5s
 * - permission errors: surface warning and stop retrying
 */
export function useAutoSync(): void {
  const authStatus = useAuthStore((state) => state.authStatus);
  const localChangeVersion = useUIStore((state) => state.localChangeVersion);

  React.useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    let isActive = true;
    let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

    async function runSync(trigger: string, retryCount = 0): Promise<void> {
      if (!isActive) {
        return;
      }

      if (shouldSkipAutoSyncRun()) {
        return;
      }

      const ui = useUIStore.getState();
      ui.setSyncStatus("syncing", `Syncing (${trigger})...`);
      if (import.meta.env.DEV) {
        ui.addSyncDebugEvent(`sync:trigger - ${trigger}`);
      }

      try {
        const result = await syncNow();
        if (!isActive) {
          return;
        }

        applySyncMetrics(result);

        if (result.throttled) {
          ui.addSyncDebugEvent("sync:throttled - skipped attempt");
          ui.setSyncStatus("idle", result.message);
          return;
        }

        if (result.writeLoopTriggered) {
          ui.setWriteLoopBlocked(true);
          ui.setSyncStatus("error", "Sync paused due to write-loop protection.");
          return;
        }

        if (result.writeBudgetExceeded) {
          ui.setAutomaticRetriesEnabled(false);
          ui.setSyncStatus("error", WRITE_BUDGET_WARNING);
          return;
        }

        if (result.success) {
          ui.setWriteLoopBlocked(false);
          ui.setPermissionDeniedSyncBlocked(false);
          ui.setRetryCount(0);
          ui.setLastSyncErrorCode(null);
          ui.setSyncStatus("synced", "Synced successfully.");
          return;
        }

        ui.setSyncStatus("error", result.message);

        if (result.permissionDenied) {
          ui.setPermissionDeniedSyncBlocked(true);
          ui.addSyncDebugEvent("sync:stopped - permission denied");
          return;
        }

        if (result.retryable) {
          if (!ui.automaticRetriesEnabled) {
            ui.setRetryCount(0);
            return;
          }

          // Cap automatic network retries so transient failures cannot loop forever.
          const nextRetryCount = retryCount + 1;
          ui.setRetryCount(nextRetryCount);

          if (nextRetryCount > result.retryLimit) {
            ui.addSyncDebugEvent("sync:retry-stopped - retry limit exceeded");
            ui.setSyncStatus("error", RETRIES_STOPPED_MESSAGE);
            return;
          }

          ui.addSyncDebugEvent("sync:retry - scheduling network retry");
          retryTimeoutId = setTimeout(() => {
            void runSync("retry", nextRetryCount);
          }, NETWORK_RETRY_MS);
          return;
        }

        ui.setRetryCount(0);
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error ? error.message : "Unexpected sync error.";
        ui.setSyncStatus("error", message);
      }
    }

    const intervalId = setInterval(() => {
      void runSync("interval");
    }, AUTO_SYNC_INTERVAL_MS);

    const handleOnline = (): void => {
      void runSync("online");
    };

    window.addEventListener("online", handleOnline);

    // Run at startup for authenticated users.
    void runSync("startup");

    return () => {
      isActive = false;
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId);
      }
      clearInterval(intervalId);
      window.removeEventListener("online", handleOnline);
    };
  }, [authStatus]);

  React.useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    if (shouldSkipAutoSyncRun()) {
      return;
    }

    // Local edits trigger immediate autosync.
    void (async () => {
      const ui = useUIStore.getState();

      ui.setSyncStatus("syncing", "Syncing local changes...");
      const result = await syncNow();
      applySyncMetrics(result);

      if (result.throttled) {
        ui.setSyncStatus("idle", result.message);
        return;
      }

      if (result.writeLoopTriggered) {
        ui.setWriteLoopBlocked(true);
        ui.setSyncStatus("error", "Sync paused due to write-loop protection.");
        return;
      }

      if (result.writeBudgetExceeded) {
        ui.setAutomaticRetriesEnabled(false);
        ui.setSyncStatus("error", WRITE_BUDGET_WARNING);
        return;
      }

      if (result.success) {
        ui.setWriteLoopBlocked(false);
        ui.setPermissionDeniedSyncBlocked(false);
        ui.setRetryCount(0);
        ui.setLastSyncErrorCode(null);
        ui.setSyncStatus("synced", "Local changes synced.");
        return;
      }

      if (result.permissionDenied) {
        ui.setPermissionDeniedSyncBlocked(true);
      }

      if (result.retryable && !ui.automaticRetriesEnabled) {
        ui.setSyncStatus("error", `${result.message} Automatic retries are disabled.`);
        return;
      }

      ui.setSyncStatus("error", result.message);
    })();
  }, [authStatus, localChangeVersion]);
}

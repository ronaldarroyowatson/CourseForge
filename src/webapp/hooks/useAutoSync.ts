import React from "react";

import { syncNow } from "../../core/services/syncService";
import { useAuthStore } from "../store/authStore";
import { useUIStore } from "../store/uiStore";

const AUTO_SYNC_INTERVAL_MS = 15000;
const NETWORK_RETRY_MS = 5000;

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

    async function runSync(trigger: string): Promise<void> {
      if (!isActive) {
        return;
      }

      const ui = useUIStore.getState();

      // Safety guards to avoid runaway sync/write loops.
      if (ui.isSyncing) {
        return;
      }

      if (ui.permissionDeniedSyncBlocked) {
        return;
      }

      if (ui.writeLoopBlocked) {
        return;
      }

      ui.setSyncStatus("syncing", `Syncing (${trigger})...`);
      if (import.meta.env.DEV) {
        ui.addSyncDebugEvent(`sync:trigger - ${trigger}`);
      }

      try {
        const result = await syncNow();
        if (!isActive) {
          return;
        }

        ui.setPendingSyncCount(result.pendingCount);

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

        if (result.success) {
          ui.setWriteLoopBlocked(false);
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
          ui.addSyncDebugEvent("sync:retry - scheduling network retry");
          retryTimeoutId = setTimeout(() => {
            void runSync("retry");
          }, NETWORK_RETRY_MS);
        }
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

    // Local edits trigger immediate autosync.
    void (async () => {
      const ui = useUIStore.getState();

      if (ui.isSyncing || ui.permissionDeniedSyncBlocked || ui.writeLoopBlocked) {
        return;
      }

      ui.setSyncStatus("syncing", "Syncing local changes...");
      const result = await syncNow();
      ui.setPendingSyncCount(result.pendingCount);

      if (result.throttled) {
        ui.setSyncStatus("idle", result.message);
        return;
      }

      if (result.writeLoopTriggered) {
        ui.setWriteLoopBlocked(true);
        ui.setSyncStatus("error", "Sync paused due to write-loop protection.");
        return;
      }

      if (result.success) {
        ui.setWriteLoopBlocked(false);
        ui.setSyncStatus("synced", "Local changes synced.");
        return;
      }

      if (result.permissionDenied) {
        ui.setPermissionDeniedSyncBlocked(true);
      }

      ui.setSyncStatus("error", result.message);
    })();
  }, [authStatus, localChangeVersion]);
}

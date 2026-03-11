import React from "react";
import { doc, setDoc } from "firebase/firestore";
import { syncNow } from "../../../core/services/syncService";
import { firestoreDb } from "../../../firebase/firestore";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";

/**
 * Header keeps product identity and a short phase status line.
 */
export function Header(): React.JSX.Element {
  const userId = useAuthStore((state) => state.userId);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const isSyncing = useUIStore((state) => state.isSyncing);
  const syncStatus = useUIStore((state) => state.syncStatus);
  const syncMessage = useUIStore((state) => state.syncMessage);
  const lastSyncTime = useUIStore((state) => state.lastSyncTime);
  const lastSyncError = useUIStore((state) => state.lastSyncError);
  const pendingChangesCount = useUIStore((state) => state.pendingChangesCount);
  const permissionDeniedSyncBlocked = useUIStore((state) => state.permissionDeniedSyncBlocked);
  const writeLoopBlocked = useUIStore((state) => state.writeLoopBlocked);
  const theme = useUIStore((state) => state.theme);
  const toggleTheme = useUIStore((state) => state.toggleTheme);
  const setSyncStatus = useUIStore((state) => state.setSyncStatus);
  const setPendingSyncCount = useUIStore((state) => state.setPendingSyncCount);
  const syncDebugEvents = useUIStore((state) => state.syncDebugEvents);

  const [showDebugPanel, setShowDebugPanel] = React.useState(false);

  async function handleSyncNow(): Promise<void> {
    setSyncStatus("syncing", "Manual sync in progress...");

    try {
      const result = await syncNow();
      setPendingSyncCount(result.pendingCount);

      if (result.throttled) {
        setSyncStatus("idle", result.message);
        return;
      }

      if (result.writeLoopTriggered) {
        useUIStore.getState().setWriteLoopBlocked(true);
        setSyncStatus("error", "Sync paused due to write-loop protection.");
        return;
      }

      if (result.success) {
        setSyncStatus("synced", "Manual sync completed.");
        return;
      }

      setSyncStatus("error", result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected sync error.";
      setSyncStatus("error", message);
    }
  }

  async function handleThemeToggle(): Promise<void> {
    toggleTheme();

    if (!userId) {
      return;
    }

    try {
      const nextTheme = useUIStore.getState().theme;
      await setDoc(
        doc(firestoreDb, "users", userId),
        { theme: nextTheme },
        { merge: true }
      );
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Unable to persist theme preference:", error);
      }
    }
  }

  function getStatusLabel(): string {
    if (isSyncing || syncStatus === "syncing") {
      return "Syncing...";
    }

    if (syncStatus === "error") {
      return `Sync failed: ${syncMessage ?? lastSyncError ?? "Unknown error"}`;
    }

    if (permissionDeniedSyncBlocked) {
      return "Sync paused: permission denied. Update Firestore rules and retry.";
    }

    if (writeLoopBlocked) {
      return "Sync paused: write-loop protection triggered.";
    }

    if (pendingChangesCount > 0) {
      return `Pending changes (${pendingChangesCount})`;
    }

    if (lastSyncTime) {
      return `Synced at ${new Date(lastSyncTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }

    return "Sync idle";
  }

  return (
    <header className="app-header">
      <div className="app-header__main">
        <div>
          <h1>CourseForge</h1>
          <p>Teacher-guided curriculum builder</p>
        </div>

        <div className="app-header__actions">
          <button type="button" onClick={() => { void handleSyncNow(); }} disabled={isSyncing}>
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => { void handleThemeToggle(); }}>
            Theme: {theme === "dark" ? "Dark" : "Light"}
          </button>
        </div>
      </div>

      <p className="sync-indicator">{getStatusLabel()}</p>

      {import.meta.env.DEV ? (
        <section className="debug-panel">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowDebugPanel((current) => !current)}
          >
            {showDebugPanel ? "Hide Debug Panel" : "Show Debug Panel"}
          </button>

          {showDebugPanel ? (
            <div className="debug-panel__content">
              <p><strong>User UID:</strong> {userId ?? "n/a"}</p>
              <p><strong>Admin Claim:</strong> {isAdmin ? "true" : "false"}</p>
              <p><strong>Pending Sync Items:</strong> {pendingChangesCount}</p>
              <p><strong>Last Sync Error:</strong> {lastSyncError ?? "none"}</p>
              <p><strong>Last Sync Time:</strong> {lastSyncTime ?? "never"}</p>
              <div>
                <strong>Recent Sync Paths:</strong>
                <ul className="debug-panel__events">
                  {syncDebugEvents.slice(0, 10).map((event) => (
                    <li key={event}>{event}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </header>
  );
}

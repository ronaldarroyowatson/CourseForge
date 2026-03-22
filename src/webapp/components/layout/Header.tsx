import React from "react";
import { useNavigate } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import { syncNow } from "../../../core/services/syncService";
import { firestoreDb } from "../../../firebase/firestore";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";

/**
 * Header keeps product identity and a short phase status line.
 */
export function Header({ isSettingsView = false }: { isSettingsView?: boolean }): React.JSX.Element {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.userId);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const theme = useUIStore((state) => state.theme);
  const toggleTheme = useUIStore((state) => state.toggleTheme);
  const isSyncing = useUIStore((state) => state.isSyncing);
  const syncStatus = useUIStore((state) => state.syncStatus);
  const syncMessage = useUIStore((state) => state.syncMessage);
  const lastSyncTime = useUIStore((state) => state.lastSyncTime);
  const lastSyncError = useUIStore((state) => state.lastSyncError);
  const lastSyncErrorCode = useUIStore((state) => state.lastSyncErrorCode);
  const pendingChangesCount = useUIStore((state) => state.pendingChangesCount);
  const writeCount = useUIStore((state) => state.writeCount);
  const writeBudgetLimit = useUIStore((state) => state.writeBudgetLimit);
  const writeBudgetExceeded = useUIStore((state) => state.writeBudgetExceeded);
  const retryCount = useUIStore((state) => state.retryCount);
  const retryLimit = useUIStore((state) => state.retryLimit);
  const permissionDeniedSyncBlocked = useUIStore((state) => state.permissionDeniedSyncBlocked);
  const writeLoopBlocked = useUIStore((state) => state.writeLoopBlocked);
  const setSyncStatus = useUIStore((state) => state.setSyncStatus);
  const setPendingSyncCount = useUIStore((state) => state.setPendingSyncCount);
  const setWriteBudget = useUIStore((state) => state.setWriteBudget);
  const setRetryLimit = useUIStore((state) => state.setRetryLimit);
  const setLastSyncErrorCode = useUIStore((state) => state.setLastSyncErrorCode);
  const setRetryCount = useUIStore((state) => state.setRetryCount);
  const setPermissionDeniedSyncBlocked = useUIStore((state) => state.setPermissionDeniedSyncBlocked);
  const setWriteLoopBlocked = useUIStore((state) => state.setWriteLoopBlocked);
  const syncDebugEvents = useUIStore((state) => state.syncDebugEvents);

  const [showDebugPanel, setShowDebugPanel] = React.useState(false);

  async function handleSyncNow(): Promise<void> {
    setSyncStatus("syncing", "Manual sync in progress...");

    try {
      const result = await syncNow();
      setPendingSyncCount(result.pendingCount);
      setWriteBudget(result.writeCount, result.writeBudgetLimit, result.writeBudgetExceeded);
      setRetryLimit(result.retryLimit);
      setLastSyncErrorCode(result.errorCode);

      if (result.throttled) {
        setSyncStatus("idle", result.message);
        return;
      }

      if (result.writeLoopTriggered) {
        setWriteLoopBlocked(true);
        setSyncStatus("error", "Sync paused due to write-loop protection.");
        return;
      }

      if (result.writeBudgetExceeded) {
        setSyncStatus("error", "Cloud sync paused to prevent excessive writes. Please review your data or try again later.");
        return;
      }

      if (result.success) {
        setPermissionDeniedSyncBlocked(false);
        setWriteLoopBlocked(false);
        setRetryCount(0);
        setLastSyncErrorCode(null);
        setSyncStatus("synced", "Manual sync completed.");
        return;
      }

      if (result.permissionDenied) {
        setPermissionDeniedSyncBlocked(true);
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
      await setDoc(doc(firestoreDb, "users", userId), { theme: nextTheme }, { merge: true });
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

    if (writeBudgetExceeded) {
      return "Cloud sync paused to prevent excessive writes. Please review your data or try again later.";
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
        <div className="app-header__left">
          {isSettingsView ? (
            <button
              type="button"
              className="app-nav-button app-nav-button--workspace"
              onClick={() => {
                navigate("/textbooks");
              }}
            >
              <span className="app-nav-button__arrow" aria-hidden="true">&lt;</span>
              Workspace
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary app-nav-button"
              onClick={() => {
                navigate("/settings");
              }}
            >
              Settings
            </button>
          )}

          <div>
            <h1>CourseForge</h1>
            <p>Teacher-guided curriculum builder</p>
          </div>
        </div>

        <div className="app-header__right">
          <button
            type="button"
            className={`theme-toggle ${theme === "light" ? "theme-toggle--light" : "theme-toggle--dark"}`}
            onClick={() => {
              void handleThemeToggle();
            }}
            aria-label="Toggle theme"
          >
            <span className="theme-toggle__label">{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
            <span className="theme-toggle__track" aria-hidden="true">
              <span className="theme-toggle__thumb" />
            </span>
          </button>

          <div className="sync-cluster">
            <button
              type="button"
              className="sync-now-button"
              onClick={() => {
                void handleSyncNow();
              }}
              disabled={isSyncing}
            >
              <span className={`sync-now-button__icon ${isSyncing ? "sync-now-button__icon--spinning" : ""}`} aria-hidden="true">↻</span>
              <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
            </button>
            <p className={`sync-indicator ${syncStatus === "synced" ? "sync-indicator--synced" : ""}`}>{getStatusLabel()}</p>
          </div>
        </div>
      </div>
      {writeBudgetExceeded ? (
        <p className="error-text sync-indicator">Cloud sync paused to prevent excessive writes. Please review your data or try again later.</p>
      ) : null}

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
              <p><strong>Sync Status:</strong> {syncStatus}</p>
              <p><strong>Sync Message:</strong> {syncMessage ?? "none"}</p>
              <p><strong>Pending Sync Items:</strong> {pendingChangesCount}</p>
              <p><strong>Write Count:</strong> {writeCount}</p>
              <p><strong>Write Budget:</strong> {writeBudgetLimit}</p>
              <p><strong>Retry Count:</strong> {retryCount}</p>
              <p><strong>Retry Limit:</strong> {retryLimit}</p>
              <p><strong>Last Sync Error:</strong> {lastSyncError ?? "none"}</p>
              <p><strong>Last Sync Error Code:</strong> {lastSyncErrorCode ?? "none"}</p>
              <p><strong>Permission Denied Sync Blocked:</strong> {permissionDeniedSyncBlocked ? "true" : "false"}</p>
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

import React from "react";
import { useNavigate } from "react-router-dom";
import { doc, setDoc } from "firebase/firestore";
import {
  clearPersistedAutoTextbookUpload,
  hydratePersistedAutoTextbookUpload,
  resumePersistedAutoTextbookUpload,
} from "../../../core/services/autoTextbookUploadService";
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
  const setReadBudget = useUIStore((state) => state.setReadBudget);
  const setRetryLimit = useUIStore((state) => state.setRetryLimit);
  const setLastSyncErrorCode = useUIStore((state) => state.setLastSyncErrorCode);
  const setRetryCount = useUIStore((state) => state.setRetryCount);
  const setPermissionDeniedSyncBlocked = useUIStore((state) => state.setPermissionDeniedSyncBlocked);
  const setWriteLoopBlocked = useUIStore((state) => state.setWriteLoopBlocked);
  const syncDebugEvents = useUIStore((state) => state.syncDebugEvents);
  const activeAutoTextbookUpload = useUIStore((state) => state.activeAutoTextbookUpload);

  const [showDebugPanel, setShowDebugPanel] = React.useState(false);

  React.useEffect(() => {
    hydratePersistedAutoTextbookUpload();
  }, []);

  async function handleSyncNow(): Promise<void> {
    setSyncStatus("syncing", "Manual sync in progress...");

    try {
      const result = await syncNow();
      setPendingSyncCount(result.pendingCount);
      setWriteBudget(result.writeCount, result.writeBudgetLimit, result.writeBudgetExceeded);
      setReadBudget(result.readCount, result.readBudgetLimit, result.readBudgetExceeded);
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

  async function handleResumeUpload(): Promise<void> {
    try {
      await resumePersistedAutoTextbookUpload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to resume textbook upload.";
      setSyncStatus("error", message);
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
          ) : null}

          <div>
            <h1>CourseForge</h1>
            <p>Teacher-guided curriculum builder</p>
          </div>
        </div>

        <div className="app-header__right">
          <div className="app-header__controls">
            {!isSettingsView ? (
              <button
                type="button"
                className="app-gear-button"
                onClick={() => { navigate("/settings"); }}
                aria-label="Open settings"
                title="Settings"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                  className="app-gear-button__icon"
                >
                  <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z" />
                </svg>
              </button>
            ) : null}
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
          </div>
          <div className="sync-cluster">
            <p className={`sync-indicator ${syncStatus === "synced" ? "sync-indicator--synced" : ""}`}>{getStatusLabel()}</p>
          </div>
        </div>
      </div>
      {activeAutoTextbookUpload ? (
        <section className="header-upload-monitor" aria-live="polite">
          <div className="header-upload-monitor__meta">
            <strong>{activeAutoTextbookUpload.title || "Untitled textbook"}</strong>
            <p className="sync-indicator">{activeAutoTextbookUpload.message}</p>
          </div>
          <div className="header-upload-monitor__progress">
            <progress max={100} value={activeAutoTextbookUpload.percentComplete} aria-label="Auto textbook upload progress" />
            <p className="sync-indicator">
              {activeAutoTextbookUpload.percentComplete}% complete · {activeAutoTextbookUpload.completedItems}/{activeAutoTextbookUpload.totalItems} items · writes {activeAutoTextbookUpload.writeCount} · reads {activeAutoTextbookUpload.readCount}
            </p>
          </div>
          <div className="header-upload-monitor__actions">
            {activeAutoTextbookUpload.canResume && activeAutoTextbookUpload.status !== "uploading" ? (
              <button type="button" className="btn-secondary" onClick={() => { void handleResumeUpload(); }}>
                Resume Upload
              </button>
            ) : null}
            {activeAutoTextbookUpload.status === "completed" ? (
              <button type="button" className="btn-secondary" onClick={() => { clearPersistedAutoTextbookUpload(); }}>
                Dismiss
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
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

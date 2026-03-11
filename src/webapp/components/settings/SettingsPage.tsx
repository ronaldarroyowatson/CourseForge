import React from "react";
import { doc, setDoc } from "firebase/firestore";

import { firestoreDb } from "../../../firebase/firestore";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";

interface SettingsPageProps {
  onBack: () => void;
}

/**
 * Centralized user preferences for sync safety and appearance.
 */
export function SettingsPage({ onBack }: SettingsPageProps): React.JSX.Element {
  const userId = useAuthStore((state) => state.userId);
  const theme = useUIStore((state) => state.theme);
  const toggleTheme = useUIStore((state) => state.toggleTheme);
  const automaticRetriesEnabled = useUIStore((state) => state.automaticRetriesEnabled);
  const setAutomaticRetriesEnabled = useUIStore((state) => state.setAutomaticRetriesEnabled);
  const retryCount = useUIStore((state) => state.retryCount);
  const retryLimit = useUIStore((state) => state.retryLimit);
  const writeCount = useUIStore((state) => state.writeCount);
  const writeBudgetLimit = useUIStore((state) => state.writeBudgetLimit);
  const writeBudgetExceeded = useUIStore((state) => state.writeBudgetExceeded);
  const pendingChangesCount = useUIStore((state) => state.pendingChangesCount);
  const syncStatus = useUIStore((state) => state.syncStatus);

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

  return (
    <section className="settings-page placeholder-panel">
      <div className="settings-page__header">
        <h2>Settings</h2>
        <button type="button" className="btn-secondary" onClick={onBack}>Back To Workspace</button>
      </div>

      <div className="settings-grid">
        <article className="settings-card">
          <h3>Sync Preferences</h3>
          <p>Automatic retries are off by default to avoid repeated failed writes and quota spikes.</p>
          <label
            className="settings-toggle"
            title="If disabled, autosync still runs, but failed syncs are not retried automatically."
          >
            <input
              type="checkbox"
              checked={automaticRetriesEnabled}
              onChange={(event) => {
                setAutomaticRetriesEnabled(event.target.checked);
                useUIStore.getState().setRetryCount(0);
              }}
            />
            Enable Automatic Retries
          </label>
          {!automaticRetriesEnabled ? (
            <p className="manual-entry-banner" title="Retries remain off until you re-enable this setting.">
              Automatic retries are currently disabled.
            </p>
          ) : null}
          <p className="settings-meta">Retries used: {retryCount}/{retryLimit}</p>
        </article>

        <article className="settings-card">
          <h3>Appearance</h3>
          <p>Theme preference is stored locally and mirrored to your user profile when available.</p>
          <button type="button" className="btn-secondary" onClick={() => { void handleThemeToggle(); }}>
            Theme: {theme === "dark" ? "Dark" : "Light"}
          </button>
        </article>

        <article className="settings-card">
          <h3>Sync Safety Status</h3>
          <p className="settings-meta">Sync status: {syncStatus}</p>
          <p className="settings-meta">Pending changes: {pendingChangesCount}</p>
          <p className="settings-meta">Writes this session: {writeCount}/{writeBudgetLimit}</p>
          {writeBudgetExceeded ? (
            <p className="error-text">Cloud sync paused to prevent excessive writes. Please review your data or try again later.</p>
          ) : null}
        </article>
      </div>
    </section>
  );
}

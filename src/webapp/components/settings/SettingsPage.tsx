import React from "react";
import { doc, setDoc } from "firebase/firestore";

import {
  type AutoOcrProviderId,
  getAutoOcrProviderHealth,
  getCloudAutoOcrProviderPolicy,
  getEffectiveAutoOcrProviderOrder,
  setCloudAutoOcrProviderPolicy,
  setAutoOcrProviderOrder,
} from "../../../core/services/autoOcrService";
import {
  clearDebugLogEntries,
  getDebugLogStorageStats,
  isDebugLoggingEnabled,
  setDebugLoggingEnabled,
  uploadAndClearDebugLogs,
} from "../../../core/services/debugLogService";
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
  const [debugEnabled, setDebugEnabled] = React.useState<boolean>(() => isDebugLoggingEnabled());
  const [debugStats, setDebugStats] = React.useState(() => getDebugLogStorageStats());
  const [debugStatus, setDebugStatus] = React.useState<string | null>(null);
  const [isUploadingDebugLog, setIsUploadingDebugLog] = React.useState(false);
  const [ocrProviderOrder, setOcrProviderOrderState] = React.useState<AutoOcrProviderId[]>(["local_tesseract", "cloud_openai_vision"]);
  const [ocrProviderHealth, setOcrProviderHealth] = React.useState<Array<{ id: AutoOcrProviderId; label: string; available: boolean }>>([]);
  const [ocrProviderStatus, setOcrProviderStatus] = React.useState<string | null>(null);
  const [isUpdatingOcrPolicy, setIsUpdatingOcrPolicy] = React.useState(false);

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

  function refreshDebugStats(): void {
    setDebugStats(getDebugLogStorageStats());
  }

  function handleDebugToggle(enabled: boolean): void {
    setDebugLoggingEnabled(enabled);
    setDebugEnabled(enabled);
    refreshDebugStats();
    setDebugStatus(enabled ? "Debug logging enabled." : "Debug logging disabled.");
  }

  function handleClearDebugLog(): void {
    clearDebugLogEntries();
    refreshDebugStats();
    setDebugStatus("Local debug log cleared.");
  }

  async function refreshOcrProviderHealth(): Promise<void> {
    const health = await getAutoOcrProviderHealth();
    setOcrProviderHealth(health);
  }

  function updatePrimaryOcrProvider(providerId: AutoOcrProviderId): void {
    const next = setAutoOcrProviderOrder([providerId, ocrProviderOrder[0] === providerId ? ocrProviderOrder[1] ?? "local_tesseract" : ocrProviderOrder[0]]);
    setOcrProviderOrderState(next);
    setOcrProviderStatus("OCR provider priority updated.");
  }

  function updateFallbackOcrProvider(providerId: AutoOcrProviderId): void {
    const primary = ocrProviderOrder[0] ?? "local_tesseract";
    const next = setAutoOcrProviderOrder([primary, providerId]);
    setOcrProviderOrderState(next);
    setOcrProviderStatus("OCR fallback provider updated.");
  }

  React.useEffect(() => {
    void (async () => {
      const effectiveOrder = await getEffectiveAutoOcrProviderOrder();
      setOcrProviderOrderState(effectiveOrder);
      await refreshOcrProviderHealth();
    })();
  }, []);

  async function handleReloadCloudPolicy(): Promise<void> {
    setIsUpdatingOcrPolicy(true);
    try {
      const cloudPolicy = await getCloudAutoOcrProviderPolicy();
      if (!cloudPolicy?.providerOrder?.length) {
        setOcrProviderStatus("No shared AI provider policy is currently set.");
        return;
      }

      setOcrProviderOrderState(cloudPolicy.providerOrder);
      setOcrProviderStatus("Loaded shared AI provider policy from cloud.");
    } catch {
      setOcrProviderStatus("Unable to load shared AI provider policy right now.");
    } finally {
      setIsUpdatingOcrPolicy(false);
    }
  }

  async function handleApplyCloudPolicy(): Promise<void> {
    setIsUpdatingOcrPolicy(true);
    try {
      const result = await setCloudAutoOcrProviderPolicy(ocrProviderOrder);
      if (!result) {
        setOcrProviderStatus("Unable to save shared AI provider policy.");
        return;
      }

      setOcrProviderOrderState(result.providerOrder);
      setOcrProviderStatus("Saved shared AI provider policy.");
    } catch {
      setOcrProviderStatus("Unable to save shared AI provider policy. Admin access may be required.");
    } finally {
      setIsUpdatingOcrPolicy(false);
    }
  }

  async function handleSendDebugLogToCloud(): Promise<void> {
    try {
      setIsUploadingDebugLog(true);
      setDebugStatus(null);

      const result = await uploadAndClearDebugLogs({
        userId,
      });

      refreshDebugStats();
      setDebugStatus(result.uploadedCount > 0
        ? `Uploaded ${result.uploadedCount} debug log entr${result.uploadedCount === 1 ? "y" : "ies"} to cloud and cleared local logs.`
        : "No local debug logs to upload.");
    } catch {
      setDebugStatus("Unable to upload debug logs right now. Please try again.");
    } finally {
      setIsUploadingDebugLog(false);
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

        <article className="settings-card">
          <h3>AI Service Resilience</h3>
          <p>Choose primary and fallback OCR providers for Auto textbook mode. If one provider is unavailable, CourseForge automatically falls back.</p>
          <label>
            Primary OCR Provider
            <select
              value={ocrProviderOrder[0] ?? "local_tesseract"}
              onChange={(event) => updatePrimaryOcrProvider(event.target.value as AutoOcrProviderId)}
            >
              <option value="local_tesseract">Local OCR (Tesseract)</option>
              <option value="cloud_openai_vision">Cloud OCR (OpenAI Vision)</option>
            </select>
          </label>
          <label>
            Fallback OCR Provider
            <select
              value={ocrProviderOrder[1] ?? "cloud_openai_vision"}
              onChange={(event) => updateFallbackOcrProvider(event.target.value as AutoOcrProviderId)}
            >
              <option value="local_tesseract">Local OCR (Tesseract)</option>
              <option value="cloud_openai_vision">Cloud OCR (OpenAI Vision)</option>
            </select>
          </label>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => { void refreshOcrProviderHealth(); }}>
              Refresh Provider Health
            </button>
            <button type="button" className="btn-secondary" onClick={() => { void handleReloadCloudPolicy(); }} disabled={isUpdatingOcrPolicy}>
              {isUpdatingOcrPolicy ? "Working..." : "Load Shared Policy"}
            </button>
            <button type="button" onClick={() => { void handleApplyCloudPolicy(); }} disabled={isUpdatingOcrPolicy}>
              {isUpdatingOcrPolicy ? "Working..." : "Save As Shared Policy"}
            </button>
          </div>
          {ocrProviderHealth.map((provider) => (
            <p key={provider.id} className="settings-meta">
              {provider.label}: {provider.available ? "Available" : "Unavailable"}
            </p>
          ))}
          {ocrProviderStatus ? <p className="settings-meta">{ocrProviderStatus}</p> : null}
        </article>

        <article className="settings-card">
          <h3>Debug Log</h3>
          <p>Store local troubleshooting events for Auto Mode and sync behavior. You control whether logs are collected and when they are uploaded.</p>
          <label className="settings-toggle" title="When disabled, no new local debug events are stored.">
            <input
              type="checkbox"
              checked={debugEnabled}
              onChange={(event) => handleDebugToggle(event.target.checked)}
            />
            Enable Debug Logging
          </label>
          <p className="settings-meta">Stored entries: {debugStats.entries}</p>
          <p className="settings-meta">Local log size: {Math.round(debugStats.totalBytes / 1024)} KB / {Math.round(debugStats.maxTotalBytes / 1024)} KB</p>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={handleClearDebugLog}>
              Clear Debug Log
            </button>
            <button type="button" onClick={() => { void handleSendDebugLogToCloud(); }} disabled={isUploadingDebugLog}>
              {isUploadingDebugLog ? "Sending..." : "Send Debug Log to Cloud"}
            </button>
          </div>
          {debugStatus ? <p className="settings-meta">{debugStatus}</p> : null}
        </article>
      </div>
    </section>
  );
}

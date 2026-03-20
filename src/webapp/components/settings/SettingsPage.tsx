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
import { fetchLanguageRegistryFromUrl } from "../../../core/services/translationWorkflowService";
import {
  clearDebugLogEntries,
  getDebugLoggingPolicy,
  getDebugLogStorageStats,
  isDebugLoggingEnabled,
  isMetadataCorrectionSharingEnabled,
  setMetadataCorrectionSharingEnabled,
  setDebugLoggingEnabled,
  uploadAndClearDebugLogs,
} from "../../../core/services";
import { getSupportedLanguages, t as translate } from "../../../core/services/i18nService";
import { firestoreDb } from "../../../firebase/firestore";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";

interface SettingsPageProps {
  onBack: () => void;
}

function parseSemver(value: string): number[] | null {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Centralized user preferences for sync safety and appearance.
 */
export function SettingsPage({ onBack }: SettingsPageProps): React.JSX.Element {
  const userId = useAuthStore((state) => state.userId);
  const theme = useUIStore((state) => state.theme);
  const language = useUIStore((state) => state.language);
  const setLanguage = useUIStore((state) => state.setLanguage);
  const accessibility = useUIStore((state) => state.accessibility);
  const patchAccessibility = useUIStore((state) => state.patchAccessibility);
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
  const [debugStats, setDebugStats] = React.useState({ entries: 0, totalBytes: 0, maxTotalBytes: 1_500_000, maxUploadBytes: 500 * 1024, lastUploadTimestamp: null as number | null });
  const [debugStatus, setDebugStatus] = React.useState<string | null>(null);
  const [isUploadingDebugLog, setIsUploadingDebugLog] = React.useState(false);
  const [debugPolicyStatus, setDebugPolicyStatus] = React.useState<string | null>(null);
  const [ocrProviderOrder, setOcrProviderOrderState] = React.useState<AutoOcrProviderId[]>(["local_tesseract", "cloud_openai_vision"]);
  const [metadataSharingEnabled, setMetadataSharingEnabled] = React.useState<boolean>(() => isMetadataCorrectionSharingEnabled());
  const [ocrProviderHealth, setOcrProviderHealth] = React.useState<Array<{ id: AutoOcrProviderId; label: string; available: boolean }>>([]);
  const [ocrProviderStatus, setOcrProviderStatus] = React.useState<string | null>(null);
  const [isUpdatingOcrPolicy, setIsUpdatingOcrPolicy] = React.useState(false);
  const [preferenceStatus, setPreferenceStatus] = React.useState<string | null>(null);
  const [languageRegistryStatus, setLanguageRegistryStatus] = React.useState<string | null>(null);
  const [languageRoadmapPreview, setLanguageRoadmapPreview] = React.useState<string[]>([]);
  const [updateCheckStatus, setUpdateCheckStatus] = React.useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = React.useState(false);
  const [latestReleaseUrl, setLatestReleaseUrl] = React.useState<string | null>(null);
  const [latestAvailableVersion, setLatestAvailableVersion] = React.useState<string | null>(null);
  const [pendingUpdateVersion, setPendingUpdateVersion] = React.useState<string | null>(null);
  const [currentAppVersion, setCurrentAppVersion] = React.useState<string>("unknown");
  const languageOptions = React.useMemo(() => getSupportedLanguages(), []);

  async function persistPreferences(nextLanguage: string, nextAccessibility = accessibility): Promise<void> {
    if (!userId) {
      return;
    }

    await setDoc(
      doc(firestoreDb, "users", userId),
      {
        preferences: {
          language: nextLanguage,
          accessibility: nextAccessibility,
        },
      },
      { merge: true }
    );
  }

  async function handleLanguageChange(nextLanguage: string): Promise<void> {
    setLanguage(nextLanguage as "en" | "es" | "pt" | "zm" | "fr" | "de");
    try {
      await persistPreferences(nextLanguage);
      setPreferenceStatus(translate(nextLanguage as "en" | "es" | "pt" | "zm" | "fr" | "de", "settings", "saved"));
    } catch {
      setPreferenceStatus("Unable to save language preference right now.");
    }
  }

  async function handleAccessibilityPatch(partial: Parameters<typeof patchAccessibility>[0]): Promise<void> {
    const nextAccessibility = {
      ...accessibility,
      ...partial,
    };
    patchAccessibility(partial);

    try {
      await persistPreferences(language, nextAccessibility);
      setPreferenceStatus(translate(language, "settings", "saved"));
    } catch {
      setPreferenceStatus("Unable to save accessibility preferences right now.");
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

  async function refreshDebugStats(): Promise<void> {
    setDebugStats(await getDebugLogStorageStats());
  }

  function handleDebugToggle(enabled: boolean): void {
    setDebugLoggingEnabled(enabled);
    setDebugEnabled(enabled);
    void refreshDebugStats();
    setDebugStatus(enabled ? "Debug logging enabled." : "Debug logging disabled.");
  }

  function handleClearDebugLog(): void {
    void (async () => {
      await clearDebugLogEntries();
      await refreshDebugStats();
      setDebugStatus("Local debug log cleared.");
    })();
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
      await refreshDebugStats();
      const policy = await getDebugLoggingPolicy();
      setDebugPolicyStatus(policy.enabledGlobally
        ? "Global debug logging is enabled."
        : "Global debug logging is currently disabled by an admin.");

      try {
        const response = await fetch("/api/update-status");
        if (response.ok) {
          const data = await response.json() as {
            available: boolean;
            version?: string | null;
            currentVersion?: string | null;
          };
          if (data.currentVersion) {
            setCurrentAppVersion(data.currentVersion);
          }
          const availableVersion = data.available && data.version ? data.version : null;
          setPendingUpdateVersion(availableVersion);
          if (availableVersion) {
            setLatestAvailableVersion(availableVersion);
          }
        }
      } catch {
        // The endpoint only exists in packaged launcher mode.
      }

      try {
        const response = await fetch("/api/check-for-updates");
        if (response.ok) {
          const data = await response.json() as {
            ok: boolean;
            latestVersion?: string | null;
            releaseUrl?: string | null;
          };
          if (data.ok && data.latestVersion) {
            setLatestAvailableVersion(data.latestVersion);
          }
          if (data.releaseUrl) {
            setLatestReleaseUrl(data.releaseUrl);
          }
        }
      } catch {
        // Best-effort latest version hint only.
      }
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

      await refreshDebugStats();
      setDebugStatus(result.uploadedCount > 0
        ? `Uploaded ${result.uploadedCount} debug log entr${result.uploadedCount === 1 ? "y" : "ies"} to cloud and cleared local logs.`
        : "No local debug logs to upload.");
    } catch {
      setDebugStatus("Unable to upload debug logs right now. Please try again.");
    } finally {
      setIsUploadingDebugLog(false);
    }
  }

  async function handleCheckLanguageUpdates(): Promise<void> {
    try {
      const registry = await fetchLanguageRegistryFromUrl();
      const newSupported = registry.supported.filter((item) => !languageOptions.includes(item as typeof languageOptions[number]));
      setLanguageRoadmapPreview(registry.roadmap.slice(0, 8));
      setLanguageRegistryStatus(
        newSupported.length > 0
          ? `Detected ${newSupported.length} new language pack candidate(s): ${newSupported.join(", ")}.`
          : `Language packs are up to date. Roadmap candidates: ${registry.roadmap.length}.`
      );
    } catch {
      setLanguageRegistryStatus("Unable to check for language updates right now.");
    }
  }

  async function handleCheckForUpdates(): Promise<void> {
    setIsCheckingUpdate(true);
    setUpdateCheckStatus(null);
    setLatestReleaseUrl(null);
    try {
      const response = await fetch("/api/check-for-updates");
      const data = await response.json() as {
        ok: boolean;
        available: boolean;
        latestVersion?: string | null;
        currentVersion?: string | null;
        releaseUrl?: string | null;
        error?: string | null;
      };
      if (data.latestVersion) {
        setLatestAvailableVersion(data.latestVersion);
      }
      if (data.releaseUrl) {
        setLatestReleaseUrl(data.releaseUrl);
      }
      if (!response.ok || !data.ok) {
        setUpdateCheckStatus(data.error || "Unable to check for updates right now. Please try again later.");
        return;
      }
      const latest = data.latestVersion || null;
      const partsLatest = latest ? parseSemver(latest) : null;
      const partsCurrent = parseSemver(currentAppVersion);
      if (!partsLatest) {
        setUpdateCheckStatus("Unable to read the latest release version from the local updater service.");
        return;
      }
      if (!partsCurrent) {
        setUpdateCheckStatus(`Latest release found: v${latest}. Local version metadata is unavailable in this runtime.`);
        return;
      }
      let isNewer = false;
      for (let i = 0; i < 3; i++) {
        const diff = (partsLatest[i] ?? 0) - (partsCurrent[i] ?? 0);
        if (diff > 0) { isNewer = true; break; }
        if (diff < 0) break;
      }
      if (isNewer) {
        setUpdateCheckStatus(`Update available: v${latest}`);
      } else {
        setUpdateCheckStatus(`You are up to date (v${currentAppVersion}).`);
      }
    } catch {
      setUpdateCheckStatus("Unable to check for updates right now. Please try again later.");
    } finally {
      setIsCheckingUpdate(false);
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
          <h3>{translate(language, "settings", "title")}</h3>
          <label>
            {translate(language, "settings", "languageLabel")}
            <select value={language} onChange={(event) => { void handleLanguageChange(event.target.value); }}>
              {languageOptions.map((option) => (
                <option key={option} value={option}>{option.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <p className="settings-meta">{translate(language, "settings", "languageHint")}</p>
          <button type="button" className="btn-secondary" onClick={() => { void handleCheckLanguageUpdates(); }}>
            Check For New Languages
          </button>
          {languageRegistryStatus ? <p className="settings-meta">{languageRegistryStatus}</p> : null}
          {languageRoadmapPreview.length > 0 ? (
            <p className="settings-meta">Roadmap preview: {languageRoadmapPreview.join(", ")}</p>
          ) : null}
        </article>

        <article className="settings-card" aria-live="polite">
          <h3>{translate(language, "settings", "accessibilityTitle")}</h3>
          <label>
            {translate(language, "settings", "colorBlindMode")}
            <select
              value={accessibility.colorBlindMode ?? "none"}
              onChange={(event) => {
                void handleAccessibilityPatch({
                  colorBlindMode: event.target.value as "protanopia" | "deuteranopia" | "tritanopia" | "none",
                });
              }}
            >
              <option value="none">None</option>
              <option value="protanopia">Protanopia</option>
              <option value="deuteranopia">Deuteranopia</option>
              <option value="tritanopia">Tritanopia</option>
            </select>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(accessibility.dyslexiaMode)}
              onChange={(event) => { void handleAccessibilityPatch({ dyslexiaMode: event.target.checked }); }}
            />
            {translate(language, "settings", "dyslexiaMode")}
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(accessibility.dyscalculiaMode)}
              onChange={(event) => { void handleAccessibilityPatch({ dyscalculiaMode: event.target.checked }); }}
            />
            {translate(language, "settings", "dyscalculiaMode")}
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(accessibility.highContrastMode)}
              onChange={(event) => { void handleAccessibilityPatch({ highContrastMode: event.target.checked }); }}
            />
            {translate(language, "settings", "highContrastMode")}
          </label>
          <label>
            {translate(language, "settings", "fontScale")}: {(accessibility.fontScale ?? 1).toFixed(2)}
            <input
              type="range"
              min={0.8}
              max={1.8}
              step={0.05}
              value={accessibility.fontScale ?? 1}
              onChange={(event) => { void handleAccessibilityPatch({ fontScale: Number(event.target.value) }); }}
            />
          </label>
          <label>
            {translate(language, "settings", "uiScale")}: {(accessibility.uiScale ?? 1).toFixed(2)}
            <input
              type="range"
              min={0.85}
              max={1.3}
              step={0.05}
              value={accessibility.uiScale ?? 1}
              onChange={(event) => { void handleAccessibilityPatch({ uiScale: Number(event.target.value) }); }}
            />
          </label>
          {preferenceStatus ? <p className="settings-meta">{preferenceStatus}</p> : null}
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
          <h3>Metadata Learning</h3>
          <p>Share corrections to improve extraction accuracy for everyone.</p>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={metadataSharingEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setMetadataCorrectionSharingEnabled(enabled);
                setMetadataSharingEnabled(enabled);
              }}
            />
            Share corrections to improve accuracy for everyone.
          </label>
          <p className="settings-meta">
            {metadataSharingEnabled
              ? "Corrections can be synced to shared review queues with safeguards."
              : "Corrections stay local only and are never uploaded."}
          </p>
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
          <p className="settings-meta">Upload limit: {Math.round(debugStats.maxUploadBytes / 1024)} KB</p>
          <p className="settings-meta">Last upload: {debugStats.lastUploadTimestamp ? new Date(debugStats.lastUploadTimestamp).toLocaleString() : "Never"}</p>
          {debugPolicyStatus ? <p className="settings-meta">{debugPolicyStatus}</p> : null}
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

        <article className="settings-card">
          <h3>App Updates</h3>
          <p>Current version: <strong>v{currentAppVersion}</strong></p>
          <p>Latest available: <strong>{latestAvailableVersion ? `v${latestAvailableVersion}` : "Not checked yet"}</strong></p>
          <p>The portable and Windows launcher packages update automatically in the background each time you start the app.</p>
          {pendingUpdateVersion ? (
            <p className="settings-meta">Downloaded update ready: v{pendingUpdateVersion}. It will be applied automatically on your next launch.</p>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { void handleCheckForUpdates(); }}
            disabled={isCheckingUpdate}
          >
            {isCheckingUpdate ? "Checking..." : "Check for Updates"}
          </button>
          {updateCheckStatus ? <p className="settings-meta">{updateCheckStatus}</p> : null}
          {latestReleaseUrl ? (
            <p className="settings-meta">
              <a href={latestReleaseUrl} target="_blank" rel="noopener noreferrer">View release on GitHub</a>
            </p>
          ) : null}
        </article>
      </div>
    </section>
  );
}

import React from "react";
import { doc, setDoc } from "firebase/firestore";

import {
  type AutoOcrProviderId,
  type AutoOcrProviderHealthRecord,
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

function formatVersionLabel(value: string | null | undefined): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return "unknown";
  }

  return parseSemver(normalized) ? `v${normalized}` : normalized;
}

function compareSemver(left: number[], right: number[]): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "Unknown size";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

type UpdaterProgress = {
  state?: string | null;
  mode?: string | null;
  currentVersion?: string | null;
  latestVersion?: string | null;
  assetName?: string | null;
  assetSizeBytes?: number | null;
  bytesDownloaded?: number | null;
  downloadSpeedBytesPerSecond?: number | null;
  progressPercent?: number | null;
  releaseUrl?: string | null;
  message?: string | null;
  lastError?: string | null;
  updatedAt?: string | null;
  filesTotal?: number | null;
  filesPlanned?: number | null;
  filesProcessed?: number | null;
  filesFailed?: number | null;
};

type UpdaterDiagnostics = {
  checkedAt?: string | null;
  currentVersion?: string | null;
  pendingUpdateVersion?: string | null;
  pendingUpdateStagedAt?: string | null;
  lastCheck?: {
    ok?: boolean;
    available?: boolean;
    latestVersion?: string | null;
    error?: string | null;
    diagnostics?: {
      responseStatus?: number | null;
      responseStatusText?: string | null;
      responseBodySnippet?: string | null;
      latestEndpoint?: string | null;
      tokenConfigured?: boolean;
    } | null;
  } | null;
  updaterLogTail?: string[] | null;
  integrity?: {
    ok?: boolean;
    summary?: {
      trackedFiles?: number;
      missing?: number;
      modified?: number;
      corrupted?: number;
      extras?: number;
    };
  } | null;
};

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
  const [ocrProviderOrder, setOcrProviderOrderState] = React.useState<AutoOcrProviderId[]>(["cloud_openai_vision", "local_tesseract"]);
  const [metadataSharingEnabled, setMetadataSharingEnabled] = React.useState<boolean>(() => isMetadataCorrectionSharingEnabled());
  const [ocrProviderHealth, setOcrProviderHealth] = React.useState<AutoOcrProviderHealthRecord[]>([]);
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
  const [updaterProgress, setUpdaterProgress] = React.useState<UpdaterProgress | null>(null);
  const [updaterDiagnostics, setUpdaterDiagnostics] = React.useState<UpdaterDiagnostics | null>(null);
  const [showUpdaterDiagnostics, setShowUpdaterDiagnostics] = React.useState(false);
  const [isLoadingUpdaterDiagnostics, setIsLoadingUpdaterDiagnostics] = React.useState(false);
  const languageOptions = React.useMemo(() => getSupportedLanguages(), []);

  function toNoStoreApiUrl(path: string): string {
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}_ts=${Date.now()}`;
  }

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
    const health = await getAutoOcrProviderHealth({ forceRefresh: true });
    setOcrProviderHealth(health);
    const cloudHealth = health.find((provider) => provider.id === "cloud_openai_vision");
    const hasUnknown = health.some((provider) => provider.availabilityState === "unknown");
    if (hasUnknown) {
      setOcrProviderStatus(cloudHealth?.errorMessage
        ? `Cloud OCR probe is inconclusive: ${cloudHealth.errorMessage}`
        : "One or more provider checks were inconclusive. Cloud OCR may still work during extraction.");
      return;
    }

    if (cloudHealth && !cloudHealth.available && cloudHealth.errorMessage) {
      setOcrProviderStatus(cloudHealth.errorMessage);
      return;
    }

    setOcrProviderStatus(null);
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
        const response = await fetch(toNoStoreApiUrl("/api/update-status"), { cache: "no-store" });
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
        const response = await fetch(toNoStoreApiUrl("/api/check-for-updates"), { cache: "no-store" });
        if (response.ok) {
          const data = await response.json() as {
            ok: boolean;
            currentVersion?: string | null;
            latestVersion?: string | null;
            releaseUrl?: string | null;
          };
          if (data.currentVersion) {
            setCurrentAppVersion(data.currentVersion);
          }
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

      try {
        const response = await fetch(toNoStoreApiUrl("/api/updater-progress"), { cache: "no-store" });
        if (response.ok) {
          const data = await response.json() as UpdaterProgress;
          setUpdaterProgress(data);
          if (data.currentVersion) {
            setCurrentAppVersion(data.currentVersion);
          }
          if (data.latestVersion) {
            setLatestAvailableVersion(data.latestVersion);
          }
          if (data.releaseUrl) {
            setLatestReleaseUrl(data.releaseUrl);
          }
        }
      } catch {
        // Best-effort updater telemetry only.
      }
    })();
  }, []);

  async function refreshUpdaterDiagnostics(): Promise<void> {
    setIsLoadingUpdaterDiagnostics(true);
    try {
      const response = await fetch(toNoStoreApiUrl("/api/updater-diagnostics"), { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const payload = await response.json() as UpdaterDiagnostics;
      setUpdaterDiagnostics(payload);
      if (payload.lastCheck?.latestVersion) {
        setLatestAvailableVersion(payload.lastCheck.latestVersion);
      }
    } catch {
      // Best effort diagnostics view only.
    } finally {
      setIsLoadingUpdaterDiagnostics(false);
    }
  }

  React.useEffect(() => {
    let active = true;

    const pollUpdaterProgress = async () => {
      try {
        const response = await fetch(toNoStoreApiUrl("/api/updater-progress"), { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const data = await response.json() as UpdaterProgress;
        if (!active) {
          return;
        }

        setUpdaterProgress(data);
        if (data.currentVersion) {
          setCurrentAppVersion(data.currentVersion);
        }
        if (data.latestVersion) {
          setLatestAvailableVersion(data.latestVersion);
        }
        if (data.releaseUrl) {
          setLatestReleaseUrl(data.releaseUrl);
        }
      } catch {
        // Keep polling quietly in environments without local updater API.
      }
    };

    const intervalId = window.setInterval(() => {
      void pollUpdaterProgress();
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
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
      const response = await fetch(toNoStoreApiUrl("/api/check-for-updates"), { cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      let data: {
        ok: boolean;
        available: boolean;
        latestVersion?: string | null;
        currentVersion?: string | null;
        releaseUrl?: string | null;
        error?: string | null;
        stageRequested?: boolean;
        stageAccepted?: boolean;
        stageReason?: string | null;
        stageMessage?: string | null;
        stagePid?: number | null;
      } | null = null;
      let nonJsonBody = "";

      if (contentType.toLowerCase().includes("application/json")) {
        try {
          data = await response.json() as {
            ok: boolean;
            available: boolean;
            latestVersion?: string | null;
            currentVersion?: string | null;
            releaseUrl?: string | null;
            error?: string | null;
          };
        } catch {
          setUpdateCheckStatus("Unable to parse updater response from local service.");
          return;
        }
      } else {
        nonJsonBody = await response.text();
      }

      if (data?.latestVersion) {
        setLatestAvailableVersion(data.latestVersion);
      }
      if (data?.currentVersion) {
        setCurrentAppVersion(data.currentVersion);
      }
      if (data?.releaseUrl) {
        setLatestReleaseUrl(data.releaseUrl);
      }

      const resolvedCurrentVersion = data?.currentVersion || currentAppVersion;
      const knownLatestVersion = data?.latestVersion || latestAvailableVersion || updaterProgress?.latestVersion || null;
      const knownCurrentSemver = parseSemver(resolvedCurrentVersion);
      const knownLatestSemver = parseSemver(knownLatestVersion || "");
      const knownAlreadyCurrent = Boolean(
        knownCurrentSemver
        && knownLatestSemver
        && compareSemver(knownCurrentSemver, knownLatestSemver) >= 0
      );

      if (!response.ok) {
        if (knownAlreadyCurrent) {
          setUpdateCheckStatus(`Already up to date (latest confirmed: ${formatVersionLabel(knownLatestVersion)}). You're running ${formatVersionLabel(resolvedCurrentVersion)}.`);
          return;
        }

        const trimmedBody = nonJsonBody.trim();
        if (data?.error) {
          setUpdateCheckStatus(`Update check failed (${response.status}): ${data.error}`);
          void refreshUpdaterDiagnostics();
          return;
        }
        if (trimmedBody) {
          setUpdateCheckStatus(`Update check failed (${response.status}): ${trimmedBody.slice(0, 180)}`);
          void refreshUpdaterDiagnostics();
          return;
        }
        setUpdateCheckStatus(`Update check failed with HTTP ${response.status}.`);
        void refreshUpdaterDiagnostics();
        return;
      }

      if (!data || !data.ok) {
        if (knownAlreadyCurrent) {
          setUpdateCheckStatus(`Already up to date (latest confirmed: ${formatVersionLabel(knownLatestVersion)}). You're running ${formatVersionLabel(resolvedCurrentVersion)}.`);
          return;
        }

        setUpdateCheckStatus(data?.error || "Unable to check for updates right now. Please try again later.");
        void refreshUpdaterDiagnostics();
        return;
      }

      if (!data.available) {
        setUpdateCheckStatus(`Already up to date. You're running ${formatVersionLabel(resolvedCurrentVersion)}.`);
        return;
      }
      const latest = data.latestVersion || null;
      const partsLatest = latest ? parseSemver(latest) : null;
      const partsCurrent = parseSemver(resolvedCurrentVersion);
      if (!partsLatest) {
        setUpdateCheckStatus("Update is already current, but the updater service did not return a parseable latest version.");
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
        if (data?.stageRequested && data.stageAccepted) {
          setUpdateCheckStatus(`Update available: v${latest}. Download and staging started in the background (PID ${data.stagePid ?? "unknown"}).`);
          return;
        }

        if (data?.stageRequested && !data.stageAccepted) {
          const reason = data.stageMessage || "Unable to start background staging.";
          setUpdateCheckStatus(`Update available: v${latest}. ${reason}`);
          return;
        }

        setUpdateCheckStatus(`Update available: v${latest}.`);
      } else {
        setUpdateCheckStatus(`Already up to date. You're running ${formatVersionLabel(resolvedCurrentVersion)}.`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown request failure";

      const knownLatestVersion = latestAvailableVersion || updaterProgress?.latestVersion || null;
      const knownCurrentSemver = parseSemver(currentAppVersion);
      const knownLatestSemver = parseSemver(knownLatestVersion || "");
      const knownAlreadyCurrent = Boolean(
        knownCurrentSemver
        && knownLatestSemver
        && compareSemver(knownCurrentSemver, knownLatestSemver) >= 0
      );

      if (knownAlreadyCurrent) {
        setUpdateCheckStatus(`Already up to date (latest confirmed: ${formatVersionLabel(knownLatestVersion)}). You're running ${formatVersionLabel(currentAppVersion)}.`);
        return;
      }

      setUpdateCheckStatus(`Unable to check for updates right now (${errorMessage}).`);
      void refreshUpdaterDiagnostics();
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  return (
    <section className="settings-page placeholder-panel">
      <div className="settings-page__header">
        <h2>Settings</h2>
        <div className="settings-page__header-actions">
          <button type="button" className="btn-secondary" onClick={() => { void handleThemeToggle(); }}>
            Theme: {theme === "dark" ? "Dark" : "Light"}
          </button>
          <button type="button" className="btn-secondary" onClick={onBack}>Back To Workspace</button>
        </div>
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
          <p className="settings-meta">Writes today (UTC): {writeCount}/{writeBudgetLimit}</p>
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
              value={ocrProviderOrder[1] ?? "local_tesseract"}
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
              {provider.label}: {provider.availabilityState === "unknown"
                ? "Unknown (status probe failed)"
                : provider.available
                  ? "Available"
                  : "Unavailable"}
              {provider.errorMessage ? ` - ${provider.errorMessage}` : ""}
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
          <p>Current version: <strong>{formatVersionLabel(currentAppVersion)}</strong></p>
          <p>Latest available: <strong>{latestAvailableVersion ? formatVersionLabel(latestAvailableVersion) : "Not checked yet"}</strong></p>
          <p>Latest detected by updater service: <strong>{updaterProgress?.latestVersion ? formatVersionLabel(updaterProgress.latestVersion) : "No updater detection yet"}</strong></p>
          <p>The portable and Windows launcher packages update automatically in the background each time you start the app.</p>
          {updaterProgress?.message ? (
            <p className="settings-meta">Updater status: {updaterProgress.message}</p>
          ) : null}
          {typeof updaterProgress?.progressPercent === "number" ? (
            <div className="settings-meta" aria-live="polite">
              <label htmlFor="updater-progress">Update progress: {updaterProgress.progressPercent}%</label>
              <progress id="updater-progress" className="settings-progress" max={100} value={Math.max(0, Math.min(100, updaterProgress.progressPercent))} />
            </div>
          ) : null}
          {typeof updaterProgress?.assetSizeBytes === "number" ? (
            <p className="settings-meta">
              Package size: {formatBytes(updaterProgress.assetSizeBytes)}
              {typeof updaterProgress.bytesDownloaded === "number"
                ? ` (${formatBytes(updaterProgress.bytesDownloaded)} downloaded)`
                : ""}
            </p>
          ) : null}
          {typeof updaterProgress?.downloadSpeedBytesPerSecond === "number" ? (
            <p className="settings-meta">
              Download speed: {formatBytes(updaterProgress.downloadSpeedBytesPerSecond)}/s
            </p>
          ) : null}
          {typeof updaterProgress?.filesTotal === "number" ? (
            <p className="settings-meta">
              Files in update: {updaterProgress.filesTotal}
              {typeof updaterProgress.filesPlanned === "number" ? ` | planned: ${updaterProgress.filesPlanned}` : ""}
              {typeof updaterProgress.filesProcessed === "number" ? ` | processed: ${updaterProgress.filesProcessed}` : ""}
              {typeof updaterProgress.filesFailed === "number" ? ` | failed: ${updaterProgress.filesFailed}` : ""}
            </p>
          ) : null}
          {updaterProgress?.state === "staged" ? (
            <p className="settings-meta">Update staged and waiting for restart to apply.</p>
          ) : null}
          {updaterProgress?.state === "updated" ? (
            <p className="settings-meta">Update already applied in this runtime session.</p>
          ) : null}
          {updaterProgress?.lastError ? (
            <p className="error-text">Updater error: {updaterProgress.lastError}</p>
          ) : null}
          {pendingUpdateVersion ? (
            <p className="settings-meta">Downloaded update ready: {formatVersionLabel(pendingUpdateVersion)}. It will be applied automatically on your next launch.</p>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { void handleCheckForUpdates(); }}
            disabled={isCheckingUpdate}
          >
            {isCheckingUpdate ? "Checking..." : "Check for Updates"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setShowUpdaterDiagnostics((previous) => !previous);
              if (!showUpdaterDiagnostics) {
                void refreshUpdaterDiagnostics();
              }
            }}
            disabled={isLoadingUpdaterDiagnostics}
          >
            {isLoadingUpdaterDiagnostics ? "Loading diagnostics..." : (showUpdaterDiagnostics ? "Hide Updater Diagnostics" : "Show Updater Diagnostics")}
          </button>
          {updateCheckStatus ? <p className="settings-meta">{updateCheckStatus}</p> : null}
          {showUpdaterDiagnostics ? (
            <div className="settings-meta" aria-live="polite">
              <p>Last diagnostics snapshot: {updaterDiagnostics?.checkedAt ? new Date(updaterDiagnostics.checkedAt).toLocaleString() : "Not available"}</p>
              <p>Last check result: {updaterDiagnostics?.lastCheck?.ok ? "Success" : "Failure or unavailable"}</p>
              {updaterDiagnostics?.lastCheck?.error ? <p className="error-text">Last check error: {updaterDiagnostics.lastCheck.error}</p> : null}
              {updaterDiagnostics?.lastCheck?.diagnostics?.responseStatus ? (
                <p>HTTP status: {updaterDiagnostics.lastCheck.diagnostics.responseStatus} {updaterDiagnostics.lastCheck.diagnostics.responseStatusText || ""}</p>
              ) : null}
              {updaterDiagnostics?.lastCheck?.diagnostics?.latestEndpoint ? (
                <p>Latest endpoint: {updaterDiagnostics.lastCheck.diagnostics.latestEndpoint}</p>
              ) : null}
              <p>Token configured: {updaterDiagnostics?.lastCheck?.diagnostics?.tokenConfigured ? "Yes" : "No"}</p>
              {updaterDiagnostics?.lastCheck?.diagnostics?.responseBodySnippet ? (
                <p>Response snippet: {updaterDiagnostics.lastCheck.diagnostics.responseBodySnippet}</p>
              ) : null}
              {updaterDiagnostics?.updaterLogTail && updaterDiagnostics.updaterLogTail.length > 0 ? (
                <details>
                  <summary>Updater log tail</summary>
                  <pre className="settings-log-tail">
                    {updaterDiagnostics.updaterLogTail.join("\n")}
                  </pre>
                </details>
              ) : null}
              {updaterDiagnostics?.integrity ? (
                <p>
                  Integrity: {updaterDiagnostics.integrity.ok ? "Healthy" : "Issues detected"}
                  {updaterDiagnostics.integrity.summary
                    ? ` | tracked: ${updaterDiagnostics.integrity.summary.trackedFiles ?? 0}, missing: ${updaterDiagnostics.integrity.summary.missing ?? 0}, modified: ${updaterDiagnostics.integrity.summary.modified ?? 0}, corrupted: ${updaterDiagnostics.integrity.summary.corrupted ?? 0}, extra: ${updaterDiagnostics.integrity.summary.extras ?? 0}`
                    : ""}
                </p>
              ) : null}
            </div>
          ) : null}
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

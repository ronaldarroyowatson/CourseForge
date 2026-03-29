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
  readLocalCorrectionRecords,
  setMetadataCorrectionSharingEnabled,
  setDebugLoggingEnabled,
  uploadAndClearDebugLogs,
} from "../../../core/services";
import { getSupportedLanguages, t as translate } from "../../../core/services/i18nService";
import { firestoreDb } from "../../../firebase/firestore";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";

interface SettingsPageProps {
  onBack?: () => void;
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

function getShortProviderLabel(id: AutoOcrProviderId): string {
  switch (id) {
    case "cloud_openai_vision": return "Cloud OCR (OpenAI Vision)";
    case "cloud_github_models_vision": return "Cloud OCR (GitHub Models Vision)";
    default: return "Local OCR (Tesseract)";
  }
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

type LocalMetadataTrainingStats = {
  totalCorrections: number;
  pendingCorrections: number;
  flaggedCorrections: number;
  acceptedCorrections: number;
  averageConfidencePct: number;
  lastCorrectionAt: string | null;
};

function describeMetadataPipelineHealth(input: {
  metadataSharingEnabled: boolean;
  stats: LocalMetadataTrainingStats;
  ocrProviderHealth: AutoOcrProviderHealthRecord[];
  ocrProviderStatus: string | null;
}): {
  cloudStatus: string;
  learningStatus: string;
  syncStatus: string;
} {
  const cloudProviders = input.ocrProviderHealth.filter((provider) => provider.id !== "local_tesseract");
  const availableCloudProviders = cloudProviders.filter((provider) => provider.available === true);
  const unavailableCloudProviders = cloudProviders.filter((provider) => provider.availabilityState === "unavailable");

  const cloudStatus = unavailableCloudProviders.length > 0
    ? `Cloud OCR degraded: ${unavailableCloudProviders.map((provider) => provider.label).join(", ")} unavailable. Local OCR remains the fallback.`
    : availableCloudProviders.length > 0
      ? input.ocrProviderStatus ?? "Cloud OCR providers are ready. Local OCR remains the final fallback."
      : "Cloud OCR status is still being probed. Local OCR will be used if cloud checks fail.";

  const learningStatus = input.stats.totalCorrections > 0
    ? `Local learning has ${input.stats.totalCorrections} correction sample${input.stats.totalCorrections === 1 ? "" : "s"} recorded.`
    : "Local learning has not recorded any correction samples yet.";

  const syncStatus = !input.metadataSharingEnabled
    ? "Sync is disabled. Correction samples stay on this device only."
    : input.stats.flaggedCorrections > 0
      ? `${input.stats.flaggedCorrections} correction sample${input.stats.flaggedCorrections === 1 ? " is" : "s are"} held for review before upload.`
      : input.stats.pendingCorrections > 0
        ? `${input.stats.pendingCorrections} correction sample${input.stats.pendingCorrections === 1 ? " is" : "s are"} queued locally for sync.`
        : "No correction samples are waiting to sync.";

  return {
    cloudStatus,
    learningStatus,
    syncStatus,
  };
}

function SyncDonutChart({
  label,
  used,
  limit,
  exceeded,
  showWarning = false,
}: {
  label: "Writes" | "Reads";
  used: number;
  limit: number;
  exceeded: boolean;
  showWarning?: boolean;
}): React.JSX.Element {
  const r = 36;
  const cx = 50;
  const cy = 50;
  const circumference = 2 * Math.PI * r;
  const safeLimit = limit > 0 ? limit : 1;
  const usedFraction = Math.min(used / safeLimit, 1);
  const usedDash = usedFraction * circumference;
  const available = Math.max(0, limit - used);

  return (
    <div className="sync-donut">
      <svg
        viewBox="0 0 100 100"
        className="sync-donut__svg"
        aria-label={`${label} today: ${used} used of ${limit}`}
      >
        {/* Background grey track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-default)" strokeWidth={12} />
        {/* Full green ring for available portion base */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#22c55e"
          strokeWidth={12}
          transform="rotate(-90 50 50)"
        />
        {/* Red: used */}
        {usedFraction > 0 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="#ef4444"
            strokeWidth={12}
            strokeDasharray={`${usedDash} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="butt"
            transform="rotate(-90 50 50)"
          />
        )}
        {/* Center label */}
        <text x="50" y="46" textAnchor="middle" fontSize="8" fill="var(--text-primary)" fontWeight="600">{label}</text>
        <text x="50" y="57" textAnchor="middle" fontSize="8" fill="var(--text-secondary)">Today</text>
      </svg>
      <div className="sync-donut__stats">
        <p className="sync-donut__stat">Used: <strong>{used}</strong></p>
        <p className="sync-donut__stat">Available: <strong>{available}</strong></p>
      </div>
      {showWarning && exceeded && (
        <p className="error-text sync-donut__warning">
          Cloud sync paused to prevent excessive writes. Please review your data or try again later.
        </p>
      )}
    </div>
  );
}

/**
 * Centralized user preferences for sync safety and appearance.
 */
export function SettingsPage(_props: SettingsPageProps = {}): React.JSX.Element {
  const userId = useAuthStore((state) => state.userId);
  const language = useUIStore((state) => state.language);
  const setLanguage = useUIStore((state) => state.setLanguage);
  const accessibility = useUIStore((state) => state.accessibility);
  const patchAccessibility = useUIStore((state) => state.patchAccessibility);
  const automaticRetriesEnabled = useUIStore((state) => state.automaticRetriesEnabled);
  const setAutomaticRetriesEnabled = useUIStore((state) => state.setAutomaticRetriesEnabled);
  const retryCount = useUIStore((state) => state.retryCount);
  const retryLimit = useUIStore((state) => state.retryLimit);
  const writeCount = useUIStore((state) => state.writeCount);
  const writeBudgetLimit = useUIStore((state) => state.writeBudgetLimit);
  const writeBudgetExceeded = useUIStore((state) => state.writeBudgetExceeded);
  const readCount = useUIStore((state) => state.readCount);
  const readBudgetLimit = useUIStore((state) => state.readBudgetLimit);
  const readBudgetExceeded = useUIStore((state) => state.readBudgetExceeded);
  const pendingChangesCount = useUIStore((state) => state.pendingChangesCount);
  const syncStatus = useUIStore((state) => state.syncStatus);
  const [debugEnabled, setDebugEnabled] = React.useState<boolean>(() => isDebugLoggingEnabled());
  const [debugStats, setDebugStats] = React.useState({ entries: 0, totalBytes: 0, maxTotalBytes: 1_500_000, maxUploadBytes: 500 * 1024, lastUploadTimestamp: null as number | null });
  const [debugStatus, setDebugStatus] = React.useState<string | null>(null);
  const [isUploadingDebugLog, setIsUploadingDebugLog] = React.useState(false);
  const [debugPolicyStatus, setDebugPolicyStatus] = React.useState<string | null>(null);
  const [ocrProviderOrder, setOcrProviderOrderState] = React.useState<AutoOcrProviderId[]>([
    "cloud_openai_vision",
    "cloud_github_models_vision",
    "local_tesseract",
  ]);
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
  const [showSyncPreferences, setShowSyncPreferences] = React.useState(false);
  const [showLanguageSettings, setShowLanguageSettings] = React.useState(false);
  const [showAccessibilitySettings, setShowAccessibilitySettings] = React.useState(false);
  const [showMetadataLearning, setShowMetadataLearning] = React.useState(false);
  const [metadataTrainingStats, setMetadataTrainingStats] = React.useState<LocalMetadataTrainingStats>({
    totalCorrections: 0,
    pendingCorrections: 0,
    flaggedCorrections: 0,
    acceptedCorrections: 0,
    averageConfidencePct: 0,
    lastCorrectionAt: null,
  });
  const languageOptions = React.useMemo(() => getSupportedLanguages(), []);
  const ocrHealthById = React.useMemo(() => {
    return new Map(ocrProviderHealth.map((provider) => [provider.id, provider]));
  }, [ocrProviderHealth]);
  const metadataPipelineHealth = React.useMemo(() => describeMetadataPipelineHealth({
    metadataSharingEnabled,
    stats: metadataTrainingStats,
    ocrProviderHealth,
    ocrProviderStatus,
  }), [metadataSharingEnabled, metadataTrainingStats, ocrProviderHealth, ocrProviderStatus]);
  const secondChoiceProviderId = ocrProviderOrder.find((providerId) => providerId !== ocrProviderOrder[0] && providerId !== "local_tesseract") ?? "cloud_github_models_vision";
  const retryVisualTotal = Math.max(1, Math.min(5, retryLimit || 3));
  const retryVisualUsed = Math.max(0, Math.min(retryVisualTotal, retryCount));

  function refreshMetadataTrainingStats(): void {
    const corrections = readLocalCorrectionRecords();
    const totalCorrections = corrections.length;
    const pendingCorrections = corrections.filter((record) => record.reviewStatus === "pending" && !record.flagged).length;
    const flaggedCorrections = corrections.filter((record) => record.flagged).length;
    const acceptedCorrections = corrections.filter((record) => record.reviewStatus === "accepted").length;
    const averageConfidencePct = totalCorrections > 0
      ? Math.round((corrections.reduce((sum, record) => sum + (record.finalConfidence ?? 0), 0) / totalCorrections) * 100)
      : 0;
    const lastCorrectionAt = totalCorrections > 0
      ? corrections
        .map((record) => record.timestamp)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
      : null;

    setMetadataTrainingStats({
      totalCorrections,
      pendingCorrections,
      flaggedCorrections,
      acceptedCorrections,
      averageConfidencePct,
      lastCorrectionAt,
    });
  }

  function renderProviderStatusBadge(providerId: AutoOcrProviderId): React.JSX.Element {
    const providerHealth = ocrHealthById.get(providerId);
    const isHealthy = providerHealth?.available === true;
    const statusClass = isHealthy ? "ocr-provider-status ocr-provider-status--ok" : "ocr-provider-status ocr-provider-status--fail";

    return (
      <span className={statusClass}>
        <span className="ocr-provider-status__mark" aria-hidden="true">✓</span>
        <span className="ocr-provider-status__name">{getShortProviderLabel(providerId)}</span>
      </span>
    );
  }

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

  async function refreshOcrProviderHealth(forceRefresh = false): Promise<void> {
    const health = await getAutoOcrProviderHealth({ forceRefresh });
    setOcrProviderHealth(health);
    const cloudProviders = health.filter((provider) => provider.id !== "local_tesseract");
    const unavailableProviders = cloudProviders.filter((provider) => provider.availabilityState === "unavailable");
    const unknownProviders = cloudProviders.filter((provider) => provider.availabilityState === "unknown");
    if (unavailableProviders.length > 0) {
      setOcrProviderStatus(unavailableProviders.map((provider) => `${provider.label}: ${provider.errorMessage ?? "Unavailable"}`).join(" | "));
      return;
    }

    if (unknownProviders.length > 0) {
      setOcrProviderStatus(unknownProviders.map((provider) => `${provider.label}: ${provider.errorMessage ?? "Probe inconclusive"}`).join(" | "));
      return;
    }

    setOcrProviderStatus("Cloud OCR providers are ready. Local OCR remains the final fallback.");
  }

  function updatePrimaryOcrProvider(providerId: AutoOcrProviderId): void {
    const secondary = ocrProviderOrder.find((entry) => entry !== providerId && entry !== "local_tesseract") ?? "cloud_github_models_vision";
    const next = setAutoOcrProviderOrder([providerId, secondary]);
    setOcrProviderOrderState(next);
    setOcrProviderStatus("Primary cloud OCR provider updated. Local OCR remains the final fallback.");
  }

  function updateFallbackOcrProvider(providerId: AutoOcrProviderId): void {
    const primary = ocrProviderOrder[0] ?? "cloud_openai_vision";
    const next = setAutoOcrProviderOrder([primary, providerId]);
    setOcrProviderOrderState(next);
    setOcrProviderStatus("Secondary cloud OCR provider updated. Local OCR remains the final fallback.");
  }

  React.useEffect(() => {
    void (async () => {
      const effectiveOrder = await getEffectiveAutoOcrProviderOrder();
      setOcrProviderOrderState(effectiveOrder);
      await refreshOcrProviderHealth(false);
      await refreshDebugStats();
      refreshMetadataTrainingStats();
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
        setUpdaterProgress((previous) => ({
          ...(previous || {}),
          latestVersion: payload.lastCheck?.latestVersion ?? previous?.latestVersion ?? null,
          state: previous?.state ?? "idle",
          mode: previous?.mode ?? null,
          message: previous?.message ?? null,
          updatedAt: new Date().toISOString(),
        }));
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

  async function resolveKnownUpdateVersions(
    currentVersionHint?: string | null,
    latestVersionHint?: string | null
  ): Promise<{ currentVersion: string | null; latestVersion: string | null; alreadyCurrent: boolean }> {
    let resolvedCurrentVersion = currentVersionHint || currentAppVersion || updaterProgress?.currentVersion || null;
    let resolvedLatestVersion = latestVersionHint || latestAvailableVersion || updaterProgress?.latestVersion || null;

    let currentSemver = parseSemver(resolvedCurrentVersion || "");
    let latestSemver = parseSemver(resolvedLatestVersion || "");

    if (!currentSemver || !latestSemver) {
      try {
        const progressResponse = await fetch(toNoStoreApiUrl("/api/updater-progress"), { cache: "no-store" });
        if (progressResponse.ok) {
          const progressData = await progressResponse.json() as UpdaterProgress;
          setUpdaterProgress(progressData);

          if (progressData.currentVersion) {
            setCurrentAppVersion(progressData.currentVersion);
            if (!parseSemver(resolvedCurrentVersion || "")) {
              resolvedCurrentVersion = progressData.currentVersion;
            }
          }

          if (progressData.latestVersion) {
            setLatestAvailableVersion(progressData.latestVersion);
            if (!parseSemver(resolvedLatestVersion || "")) {
              resolvedLatestVersion = progressData.latestVersion;
            }
          }

          if (progressData.releaseUrl) {
            setLatestReleaseUrl(progressData.releaseUrl);
          }

          currentSemver = parseSemver(resolvedCurrentVersion || "");
          latestSemver = parseSemver(resolvedLatestVersion || "");
        }
      } catch {
        // Keep this helper best-effort only.
      }
    }

    if (!currentSemver || !latestSemver) {
      try {
        const diagnosticsResponse = await fetch(toNoStoreApiUrl("/api/updater-diagnostics"), { cache: "no-store" });
        if (diagnosticsResponse.ok) {
          const diagnosticsData = await diagnosticsResponse.json() as UpdaterDiagnostics;
          setUpdaterDiagnostics(diagnosticsData);

          const diagnosticsLatestVersion = diagnosticsData.lastCheck?.latestVersion || null;
          const diagnosticsCurrentVersion = diagnosticsData.currentVersion || null;

          if (diagnosticsLatestVersion) {
            setLatestAvailableVersion(diagnosticsLatestVersion);
            if (!parseSemver(resolvedLatestVersion || "")) {
              resolvedLatestVersion = diagnosticsLatestVersion;
            }
            setUpdaterProgress((previous) => ({
              ...(previous || {}),
              latestVersion: diagnosticsLatestVersion,
              state: previous?.state ?? "idle",
              mode: previous?.mode ?? null,
              message: previous?.message ?? null,
              updatedAt: new Date().toISOString(),
            }));
          }

          if (diagnosticsCurrentVersion) {
            setCurrentAppVersion(diagnosticsCurrentVersion);
            if (!parseSemver(resolvedCurrentVersion || "")) {
              resolvedCurrentVersion = diagnosticsCurrentVersion;
            }
          }

          currentSemver = parseSemver(resolvedCurrentVersion || "");
          latestSemver = parseSemver(resolvedLatestVersion || "");
        }
      } catch {
        // Keep this helper best-effort only.
      }
    }

    return {
      currentVersion: resolvedCurrentVersion,
      latestVersion: resolvedLatestVersion,
      alreadyCurrent: Boolean(
        currentSemver
        && latestSemver
        && compareSemver(currentSemver, latestSemver) >= 0
      ),
    };
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
      if (data?.latestVersion || data?.currentVersion || data?.releaseUrl) {
        setUpdaterProgress((previous) => ({
          ...(previous || {}),
          latestVersion: data?.latestVersion ?? previous?.latestVersion ?? null,
          currentVersion: data?.currentVersion ?? previous?.currentVersion ?? null,
          releaseUrl: data?.releaseUrl ?? previous?.releaseUrl ?? null,
          state: previous?.state ?? "idle",
          mode: previous?.mode ?? null,
          message: previous?.message ?? null,
          updatedAt: new Date().toISOString(),
        }));
      }

      const knownVersions = await resolveKnownUpdateVersions(data?.currentVersion, data?.latestVersion);
      const resolvedCurrentVersion = knownVersions.currentVersion || currentAppVersion;
      const knownLatestVersion = knownVersions.latestVersion;
      const knownAlreadyCurrent = knownVersions.alreadyCurrent;

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

      const knownVersions = await resolveKnownUpdateVersions(currentAppVersion, latestAvailableVersion);
      const knownLatestVersion = knownVersions.latestVersion;
      const knownCurrentVersion = knownVersions.currentVersion || currentAppVersion;
      const knownAlreadyCurrent = knownVersions.alreadyCurrent;

      if (knownAlreadyCurrent) {
        setUpdateCheckStatus(`Already up to date (latest confirmed: ${formatVersionLabel(knownLatestVersion)}). You're running ${formatVersionLabel(knownCurrentVersion)}.`);
        return;
      }

      setUpdateCheckStatus(`Unable to check for updates right now (${errorMessage}).`);
      void refreshUpdaterDiagnostics();
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  const bestLatestVersion = (() => {
    const a = latestAvailableVersion || null;
    const b = updaterProgress?.latestVersion || updaterDiagnostics?.lastCheck?.latestVersion || null;
    if (!a) return b;
    if (!b) return a;
    const sa = parseSemver(a);
    const sb = parseSemver(b);
    if (!sa) return b;
    if (!sb) return a;
    return compareSemver(sb, sa) > 0 ? b : a;
  })();

  return (
    <section className="settings-page placeholder-panel">
      <div className="settings-page__header">
        <h2>Settings</h2>
      </div>

      <div className="settings-grid">
        <article className={`settings-card settings-card--expandable ${showSyncPreferences ? "settings-card--expanded" : ""}`}>
          <div className="settings-card__head">
            <h3>Sync Preferences</h3>
            <button type="button" className="btn-secondary settings-card__toggle" onClick={() => setShowSyncPreferences((previous) => !previous)}>
              {showSyncPreferences ? "Hide" : "Show"}
            </button>
          </div>
          <p>Automatic retries are off by default to avoid repeated failed writes and quota spikes.</p>
          {showSyncPreferences ? (
            <>
              <div className="settings-sync-retry-row">
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
                <div className="settings-retry-meter" aria-label={`Retries used ${retryVisualUsed} of ${retryVisualTotal}`}>
                  {Array.from({ length: retryVisualTotal }).map((_, index) => {
                    const isUsed = index < retryVisualUsed;
                    return (
                      <span
                        key={`retry-${index}`}
                        className={`settings-retry-meter__item ${isUsed ? "settings-retry-meter__item--used" : "settings-retry-meter__item--available"}`}
                      >
                        {isUsed ? "✗" : "✓"}
                      </span>
                    );
                  })}
                </div>
              </div>
              {!automaticRetriesEnabled ? (
                <p className="manual-entry-banner" title="Retries remain off until you re-enable this setting.">
                  Automatic retries are currently disabled.
                </p>
              ) : null}
              <p className="settings-meta">Retries used: {retryCount}/{retryLimit}</p>
            </>
          ) : null}
        </article>

        <article className={`settings-card settings-card--expandable ${showLanguageSettings ? "settings-card--expanded" : ""}`}>
          <div className="settings-card__head">
            <h3>{translate(language, "settings", "title")}</h3>
            <button type="button" className="btn-secondary settings-card__toggle" onClick={() => setShowLanguageSettings((previous) => !previous)}>
              {showLanguageSettings ? "Hide" : "Show"}
            </button>
          </div>
          <p className="settings-meta">Current language: {language.toUpperCase()}</p>
          {showLanguageSettings ? (
            <>
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
            </>
          ) : null}
        </article>

        <article className={`settings-card settings-card--expandable ${showAccessibilitySettings ? "settings-card--expanded" : ""}`} aria-live="polite">
          <div className="settings-card__head">
            <h3>{translate(language, "settings", "accessibilityTitle")}</h3>
            <button type="button" className="btn-secondary settings-card__toggle" onClick={() => setShowAccessibilitySettings((previous) => !previous)}>
              {showAccessibilitySettings ? "Hide" : "Show"}
            </button>
          </div>
          <p className="settings-meta">Color mode: {accessibility.colorBlindMode ?? "none"} | Font scale: {(accessibility.fontScale ?? 1).toFixed(2)} | UI scale: {(accessibility.uiScale ?? 1).toFixed(2)}</p>
          {showAccessibilitySettings ? (
            <>
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
            </>
          ) : null}
        </article>

        <article className="settings-card">
          <h3>Sync Safety Status</h3>
          <p className="settings-meta">Sync status: {syncStatus}</p>
          {pendingChangesCount > 0 && (
            <p className="settings-meta">Pending changes: {pendingChangesCount}</p>
          )}
          <div className="sync-safety-donuts">
            <SyncDonutChart label="Writes" used={writeCount} limit={writeBudgetLimit} exceeded={writeBudgetExceeded} showWarning />
            <SyncDonutChart label="Reads" used={readCount} limit={readBudgetLimit} exceeded={readBudgetExceeded} />
          </div>
        </article>

        <article className="settings-card">
          <h3>AI Service Resilience</h3>
          <p>Set the priority order for OCR providers. Each is tried in order; the first that succeeds is used.</p>
          <div className="ocr-provider-choices">
            <label className="ocr-provider-choice">
              <div className="ocr-provider-choice__header">
                <span className="ocr-provider-choice__label">#1 — First choice</span>
                {renderProviderStatusBadge(ocrProviderOrder[0] ?? "cloud_openai_vision")}
              </div>
              <select
                value={ocrProviderOrder[0] ?? "cloud_openai_vision"}
                onChange={(event) => updatePrimaryOcrProvider(event.target.value as AutoOcrProviderId)}
              >
                <option value="cloud_openai_vision">Cloud OCR (OpenAI Vision)</option>
                <option value="cloud_github_models_vision">Cloud OCR (GitHub Models Vision)</option>
              </select>
            </label>
            <label className="ocr-provider-choice">
              <div className="ocr-provider-choice__header">
                <span className="ocr-provider-choice__label">#2 — Second choice</span>
                {renderProviderStatusBadge(secondChoiceProviderId)}
              </div>
              <select
                value={secondChoiceProviderId}
                onChange={(event) => updateFallbackOcrProvider(event.target.value as AutoOcrProviderId)}
              >
                <option value="cloud_openai_vision">Cloud OCR (OpenAI Vision)</option>
                <option value="cloud_github_models_vision">Cloud OCR (GitHub Models Vision)</option>
              </select>
            </label>
            <div className="ocr-provider-choice ocr-provider-choice--static">
              <div className="ocr-provider-choice__header">
                <span className="ocr-provider-choice__label">#3 (automatic)</span>
                {renderProviderStatusBadge("local_tesseract")}
              </div>
            </div>
          </div>
          <div className="form-actions ocr-provider-actions">
            <button type="button" className="btn-secondary" onClick={() => { void refreshOcrProviderHealth(true); }}>
              Refresh Provider Health
            </button>
            <button type="button" className="btn-secondary" onClick={() => { void handleReloadCloudPolicy(); }} disabled={isUpdatingOcrPolicy}>
              {isUpdatingOcrPolicy ? "Working..." : "Load Shared Policy"}
            </button>
            <button type="button" onClick={() => { void handleApplyCloudPolicy(); }} disabled={isUpdatingOcrPolicy}>
              {isUpdatingOcrPolicy ? "Working..." : "Save As Shared Policy"}
            </button>
          </div>
          {ocrProviderHealth.some((provider) => provider.available !== true) ? (
            <div className="ocr-provider-details">
              {ocrProviderHealth.filter((provider) => provider.available !== true).map((provider) => {
                const fallbackMessage = provider.availabilityState === "unknown"
                  ? "Health status is currently unknown."
                  : "Provider is currently unavailable.";
                return (
                  <p key={provider.id} className="ocr-provider-details__item">
                    {getShortProviderLabel(provider.id)}: {provider.errorMessage ?? fallbackMessage}
                  </p>
                );
              })}
            </div>
          ) : null}
          {ocrProviderStatus ? <p className="settings-meta">{ocrProviderStatus}</p> : null}
        </article>

        <article className={`settings-card settings-card--expandable settings-card--compact ${showMetadataLearning ? "settings-card--expanded" : ""}`}>
          <div className="settings-card__head">
            <h3>Metadata Learning</h3>
            <button
              type="button"
              className="btn-secondary settings-card__toggle"
              onClick={() => {
                setShowMetadataLearning((previous) => !previous);
                refreshMetadataTrainingStats();
              }}
            >
              {showMetadataLearning ? "Hide" : "Show"}
            </button>
          </div>
          <p className="settings-meta">Sharing: {metadataSharingEnabled ? "Enabled" : "Disabled"}</p>
          {showMetadataLearning ? (
            <>
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
              <div className="metadata-training-grid">
                <p className="settings-meta">Corrections logged: <strong>{metadataTrainingStats.totalCorrections}</strong></p>
                <p className="settings-meta">Queued locally: <strong>{metadataTrainingStats.pendingCorrections}</strong></p>
                <p className="settings-meta">Accepted by admin: <strong>{metadataTrainingStats.acceptedCorrections}</strong></p>
                <p className="settings-meta">Flagged for review: <strong>{metadataTrainingStats.flaggedCorrections}</strong></p>
                <p className="settings-meta">Avg confidence: <strong>{metadataTrainingStats.averageConfidencePct}%</strong></p>
              </div>
              <p className="settings-meta">Last correction: {metadataTrainingStats.lastCorrectionAt ? new Date(metadataTrainingStats.lastCorrectionAt).toLocaleString() : "None yet"}</p>
              <p className="settings-meta">Cloud OCR health: {metadataPipelineHealth.cloudStatus}</p>
              <p className="settings-meta">Local learning: {metadataPipelineHealth.learningStatus}</p>
              <p className="settings-meta">Correction sync: {metadataPipelineHealth.syncStatus}</p>
            </>
          ) : null}
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
          {currentAppVersion !== "unknown" ? (
            <p>Current version: <strong>{formatVersionLabel(currentAppVersion)}</strong></p>
          ) : null}
          <p>Latest available: <strong>{bestLatestVersion ? formatVersionLabel(bestLatestVersion) : "Not checked yet"}</strong></p>
          <p className="settings-meta">Updates install automatically on startup.</p>
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

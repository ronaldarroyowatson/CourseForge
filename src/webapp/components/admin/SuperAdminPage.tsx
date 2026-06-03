import React from "react";

import {
  getAllUsers,
  getAllTextbooksAdmin,
  setUserAdminStatus,
  type AdminUserRecord,
  getSuperAdminDashboardStats,
  listAllSchoolsForSuperAdmin,
  listSchoolAdminPromotionRequests,
  resolveSchoolAdminPromotionRequest,
  setUserSuperAdminStatus,
  getSuperAdminGlobalQuota,
  getSuperAdminAzureQuota,
  getSuperAdminBackupConfig,
  setSuperAdminBackupConfig,
  runSuperAdminBackupNow,
  listSuperAdminBackupJobs,
  getSuperAdminAiProviderLimits,
  setGlobalAiSafetyPolicy,
  setUserAiSafetyOverride,
  type PromotionRequestRow,
  type SchoolDirectoryRow,
  type SuperAdminDashboardStats,
  type SuperAdminGlobalQuota,
  type SuperAdminAzureQuota,
  type SuperAdminBackupConfig,
  type SuperAdminBackupJob,
  type SuperAdminAiProviderLimits,
} from "../../../core/services";
import { getCurrentUser } from "../../../firebase/auth";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";
import { StatCard } from "./infographics/StatCard";
import { ProgressRing } from "./infographics/ProgressRing";
import { CountdownBadge } from "./infographics/CountdownBadge";
import { SkeletonBlock } from "./infographics/SkeletonBlock";

interface SuperAdminPageProps {
  onBack: () => void;
}

interface SuperAdminQuotaOverrides {
  readLimitPerDay: number | null;
  writeLimitPerDay: number | null;
  deleteLimitPerDay: number | null;
  functionInvocationsLimitPerMonth: number | null;
}

const DEFAULT_GLOBAL_READ_LIMIT_PER_DAY = 50000;
const DEFAULT_GLOBAL_WRITE_LIMIT_PER_DAY = 20000;
const DEFAULT_GLOBAL_DELETE_LIMIT_PER_DAY = 20000;
const DEFAULT_GLOBAL_FUNCTION_INVOCATIONS_LIMIT_PER_MONTH = 2000000;
const SUPER_ADMIN_QUOTA_OVERRIDES_KEY = "courseforge.superAdminQuotaOverrides.v1";
const QUOTA_CURRENT_USAGE_GATE_WAIT_MS = 800;

interface CurrentUsageValue {
  value: number;
  source: "quota" | "monitoring" | "sync-usage" | "stats" | "sync-budget";
}

type GitHubCopilotTier = "free" | "pro" | "business" | "enterprise";

const GITHUB_TIER_PRESETS: Record<GitHubCopilotTier, {
  requestsPerMinuteLimit: number;
  requestsPerDayLimit: number;
  tokensPerRequestInputLimit: number;
  tokensPerRequestOutputLimit: number;
  concurrentRequestsLimit: number;
}> = {
  free: {
    requestsPerMinuteLimit: 10,
    requestsPerDayLimit: 50,
    tokensPerRequestInputLimit: 8000,
    tokensPerRequestOutputLimit: 4000,
    concurrentRequestsLimit: 2,
  },
  pro: {
    requestsPerMinuteLimit: 10,
    requestsPerDayLimit: 50,
    tokensPerRequestInputLimit: 8000,
    tokensPerRequestOutputLimit: 4000,
    concurrentRequestsLimit: 2,
  },
  business: {
    requestsPerMinuteLimit: 10,
    requestsPerDayLimit: 100,
    tokensPerRequestInputLimit: 8000,
    tokensPerRequestOutputLimit: 4000,
    concurrentRequestsLimit: 2,
  },
  enterprise: {
    requestsPerMinuteLimit: 15,
    requestsPerDayLimit: 150,
    tokensPerRequestInputLimit: 16000,
    tokensPerRequestOutputLimit: 8000,
    concurrentRequestsLimit: 4,
  },
};

function toGitHubTier(value: unknown): GitHubCopilotTier {
  if (value === "free" || value === "pro" || value === "business" || value === "enterprise") {
    return value;
  }

  return "free";
}

function getSecondsUntilPacificMidnight(): number {
  // Firestore daily quota resets at midnight Pacific Time.
  const now = new Date();
  const tz = "America/Los_Angeles";
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = dateFmt.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const month = parseInt(parts.find((p) => p.type === "month")!.value, 10) - 1;
  const day = parseInt(parts.find((p) => p.type === "day")!.value, 10);
  const probe = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  const pacificHourAtProbe = parseInt(hourFmt.format(probe), 10);
  const offsetHours = 12 - pacificHourAtProbe;
  // Next Pacific midnight = UTC midnight of the NEXT Pacific date
  const nextDayPacificMidnightMs = Date.UTC(year, month, day + 1) + offsetHours * 3600 * 1000;
  return Math.max(0, Math.floor((nextDayPacificMidnightMs - now.getTime()) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function usePacificMidnightCountdown(): { secondsLeft: number; timeString: string } {
  const [secondsLeft, setSecondsLeft] = React.useState(getSecondsUntilPacificMidnight);
  React.useEffect(() => {
    const tick = (): void => { setSecondsLeft(getSecondsUntilPacificMidnight()); };
    const id = window.setInterval(tick, 1000);
    return () => { window.clearInterval(id); };
  }, []);
  return { secondsLeft, timeString: formatCountdown(secondsLeft) };
}

function parsePositiveIntegerInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function parsePositiveNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function formatInputNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function getNumericInputWidth(value: number | null | undefined, minimumDigits = 7): string {
  const digitCount = formatInputNumber(value).length;
  const widthDigits = Math.max(minimumDigits, digitCount || minimumDigits);
  return `${widthDigits + 1}ch`;
}

function truncateMessage(value: string, maxLength = 110): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function formatShortDateTime(value: string | null): string {
  if (!value) {
    return "n/a";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "n/a";
  }

  return new Date(parsed).toLocaleString();
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return code.includes("permission-denied") || message.includes("permission-denied") || message.includes("permission denied");
}

function isRetryableCallableError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";

  return (
    code.includes("permission-denied")
    || code.includes("internal")
    || code.includes("unavailable")
    || code.includes("deadline-exceeded")
    || message.includes("permission-denied")
    || message.includes("permission denied")
    || message.includes("internal")
    || message.includes("unavailable")
    || message.includes("deadline-exceeded")
  );
}

function describeAiLimitsLoadError(error: unknown): string {
  if (isPermissionDeniedError(error)) {
    return "AI provider limits are restricted to super admins.";
  }

  if (isRetryableCallableError(error)) {
    return "AI provider limits are temporarily unavailable. Refresh and try again.";
  }

  return "Unable to load AI provider limits right now.";
}

async function retrySuperAdminCallable<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (!isRetryableCallableError(error)) {
      throw error;
    }

    const user = getCurrentUser();
    if (user) {
      try {
        await user.getIdToken(true);
      } catch {
        // Token refresh is best-effort before one retry.
      }
    }

    return loader();
  }
}

export function SuperAdminPage({ onBack }: SuperAdminPageProps): React.JSX.Element {
  const currentUserEmail = useAuthStore((state) => state.userEmail);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const addSyncDebugEvent = useUIStore((state) => state.addSyncDebugEvent);
  const liveSyncReadCount = useUIStore((state) => state.readCount);
  const liveSyncWriteCount = useUIStore((state) => state.writeCount);
  const pacificResetCountdown = usePacificMidnightCountdown();
  const [users, setUsers] = React.useState<AdminUserRecord[]>([]);
  const [schools, setSchools] = React.useState<SchoolDirectoryRow[]>([]);
  const [promotions, setPromotions] = React.useState<PromotionRequestRow[]>([]);
  const [stats, setStats] = React.useState<SuperAdminDashboardStats | null>(null);
  const [globalQuota, setGlobalQuota] = React.useState<SuperAdminGlobalQuota | null>(null);
  const [azureQuota, setAzureQuota] = React.useState<SuperAdminAzureQuota | null>(null);
  const [backupConfig, setBackupConfig] = React.useState<SuperAdminBackupConfig | null>(null);
  const [backupJobs, setBackupJobs] = React.useState<SuperAdminBackupJob[]>([]);
  const [expandedBackupCards, setExpandedBackupCards] = React.useState<Record<string, boolean>>({});
  const [backupFrequencyInput, setBackupFrequencyInput] = React.useState("240");
  const [isRunningBackup, setIsRunningBackup] = React.useState(false);
  const [aiProviderLimits, setAiProviderLimits] = React.useState<SuperAdminAiProviderLimits | null>(null);
  const [aiLimitsError, setAiLimitsError] = React.useState<string | null>(null);
  const [dailyAiRequestLimitInput, setDailyAiRequestLimitInput] = React.useState("");
  const [dailyAiTokenLimitInput, setDailyAiTokenLimitInput] = React.useState("");
  const [monthlyAiBudgetInput, setMonthlyAiBudgetInput] = React.useState("");
  const [monthlyAiSpendInput, setMonthlyAiSpendInput] = React.useState("");
  const [aiBudgetWarnPctInput, setAiBudgetWarnPctInput] = React.useState("");
  const [aiBudgetHardPctInput, setAiBudgetHardPctInput] = React.useState("");
  const [githubTierInput, setGitHubTierInput] = React.useState<GitHubCopilotTier>("free");
  const [githubDailyRequestLimitInput, setGitHubDailyRequestLimitInput] = React.useState("");
  const [githubDailyTokenLimitInput, setGitHubDailyTokenLimitInput] = React.useState("");
  const [githubRequestsPerMinuteLimitInput, setGitHubRequestsPerMinuteLimitInput] = React.useState("");
  const [githubTokensPerRequestInputLimitInput, setGitHubTokensPerRequestInputLimitInput] = React.useState("");
  const [githubTokensPerRequestOutputLimitInput, setGitHubTokensPerRequestOutputLimitInput] = React.useState("");
  const [githubConcurrentRequestsLimitInput, setGitHubConcurrentRequestsLimitInput] = React.useState("");
  const [targetUserUidInput, setTargetUserUidInput] = React.useState("");
  const [targetUserDailyRequestLimitInput, setTargetUserDailyRequestLimitInput] = React.useState("");
  const [targetUserDailyTokenLimitInput, setTargetUserDailyTokenLimitInput] = React.useState("");
  const [targetUserMonthlyBudgetInput, setTargetUserMonthlyBudgetInput] = React.useState("");
  const [targetUserGithubDailyRequestLimitInput, setTargetUserGithubDailyRequestLimitInput] = React.useState("");
  const [targetUserGithubDailyTokenLimitInput, setTargetUserGithubDailyTokenLimitInput] = React.useState("");
  const [showManualOverrides, setShowManualOverrides] = React.useState(false);
  const [showAiPolicyEditor, setShowAiPolicyEditor] = React.useState(false);
  const [showGitHubServiceEditor, setShowGitHubServiceEditor] = React.useState(false);
  const [showAiUserOverrideEditor, setShowAiUserOverrideEditor] = React.useState(false);
  const [quotaOverrides, setQuotaOverrides] = React.useState<SuperAdminQuotaOverrides>(() => {
    if (typeof window === "undefined") {
      return {
        readLimitPerDay: null,
        writeLimitPerDay: null,
        deleteLimitPerDay: null,
        functionInvocationsLimitPerMonth: null,
      };
    }

    try {
      const raw = window.localStorage.getItem(SUPER_ADMIN_QUOTA_OVERRIDES_KEY);
      if (!raw) {
        return {
          readLimitPerDay: null,
          writeLimitPerDay: null,
          deleteLimitPerDay: null,
          functionInvocationsLimitPerMonth: null,
        };
      }

      const parsed = JSON.parse(raw) as Partial<SuperAdminQuotaOverrides>;
      return {
        readLimitPerDay: typeof parsed.readLimitPerDay === "number" ? parsed.readLimitPerDay : null,
        writeLimitPerDay: typeof parsed.writeLimitPerDay === "number" ? parsed.writeLimitPerDay : null,
        deleteLimitPerDay: typeof parsed.deleteLimitPerDay === "number" ? parsed.deleteLimitPerDay : null,
        functionInvocationsLimitPerMonth:
          typeof parsed.functionInvocationsLimitPerMonth === "number"
            ? parsed.functionInvocationsLimitPerMonth
            : null,
      };
    } catch {
      return {
        readLimitPerDay: null,
        writeLimitPerDay: null,
        deleteLimitPerDay: null,
        functionInvocationsLimitPerMonth: null,
      };
    }
  });
  const [isLoading, setIsLoading] = React.useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [isCurrentUsageGateOpen, setIsCurrentUsageGateOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  const loadAll = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setAiLimitsError(null);
    addSyncDebugEvent("superadmin:dashboard-load:start");
    try {
      const currentUser = getCurrentUser();
      if (currentUser) {
        try {
          await currentUser.getIdToken(true);
        } catch {
          // Claim refresh is best-effort; the callable retry path still handles failures.
        }
      }

      let statsPromise: Promise<SuperAdminDashboardStats>;
      if (isSuperAdmin) {
        let shouldEmitRetrySuccess = false;
        statsPromise = retrySuperAdminCallable(async () => {
          try {
            return await getSuperAdminDashboardStats();
          } catch (error) {
            if (isPermissionDeniedError(error)) {
              addSyncDebugEvent("superadmin:dashboard-stats:permission-denied-retry:start");
              shouldEmitRetrySuccess = true;
            } else if (isRetryableCallableError(error)) {
              addSyncDebugEvent("superadmin:dashboard-stats:retryable-error-retry:start");
              shouldEmitRetrySuccess = true;
            }

            throw error;
          }
        }).then((value) => {
          if (shouldEmitRetrySuccess) {
            addSyncDebugEvent("superadmin:dashboard-stats:permission-denied-retry:success");
          }
          return value;
        });
      } else {
        statsPromise = getSuperAdminDashboardStats();
      }

      const promotionsPromise = retrySuperAdminCallable(() => listSchoolAdminPromotionRequests("pending"));

      const [statsResult, usersResult, textbooksResult, schoolsResult, promotionsResult, quotaResult, azureQuotaResult, backupConfigResult, backupJobsResult, aiLimitsResult] = await Promise.allSettled([
        statsPromise,
        getAllUsers(),
        getAllTextbooksAdmin({ collectionName: "textbooks" }),
        listAllSchoolsForSuperAdmin(),
        promotionsPromise,
        getSuperAdminGlobalQuota(),
        getSuperAdminAzureQuota(),
        getSuperAdminBackupConfig(),
        listSuperAdminBackupJobs(12),
        getSuperAdminAiProviderLimits(),
      ]);

      const failures: string[] = [];

      if (statsResult.status === "fulfilled") {
        setStats(statsResult.value);
        addSyncDebugEvent(
          `superadmin:dashboard-stats:loaded users=${statsResult.value.usersCount} schools=${statsResult.value.schoolsCount} textbooks=${statsResult.value.textbooksCount}`
        );
      } else {
        failures.push(`stats: ${statsResult.reason instanceof Error ? statsResult.reason.message : String(statsResult.reason)}`);
        addSyncDebugEvent(
          `superadmin:dashboard-stats:failed ${statsResult.reason instanceof Error ? statsResult.reason.message : String(statsResult.reason)}`
        );
        const fallbackStats: SuperAdminDashboardStats = {
          usersCount: usersResult.status === "fulfilled" ? usersResult.value.length : 0,
          schoolsCount: schoolsResult.status === "fulfilled" ? schoolsResult.value.length : 0,
          textbooksCount: textbooksResult.status === "fulfilled" ? textbooksResult.value.length : 0,
          pendingPromotionRequests: promotionsResult.status === "fulfilled" ? promotionsResult.value.length : 0,
          trackedReadsToday: 0,
          trackedWritesToday: 0,
          trackedAiRequestsToday: 0,
          trackedAiBucketHitsToday: 0,
        };
        setStats(fallbackStats);
      }

      if (usersResult.status === "fulfilled") {
        setUsers(usersResult.value);
      } else {
        failures.push(`users: ${usersResult.reason instanceof Error ? usersResult.reason.message : String(usersResult.reason)}`);
      }

      if (textbooksResult.status !== "fulfilled") {
        failures.push(`textbooks: ${textbooksResult.reason instanceof Error ? textbooksResult.reason.message : String(textbooksResult.reason)}`);
      }

      if (schoolsResult.status === "fulfilled") {
        setSchools(schoolsResult.value);
      } else {
        failures.push(`schools: ${schoolsResult.reason instanceof Error ? schoolsResult.reason.message : String(schoolsResult.reason)}`);
      }

      if (promotionsResult.status === "fulfilled") {
        setPromotions(promotionsResult.value);
      } else {
        failures.push(`promotions: ${promotionsResult.reason instanceof Error ? promotionsResult.reason.message : String(promotionsResult.reason)}`);
      }

      if (quotaResult.status === "fulfilled") {
        setGlobalQuota(quotaResult.value);
      } else {
        failures.push(`quota: ${quotaResult.reason instanceof Error ? quotaResult.reason.message : String(quotaResult.reason)}`);
      }

      if (azureQuotaResult.status === "fulfilled") {
        setAzureQuota(azureQuotaResult.value);
      } else {
        failures.push(`azure quota: ${azureQuotaResult.reason instanceof Error ? azureQuotaResult.reason.message : String(azureQuotaResult.reason)}`);
      }

      if (backupConfigResult.status === "fulfilled") {
        setBackupConfig(backupConfigResult.value);
        setBackupFrequencyInput(String(backupConfigResult.value.frequencyMinutes));
      } else {
        failures.push(`backup config: ${backupConfigResult.reason instanceof Error ? backupConfigResult.reason.message : String(backupConfigResult.reason)}`);
      }

      if (backupJobsResult.status === "fulfilled") {
        setBackupJobs(backupJobsResult.value);
      } else {
        failures.push(`backup jobs: ${backupJobsResult.reason instanceof Error ? backupJobsResult.reason.message : String(backupJobsResult.reason)}`);
      }

      if (aiLimitsResult.status === "fulfilled") {
        setAiProviderLimits(aiLimitsResult.value);
        setAiLimitsError(null);
        setDailyAiRequestLimitInput(formatInputNumber(aiLimitsResult.value.policy.defaultDailyRequestLimit));
        setDailyAiTokenLimitInput(formatInputNumber(aiLimitsResult.value.policy.defaultDailyTokenLimit));
        setMonthlyAiBudgetInput(
          typeof aiLimitsResult.value.policy.defaultMonthlyBudgetUsd === "number"
            ? String(aiLimitsResult.value.policy.defaultMonthlyBudgetUsd)
            : ""
        );
        setMonthlyAiSpendInput(
          typeof aiLimitsResult.value.policy.openAiMonthlySpendUsd === "number"
            ? String(aiLimitsResult.value.policy.openAiMonthlySpendUsd)
            : ""
        );
        setAiBudgetWarnPctInput(String(aiLimitsResult.value.policy.budgetAlertThresholdPct));
        setAiBudgetHardPctInput(String(aiLimitsResult.value.policy.budgetHardStopThresholdPct));
        setGitHubTierInput(toGitHubTier(aiLimitsResult.value.policy.githubCopilotTier));
        setGitHubDailyRequestLimitInput(formatInputNumber(aiLimitsResult.value.policy.githubDailyRequestLimit));
        setGitHubDailyTokenLimitInput(formatInputNumber(aiLimitsResult.value.policy.githubDailyTokenLimit));
        setGitHubRequestsPerMinuteLimitInput(formatInputNumber(aiLimitsResult.value.policy.githubRequestsPerMinuteLimit));
        setGitHubTokensPerRequestInputLimitInput(formatInputNumber(aiLimitsResult.value.policy.githubTokensPerRequestInputLimit));
        setGitHubTokensPerRequestOutputLimitInput(formatInputNumber(aiLimitsResult.value.policy.githubTokensPerRequestOutputLimit));
        setGitHubConcurrentRequestsLimitInput(formatInputNumber(aiLimitsResult.value.policy.githubConcurrentRequestsLimit));
      } else {
        setAiProviderLimits(null);
        const aiErrorMessage = describeAiLimitsLoadError(aiLimitsResult.reason);
        setAiLimitsError(aiErrorMessage);
        addSyncDebugEvent(`superadmin:ai-limits:failed ${aiErrorMessage}`);
      }

      if (failures.length > 0) {
        console.error("[super-admin] dashboard partial load failure", failures);
        setError(`Some dashboard data failed to load (${failures.join(" | ")}).`);
        addSyncDebugEvent(`superadmin:dashboard-load:partial-failure ${failures.join(" | ")}`);
      } else {
        addSyncDebugEvent("superadmin:dashboard-load:success");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load super admin dashboard.");
      addSyncDebugEvent(`superadmin:dashboard-load:error ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setHasLoadedOnce(true);
      setIsLoading(false);
    }
  }, [addSyncDebugEvent, isSuperAdmin]);

  async function handleSaveGlobalAiPolicy(): Promise<void> {
    const defaultDailyRequestLimit = parsePositiveIntegerInput(dailyAiRequestLimitInput);
    const defaultDailyTokenLimit = parsePositiveIntegerInput(dailyAiTokenLimitInput);
    const defaultMonthlyBudgetUsd = parsePositiveNumberInput(monthlyAiBudgetInput);
    const openAiMonthlySpendUsd = monthlyAiSpendInput.trim() ? parsePositiveNumberInput(monthlyAiSpendInput) : null;
    const budgetAlertThresholdPct = parsePositiveNumberInput(aiBudgetWarnPctInput);
    const budgetHardStopThresholdPct = parsePositiveNumberInput(aiBudgetHardPctInput);

    const githubDailyRequestLimit = parsePositiveIntegerInput(githubDailyRequestLimitInput);
    const githubDailyTokenLimit = parsePositiveIntegerInput(githubDailyTokenLimitInput);
    const githubRequestsPerMinuteLimit = parsePositiveIntegerInput(githubRequestsPerMinuteLimitInput);
    const githubTokensPerRequestInputLimit = parsePositiveIntegerInput(githubTokensPerRequestInputLimitInput);
    const githubTokensPerRequestOutputLimit = parsePositiveIntegerInput(githubTokensPerRequestOutputLimitInput);
    const githubConcurrentRequestsLimit = parsePositiveIntegerInput(githubConcurrentRequestsLimitInput);

    if (
      !defaultDailyRequestLimit
      || !defaultDailyTokenLimit
      || defaultMonthlyBudgetUsd === null
      || !budgetAlertThresholdPct
      || !budgetHardStopThresholdPct
      || !githubDailyRequestLimit
      || !githubDailyTokenLimit
      || !githubRequestsPerMinuteLimit
      || !githubTokensPerRequestInputLimit
      || !githubTokensPerRequestOutputLimit
      || !githubConcurrentRequestsLimit
    ) {
      setError("AI policy values must be positive numbers.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const nextPolicy = await setGlobalAiSafetyPolicy({
        defaultDailyRequestLimit,
        defaultDailyTokenLimit,
        defaultMonthlyBudgetUsd,
        openAiMonthlySpendUsd,
        githubCopilotTier: githubTierInput,
        githubDailyRequestLimit,
        githubDailyTokenLimit,
        githubRequestsPerMinuteLimit,
        githubTokensPerRequestInputLimit,
        githubTokensPerRequestOutputLimit,
        githubConcurrentRequestsLimit,
        budgetAlertThresholdPct,
        budgetHardStopThresholdPct,
      });
      setStatus(`Saved AI safety policy (updated by ${nextPolicy.updatedBy || "admin"}).`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save AI policy.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveUserAiOverride(): Promise<void> {
    const uid = targetUserUidInput.trim();
    if (!uid) {
      setError("Target user UID is required for AI override updates.");
      return;
    }

    const dailyRequestLimit = targetUserDailyRequestLimitInput.trim() ? parsePositiveIntegerInput(targetUserDailyRequestLimitInput) : null;
    const dailyTokenLimit = targetUserDailyTokenLimitInput.trim() ? parsePositiveIntegerInput(targetUserDailyTokenLimitInput) : null;
    const monthlyBudgetUsd = targetUserMonthlyBudgetInput.trim() ? parsePositiveNumberInput(targetUserMonthlyBudgetInput) : null;
    const githubDailyRequestLimit = targetUserGithubDailyRequestLimitInput.trim() ? parsePositiveIntegerInput(targetUserGithubDailyRequestLimitInput) : null;
    const githubDailyTokenLimit = targetUserGithubDailyTokenLimitInput.trim() ? parsePositiveIntegerInput(targetUserGithubDailyTokenLimitInput) : null;

    if (
      (targetUserDailyRequestLimitInput.trim() && !dailyRequestLimit)
      || (targetUserDailyTokenLimitInput.trim() && !dailyTokenLimit)
      || (targetUserMonthlyBudgetInput.trim() && monthlyBudgetUsd === null)
      || (targetUserGithubDailyRequestLimitInput.trim() && !githubDailyRequestLimit)
      || (targetUserGithubDailyTokenLimitInput.trim() && !githubDailyTokenLimit)
    ) {
      setError("User override values must be positive numbers when provided.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await setUserAiSafetyOverride({
        uid,
        dailyRequestLimit,
        dailyTokenLimit,
        monthlyBudgetUsd,
        githubDailyRequestLimit,
        githubDailyTokenLimit,
      });
      setStatus(`Saved AI safety override for ${uid}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save user AI override.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveBackupConfig(): Promise<void> {
    if (!backupConfig) {
      return;
    }

    const frequencyMinutes = parsePositiveIntegerInput(backupFrequencyInput);
    if (!frequencyMinutes) {
      setError("Backup frequency must be a positive integer number of minutes.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const next = await setSuperAdminBackupConfig({
        primaryDb: backupConfig.primaryDb,
        mirrorEnabled: backupConfig.mirrorEnabled,
        firestoreEnabled: backupConfig.firestoreEnabled,
        cosmosEnabled: backupConfig.cosmosEnabled,
        backupMode: backupConfig.backupMode,
        frequencyMinutes,
      });
      setBackupConfig(next);
      setBackupFrequencyInput(String(next.frequencyMinutes));
      setStatus("Saved backup configuration.");
      const latestJobs = await listSuperAdminBackupJobs(12);
      setBackupJobs(latestJobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save backup configuration.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRunBackupNow(): Promise<void> {
    setIsRunningBackup(true);
    setError(null);
    setStatus("Backup request received. Starting job...");
    try {
      const result = await runSuperAdminBackupNow();
      setStatus(result.message);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run backup now.");
    } finally {
      setIsRunningBackup(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    const intervalMs = isRunningBackup ? 3000 : 10000;
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const latestJobs = await listSuperAdminBackupJobs(12);
          if (!cancelled) {
            setBackupJobs(latestJobs);
          }
        } catch {
          // Keep polling lightweight; final loadAll() will reconcile state.
        }
      })();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isRunningBackup]);

  function applyGitHubTierPreset(nextTier: GitHubCopilotTier): void {
    const preset = GITHUB_TIER_PRESETS[nextTier];
    setGitHubTierInput(nextTier);
    setGitHubDailyRequestLimitInput(String(preset.requestsPerDayLimit));
    setGitHubDailyTokenLimitInput(String(preset.requestsPerDayLimit * (preset.tokensPerRequestInputLimit + preset.tokensPerRequestOutputLimit)));
    setGitHubRequestsPerMinuteLimitInput(String(preset.requestsPerMinuteLimit));
    setGitHubTokensPerRequestInputLimitInput(String(preset.tokensPerRequestInputLimit));
    setGitHubTokensPerRequestOutputLimitInput(String(preset.tokensPerRequestOutputLimit));
    setGitHubConcurrentRequestsLimitInput(String(preset.concurrentRequestsLimit));
  }

  React.useEffect(() => {
    void loadAll();
  }, [loadAll]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SUPER_ADMIN_QUOTA_OVERRIDES_KEY, JSON.stringify(quotaOverrides));
  }, [quotaOverrides]);

  const effectiveReadLimitPerDay = quotaOverrides.readLimitPerDay
    ?? globalQuota?.readLimitPerDay
    ?? DEFAULT_GLOBAL_READ_LIMIT_PER_DAY;
  const effectiveWriteLimitPerDay = quotaOverrides.writeLimitPerDay
    ?? globalQuota?.writeLimitPerDay
    ?? DEFAULT_GLOBAL_WRITE_LIMIT_PER_DAY;
  const effectiveDeleteLimitPerDay = quotaOverrides.deleteLimitPerDay
    ?? globalQuota?.deleteLimitPerDay
    ?? DEFAULT_GLOBAL_DELETE_LIMIT_PER_DAY;
  const effectiveFunctionInvocationsLimitPerMonth = quotaOverrides.functionInvocationsLimitPerMonth
    ?? globalQuota?.functionInvocationsLimitPerMonth
    ?? DEFAULT_GLOBAL_FUNCTION_INVOCATIONS_LIMIT_PER_MONTH;
  const effectiveAzureRuPerDayLimit = Math.max(1, azureQuota?.requestUnitsPerDayLimit ?? 1);
  const effectiveAzureRuPerSecondLimit = Math.max(1, azureQuota?.requestUnitsPerSecondLimit ?? 1);
  const effectiveAzureStorageGbLimit = Math.max(1, azureQuota?.storageGbLimit ?? 1);

  const backupJobDisplay = React.useMemo(() => {
    if (backupJobs.length === 0) {
      return { latest: null as SuperAdminBackupJob | null, grouped: [] as Array<{ sample: SuperAdminBackupJob; count: number; latestAt: string }> };
    }

    const sorted = [...backupJobs].sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
    const [latest, ...rest] = sorted;
    const groupedMap = new Map<string, { sample: SuperAdminBackupJob; count: number; latestAt: string }>();

    rest.forEach((job) => {
      const signature = `${job.status}|${job.triggeredBy}|${job.message.trim().toLowerCase()}`;
      const existing = groupedMap.get(signature);
      if (!existing) {
        groupedMap.set(signature, { sample: job, count: 1, latestAt: job.startedAt });
        return;
      }

      existing.count += 1;
      if (Date.parse(job.startedAt) > Date.parse(existing.latestAt)) {
        existing.latestAt = job.startedAt;
        existing.sample = job;
      }
    });

    const grouped = Array.from(groupedMap.values())
      .sort((left, right) => Date.parse(right.latestAt) - Date.parse(left.latestAt))
      .slice(0, 5);

    return { latest, grouped };
  }, [backupJobs]);

  function toggleBackupCardExpansion(key: string): void {
    setExpandedBackupCards((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }
  const quotaCurrentReadsToday = globalQuota?.currentReadsToday;
  const quotaCurrentWritesToday = globalQuota?.currentWritesToday;
  const quotaCurrentUsageSource = globalQuota?.currentUsageSource
    ?? (globalQuota?.source === "monitoring" ? "monitoring" : globalQuota?.source === "sync-usage" ? "sync-usage" : "none");

  function resolveCurrentUsageValue(
    quotaValue: number | null | undefined,
    quotaUsageSource: "monitoring" | "sync-usage" | "none",
    statsValue: number | null | undefined,
    syncBudgetValue: number,
  ): CurrentUsageValue | null {
    if (
      quotaUsageSource === "monitoring"
      && typeof quotaValue === "number"
      && Number.isFinite(quotaValue)
      && quotaValue >= 0
    ) {
      return { value: Math.floor(quotaValue), source: "monitoring" };
    }

    const candidates: CurrentUsageValue[] = [];
    if (typeof quotaValue === "number" && Number.isFinite(quotaValue) && quotaValue >= 0) {
      candidates.push({
        value: Math.floor(quotaValue),
        source: quotaUsageSource === "sync-usage" ? "sync-usage" : "quota",
      });
    }

    if (typeof statsValue === "number" && Number.isFinite(statsValue) && statsValue >= 0) {
      candidates.push({ value: Math.floor(statsValue), source: "stats" });
    }

    if (Number.isFinite(syncBudgetValue) && syncBudgetValue >= 0) {
      candidates.push({ value: Math.floor(syncBudgetValue), source: "sync-budget" });
    }

    if (candidates.length === 0) {
      return null;
    }

    let best = candidates[0];
    for (let index = 1; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate.value > best.value) {
        best = candidate;
      }
    }

    return best;
  }

  const resolvedCurrentReads = resolveCurrentUsageValue(
    quotaCurrentReadsToday,
    quotaCurrentUsageSource,
    stats?.trackedReadsToday,
    liveSyncReadCount,
  );
  const resolvedCurrentWrites = resolveCurrentUsageValue(
    quotaCurrentWritesToday,
    quotaCurrentUsageSource,
    stats?.trackedWritesToday,
    liveSyncWriteCount,
  );
  const resolvedCurrentAiRequests = resolveCurrentUsageValue(
    null,
    "none",
    stats?.trackedAiRequestsToday,
    0,
  );
  const resolvedCurrentAiBucketHits = resolveCurrentUsageValue(
    null,
    "none",
    stats?.trackedAiBucketHitsToday,
    0,
  );

  React.useEffect(() => {
    if (!hasLoadedOnce) {
      setIsCurrentUsageGateOpen(false);
      return;
    }

    const resolvedReadValue = resolvedCurrentReads?.value;
    if (typeof resolvedReadValue === "number" && resolvedReadValue > 0) {
      setIsCurrentUsageGateOpen(true);
      return;
    }

    setIsCurrentUsageGateOpen(false);
    const timeoutId = window.setTimeout(() => {
      setIsCurrentUsageGateOpen(true);
      addSyncDebugEvent("superadmin:quota-current-usage:gate-timeout-open");
    }, QUOTA_CURRENT_USAGE_GATE_WAIT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [addSyncDebugEvent, hasLoadedOnce, resolvedCurrentReads?.value]);

  const showReadTelemetryWarning = isCurrentUsageGateOpen && (resolvedCurrentReads?.value ?? 0) <= 0;

  const aiDailyRequestLimit = aiProviderLimits?.policy.defaultDailyRequestLimit ?? 1;
  const aiDailyTokenLimit = aiProviderLimits?.policy.defaultDailyTokenLimit ?? 1000;
  const aiMonthlyBudgetLimit = aiProviderLimits?.policy.defaultMonthlyBudgetUsd ?? 10;
  const aiMonthlySpend = aiProviderLimits?.policy.openAiMonthlySpendUsd ?? 0;
  const githubDailyRequestLimit = aiProviderLimits?.policy.githubDailyRequestLimit ?? aiProviderLimits?.github?.requestsPerDayLimit ?? 1;
  const githubDailyTokenLimit = aiProviderLimits?.policy.githubDailyTokenLimit ?? Math.max(1000, githubDailyRequestLimit * 12000);
  const githubRequestsPerDayUsed = aiProviderLimits?.aggregateToday.githubRequestsToday ?? 0;
  const githubTokensPerDayUsed = aiProviderLimits?.aggregateToday.githubTokensToday ?? 0;
  const githubRateLimitedToday = aiProviderLimits?.aggregateToday.githubRateLimitedToday ?? 0;
  const githubTokensPerRequestBudget = Math.max(
    1,
    (aiProviderLimits?.github?.tokensPerRequestInputLimit ?? aiProviderLimits?.policy.githubTokensPerRequestInputLimit ?? 0)
      + (aiProviderLimits?.github?.tokensPerRequestOutputLimit ?? aiProviderLimits?.policy.githubTokensPerRequestOutputLimit ?? 0),
  );
  const githubAverageTokensPerRequest = githubRequestsPerDayUsed > 0
    ? Math.round(githubTokensPerDayUsed / githubRequestsPerDayUsed)
    : 0;
  const githubDailyRequestPercent = Math.min(999, (githubRequestsPerDayUsed / Math.max(1, githubDailyRequestLimit)) * 100);
  const githubDailyTokenPercent = Math.min(999, (githubTokensPerDayUsed / Math.max(1, githubDailyTokenLimit)) * 100);
  const githubRateLimitObservedAtMs = aiProviderLimits?.githubStatus?.observedAt
    ? Date.parse(aiProviderLimits.githubStatus.observedAt)
    : Number.NaN;
  const githubRetryAfterUntilMs = aiProviderLimits?.githubStatus?.retryAfterUntil
    ? Date.parse(aiProviderLimits.githubStatus.retryAfterUntil)
    : Number.NaN;
  const githubRetryAfterSeconds = aiProviderLimits?.githubStatus?.retryAfterSeconds ?? null;
  const githubRetryAfterRemainingSeconds = Number.isFinite(githubRetryAfterUntilMs)
    ? Math.max(0, Math.ceil((githubRetryAfterUntilMs - Date.now()) / 1000))
    : (aiProviderLimits?.githubStatus?.isRateLimited && typeof githubRetryAfterSeconds === "number" && githubRetryAfterSeconds > 0 && Number.isFinite(githubRateLimitObservedAtMs))
      ? Math.max(0, githubRetryAfterSeconds - Math.floor((Date.now() - githubRateLimitObservedAtMs) / 1000))
      : 0;
  const showGitHubRetryAfterCountdown = githubRetryAfterRemainingSeconds > 0;
  const openAiRequestsPerDayUsed = aiProviderLimits?.aggregateToday.openAiRequestsToday ?? 0;
  const openAiTokensPerDayUsed = aiProviderLimits?.aggregateToday.openAiTokensToday ?? 0;
  const openAiRateLimitedToday = aiProviderLimits?.aggregateToday.openAiRateLimitedToday ?? 0;

  async function handlePromotionResolution(requestId: string, approve: boolean): Promise<void> {
    setIsSaving(true);
    setError(null);
    try {
      const message = await resolveSchoolAdminPromotionRequest({ requestId, approve });
      setStatus(message);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resolve promotion request.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAdminToggle(uid: string, isAdmin: boolean): Promise<void> {
    const targetUser = users.find((user) => user.uid === uid);
    const targetLabel = targetUser?.email || uid;
    if (!isAdmin) {
      const confirmed = window.confirm(`Revoke admin access for ${targetLabel}?`);
      if (!confirmed) {
        return;
      }
    }

    setIsSaving(true);
    setError(null);
    try {
      const message = await setUserAdminStatus(uid, isAdmin);
      setStatus(message);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change admin role.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSuperAdminToggle(uid: string, isSuperAdmin: boolean): Promise<void> {
    const targetUser = users.find((user) => user.uid === uid);
    const targetLabel = targetUser?.email || uid;

    let transferToUid: string | undefined;
    if (!isSuperAdmin) {
      const candidates = users.filter((user) => user.uid !== uid);
      if (candidates.length === 0) {
        setError("Unable to transfer super admin: no other users are available.");
        return;
      }

      const candidateList = candidates
        .map((user) => `${user.email} (${user.uid})`)
        .join("\n");
      const input = window.prompt(
        `Transfer super admin from ${targetLabel} to which user UID?\n\n${candidateList}\n\nEnter target UID:`
      );
      if (input === null) {
        return;
      }

      const nextUid = input.trim();
      const transferTarget = candidates.find((user) => user.uid === nextUid);
      if (!transferTarget) {
        setError("Transfer target must be a valid user UID listed in the table.");
        return;
      }

      const confirmed = window.confirm(`Transfer super admin from ${targetLabel} to ${transferTarget.email}?`);
      if (!confirmed) {
        return;
      }

      transferToUid = transferTarget.uid;
    }

    setIsSaving(true);
    setError(null);
    try {
      const message = await setUserSuperAdminStatus(uid, isSuperAdmin, transferToUid);
      setStatus(message);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change super admin role.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header__left">
          <button type="button" onClick={onBack} className="btn-secondary admin-back-btn">← Back to App</button>
          <h1 className="admin-title">Super Admin</h1>
        </div>
        {!hasLoadedOnce ? (
          <SkeletonBlock width="160px" height="18px" />
        ) : (
          <p className="admin-user-label">Signed in as {currentUserEmail ?? "super admin"}</p>
        )}
      </header>

      {!hasLoadedOnce && isLoading ? (
        <div className="cf-page-skeleton">
          <div className="cf-page-skeleton__section">
            <div className="cf-stats-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <SkeletonBlock key={i} height="96px" borderRadius="10px" />
              ))}
            </div>
          </div>
          <SkeletonBlock height="300px" borderRadius="8px" className=" cf-page-skeleton__section" />
          <SkeletonBlock height="160px" borderRadius="8px" className=" cf-page-skeleton__section" />
          <SkeletonBlock height="200px" borderRadius="8px" className=" cf-page-skeleton__section" />
          <SkeletonBlock height="200px" borderRadius="8px" className=" cf-page-skeleton__section" />
        </div>
      ) : (
        <>
      <section className="admin-section">
        <div className="admin-section__header">
          <h3>Global Stats</h3>
          <button type="button" className="btn-secondary" onClick={() => { void loadAll(); }} disabled={isLoading}>
            {isLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <div className="cf-stats-grid">
          <StatCard
            error={hasLoadedOnce && stats === null}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-7 9a7 7 0 1 1 14 0H3Z" />
              </svg>
            }
            label="Total Users"
            value={stats?.usersCount}
            accentColor="var(--cf-accent)"
          />
          <StatCard
            error={hasLoadedOnce && stats === null}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path fillRule="evenodd" d="M4 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12H4V4Zm2 0v12h8V4H6Zm1 2h2v2H7V6Zm4 0h2v2h-2V6ZM7 10h2v2H7v-2Zm4 0h2v2h-2v-2Z" clipRule="evenodd" />
              </svg>
            }
            label="Total Schools"
            value={stats?.schoolsCount}
            accentColor="hsl(210, 80%, 52%)"
          />
          <StatCard
            error={hasLoadedOnce && stats === null}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path d="M9 4.804A7.968 7.968 0 0 0 5.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 0 1 5.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0 1 14.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0 0 14.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 1 1-2 0V4.804Z" />
              </svg>
            }
            label="Total Textbooks"
            value={stats?.textbooksCount}
            accentColor="hsl(260, 72%, 55%)"
          />
          <StatCard
            error={hasLoadedOnce && stats === null}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
              </svg>
            }
            label="Pending Promotions"
            value={stats?.pendingPromotionRequests}
            accentColor={
              (stats?.pendingPromotionRequests ?? 0) > 0 ? "var(--cf-warning)" : "var(--cf-success)"
            }
          />
          <StatCard
            error={hasLoadedOnce && stats === null}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41Z" clipRule="evenodd" />
              </svg>
            }
            label="Tracked Reads Today"
            value={resolvedCurrentReads?.value}
            loading={!hasLoadedOnce || !isCurrentUsageGateOpen}
            accentColor="hsl(190, 78%, 45%)"
          />
          <StatCard
            error={hasLoadedOnce && stats === null}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path d="M2.695 14.763l-1.262 3.154a.5.5 0 0 0 .65.65l3.155-1.262a4 4 0 0 0 1.343-.885L17.5 5.5a2.121 2.121 0 0 0-3-3L3.58 13.42a4 4 0 0 0-.885 1.343Z" />
              </svg>
            }
            label="Tracked Writes Today"
            value={resolvedCurrentWrites?.value}
            loading={!hasLoadedOnce || !isCurrentUsageGateOpen}
            accentColor="hsl(30, 82%, 52%)"
          />
          <StatCard
            error={hasLoadedOnce && stats === null}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path fillRule="evenodd" d="M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v4A2.5 2.5 0 0 1 14.5 12H11l-2.5 2.5V12h-3A2.5 2.5 0 0 1 3 9.5v-4Zm2.5-.5a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 .5.5h3.5v1.086L10.086 10H14.5a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5h-9Z" clipRule="evenodd" />
              </svg>
            }
            label="AI Requests Today"
            value={resolvedCurrentAiRequests?.value}
            loading={!hasLoadedOnce}
            accentColor="hsl(155, 70%, 42%)"
          />
          <StatCard
            error={hasLoadedOnce && stats === null}
            icon={
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
                <path d="M10 3a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0V8H7a1 1 0 0 1 0-2h2V4a1 1 0 0 1 1-1Z" />
                <path fillRule="evenodd" d="M4 11a6 6 0 1 1 12 0v4a1 1 0 0 1-1 1h-2.5l-1.5 1.5V16H8a4 4 0 0 1-4-4v-1Z" clipRule="evenodd" />
              </svg>
            }
            label="AI Bucket Hits Today"
            value={resolvedCurrentAiBucketHits?.value}
            loading={!hasLoadedOnce}
            accentColor="hsl(270, 70%, 58%)"
          />
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>AI Provider Limits (OpenAI + GitHub Models)</h3>
        </div>
        {aiProviderLimits ? (
          <div className="cf-quota-dashboard">
            <div className="cf-quota-left">
              <CountdownBadge
                secondsLeft={pacificResetCountdown.secondsLeft}
                timeString={pacificResetCountdown.timeString}
                loading={!hasLoadedOnce}
                titleText="AI safety limits reset at midnight Pacific Time."
                labelText="Until AI daily reset (Pacific)"
              />

              <div className="cf-quota-meta-row">
                <span>Provider: <strong>{aiProviderLimits.provider.toUpperCase()}</strong></span>
                <span>Captured: <strong>{new Date(aiProviderLimits.capturedAt).toLocaleString()}</strong></span>
                <span>
                  Aggregate today: <strong>{aiProviderLimits.aggregateToday.aiRequestsToday}</strong> req,
                  <strong> {aiProviderLimits.aggregateToday.aiTokensToday}</strong> tokens,
                  <strong> {aiProviderLimits.aggregateToday.providerRateLimitedToday}</strong> rate-limit events
                </span>
                <span>
                  GitHub tier: <strong>{(aiProviderLimits.github?.tier ?? toGitHubTier(aiProviderLimits.policy.githubCopilotTier)).toUpperCase()}</strong>
                </span>
              </div>

              <div className="cf-quota-item" style={{ gap: "0.6rem" }}>
                <h4>GitHub Models Service</h4>
                <CountdownBadge
                  secondsLeft={pacificResetCountdown.secondsLeft}
                  timeString={pacificResetCountdown.timeString}
                  loading={!hasLoadedOnce}
                  titleText="GitHub Models limits roll over at midnight Pacific Time."
                  labelText="Until GitHub daily reset (Pacific)"
                />
                <div className="cf-quota-meta-row" style={{ marginTop: "0.15rem" }}>
                  <span
                    style={{
                      background: githubDailyRequestPercent >= 90 ? "rgba(202, 64, 42, 0.16)" : githubDailyRequestPercent >= 75 ? "rgba(196, 134, 36, 0.16)" : "rgba(35, 122, 69, 0.14)",
                      color: githubDailyRequestPercent >= 90 ? "#7f2617" : githubDailyRequestPercent >= 75 ? "#7a4d05" : "#215a37",
                      border: "1px solid var(--border-default)",
                      borderRadius: "999px",
                      padding: "0.18rem 0.55rem",
                    }}
                  >
                    Request load: <strong>{githubDailyRequestPercent.toFixed(1)}%</strong>
                  </span>
                  <span
                    style={{
                      background: githubDailyTokenPercent >= 90 ? "rgba(202, 64, 42, 0.16)" : githubDailyTokenPercent >= 75 ? "rgba(196, 134, 36, 0.16)" : "rgba(35, 122, 69, 0.14)",
                      color: githubDailyTokenPercent >= 90 ? "#7f2617" : githubDailyTokenPercent >= 75 ? "#7a4d05" : "#215a37",
                      border: "1px solid var(--border-default)",
                      borderRadius: "999px",
                      padding: "0.18rem 0.55rem",
                    }}
                  >
                    Token load: <strong>{githubDailyTokenPercent.toFixed(1)}%</strong>
                  </span>
                  <span
                    style={{
                      background: githubRateLimitedToday > 0 ? "rgba(202, 64, 42, 0.16)" : "rgba(35, 122, 69, 0.14)",
                      color: githubRateLimitedToday > 0 ? "#7f2617" : "#215a37",
                      border: "1px solid var(--border-default)",
                      borderRadius: "999px",
                      padding: "0.18rem 0.55rem",
                    }}
                  >
                    Rate-limit hits: <strong>{githubRateLimitedToday}</strong>
                  </span>
                </div>

                {showGitHubRetryAfterCountdown ? (
                  <CountdownBadge
                    secondsLeft={githubRetryAfterRemainingSeconds}
                    timeString={formatCountdown(githubRetryAfterRemainingSeconds)}
                    loading={!hasLoadedOnce}
                    titleText="GitHub provider returned a Retry-After window; this timer tracks when the next batch can be retried."
                    labelText="GitHub Retry-After cooldown"
                  />
                ) : null}

                <div className="cf-quota-rings-grid">
                  <ProgressRing
                    value={githubRequestsPerDayUsed}
                    max={githubDailyRequestLimit}
                    label="GitHub Requests / Day"
                    loading={!hasLoadedOnce}
                  />
                  <ProgressRing
                    value={githubTokensPerDayUsed}
                    max={githubDailyTokenLimit}
                    label="GitHub Tokens / Day"
                    loading={!hasLoadedOnce}
                  />
                  <ProgressRing
                    value={githubAverageTokensPerRequest}
                    max={githubTokensPerRequestBudget}
                    label="Avg Tokens / Request"
                    loading={!hasLoadedOnce}
                  />
                  <ProgressRing
                    value={githubRateLimitedToday}
                    max={Math.max(1, githubDailyRequestLimit)}
                    label="GitHub Rate-Limits / Day"
                    loading={!hasLoadedOnce}
                  />
                </div>

                <div className={`cf-quota-overrides${showGitHubServiceEditor ? "" : " cf-quota-overrides--collapsed"}`}>
                  <div className="cf-quota-overrides__header">
                    <p className="cf-quota-overrides__title">GitHub Models Limits</p>
                    <button
                      type="button"
                      className="btn-secondary cf-quota-overrides__toggle"
                      onClick={() => { setShowGitHubServiceEditor((current) => !current); }}
                    >
                      {showGitHubServiceEditor ? "Hide GitHub Limits" : "Show GitHub Limits"}
                    </button>
                  </div>
                  {!showGitHubServiceEditor ? (
                    <p className="cf-quota-overrides__collapsed-note">
                      Hidden by default. Unhide to adjust GitHub Models limits and tier presets.
                    </p>
                  ) : (
                    <div className="cf-quota-overrides__grid">
                      <div className="cf-quota-overrides__field">
                        <label htmlFor="cf-ai-policy-github-tier">GitHub Copilot tier preset</label>
                        <select
                          id="cf-ai-policy-github-tier"
                          value={githubTierInput}
                          disabled={isSaving}
                          onChange={(event) => { applyGitHubTierPreset(event.target.value as GitHubCopilotTier); }}
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="business">Business</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                      </div>
                      <div className="cf-quota-overrides__field">
                        <label htmlFor="cf-ai-policy-github-rpd">GitHub requests / day</label>
                        <input
                          id="cf-ai-policy-github-rpd"
                          type="number"
                          min={1}
                          disabled={isSaving}
                          value={githubDailyRequestLimitInput}
                          onChange={(event) => setGitHubDailyRequestLimitInput(event.target.value)}
                        />
                      </div>
                      <div className="cf-quota-overrides__field">
                        <label htmlFor="cf-ai-policy-github-daily-tokens">GitHub tokens / day</label>
                        <input
                          id="cf-ai-policy-github-daily-tokens"
                          type="number"
                          min={1}
                          disabled={isSaving}
                          value={githubDailyTokenLimitInput}
                          onChange={(event) => setGitHubDailyTokenLimitInput(event.target.value)}
                        />
                      </div>
                      <div className="cf-quota-overrides__field">
                        <label htmlFor="cf-ai-policy-github-rpm">GitHub requests / minute</label>
                        <input
                          id="cf-ai-policy-github-rpm"
                          type="number"
                          min={1}
                          disabled={isSaving}
                          value={githubRequestsPerMinuteLimitInput}
                          onChange={(event) => setGitHubRequestsPerMinuteLimitInput(event.target.value)}
                        />
                      </div>
                      <div className="cf-quota-overrides__field">
                        <label htmlFor="cf-ai-policy-github-token-in">GitHub tokens/request (input)</label>
                        <input
                          id="cf-ai-policy-github-token-in"
                          type="number"
                          min={1}
                          disabled={isSaving}
                          value={githubTokensPerRequestInputLimitInput}
                          onChange={(event) => setGitHubTokensPerRequestInputLimitInput(event.target.value)}
                        />
                      </div>
                      <div className="cf-quota-overrides__field">
                        <label htmlFor="cf-ai-policy-github-token-out">GitHub tokens/request (output)</label>
                        <input
                          id="cf-ai-policy-github-token-out"
                          type="number"
                          min={1}
                          disabled={isSaving}
                          value={githubTokensPerRequestOutputLimitInput}
                          onChange={(event) => setGitHubTokensPerRequestOutputLimitInput(event.target.value)}
                        />
                      </div>
                      <div className="cf-quota-overrides__field">
                        <label htmlFor="cf-ai-policy-github-concurrency">GitHub concurrent requests</label>
                        <input
                          id="cf-ai-policy-github-concurrency"
                          type="number"
                          min={1}
                          disabled={isSaving}
                          value={githubConcurrentRequestsLimitInput}
                          onChange={(event) => setGitHubConcurrentRequestsLimitInput(event.target.value)}
                        />
                      </div>
                      <div className="cf-quota-overrides__actions">
                        <button type="button" className="btn-secondary" onClick={() => { void handleSaveGlobalAiPolicy(); }} disabled={isSaving}>
                          {isSaving ? "Saving..." : "Save GitHub Limits"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={`cf-quota-overrides${showAiPolicyEditor ? "" : " cf-quota-overrides--collapsed"}`}>
                <div className="cf-quota-overrides__header">
                  <p className="cf-quota-overrides__title">Global AI Safety Policy</p>
                  <button
                    type="button"
                    className="btn-secondary cf-quota-overrides__toggle"
                    onClick={() => { setShowAiPolicyEditor((current) => !current); }}
                  >
                    {showAiPolicyEditor ? "Hide AI Policy" : "Show AI Policy"}
                  </button>
                </div>
                {!showAiPolicyEditor ? (
                  <p className="cf-quota-overrides__collapsed-note">
                    Hidden by default. Unhide to review or update global AI safety values.
                  </p>
                ) : (
                  <div className="cf-quota-overrides__grid">
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-policy-daily-requests">Daily requests / user</label>
                      <input
                        id="cf-ai-policy-daily-requests"
                        type="number"
                        min={1}
                        disabled={isSaving}
                        style={{ width: getNumericInputWidth(Number(dailyAiRequestLimitInput || 0), 6) }}
                        value={dailyAiRequestLimitInput}
                        onChange={(event) => setDailyAiRequestLimitInput(event.target.value)}
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-policy-daily-tokens">Daily tokens / user</label>
                      <input
                        id="cf-ai-policy-daily-tokens"
                        type="number"
                        min={1}
                        disabled={isSaving}
                        style={{ width: getNumericInputWidth(Number(dailyAiTokenLimitInput || 0), 7) }}
                        value={dailyAiTokenLimitInput}
                        onChange={(event) => setDailyAiTokenLimitInput(event.target.value)}
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-policy-monthly-budget">Monthly budget (USD)</label>
                      <input
                        id="cf-ai-policy-monthly-budget"
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={isSaving}
                        style={{ width: getNumericInputWidth(Number(monthlyAiBudgetInput || 0), 6) }}
                        value={monthlyAiBudgetInput}
                        onChange={(event) => setMonthlyAiBudgetInput(event.target.value)}
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-policy-monthly-spend">Current spend (USD)</label>
                      <input
                        id="cf-ai-policy-monthly-spend"
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={isSaving}
                        style={{ width: getNumericInputWidth(Number(monthlyAiSpendInput || 0), 6) }}
                        value={monthlyAiSpendInput}
                        onChange={(event) => setMonthlyAiSpendInput(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-policy-warn">Warn threshold (%)</label>
                      <input
                        id="cf-ai-policy-warn"
                        type="number"
                        min={1}
                        step="0.1"
                        disabled={isSaving}
                        style={{ width: getNumericInputWidth(Number(aiBudgetWarnPctInput || 0), 5) }}
                        value={aiBudgetWarnPctInput}
                        onChange={(event) => setAiBudgetWarnPctInput(event.target.value)}
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-policy-hard-stop">Hard-stop threshold (%)</label>
                      <input
                        id="cf-ai-policy-hard-stop"
                        type="number"
                        min={1}
                        step="0.1"
                        disabled={isSaving}
                        style={{ width: getNumericInputWidth(Number(aiBudgetHardPctInput || 0), 5) }}
                        value={aiBudgetHardPctInput}
                        onChange={(event) => setAiBudgetHardPctInput(event.target.value)}
                      />
                    </div>
                    <div className="cf-quota-overrides__actions">
                      <button type="button" className="btn-secondary" onClick={() => { void handleSaveGlobalAiPolicy(); }} disabled={isSaving}>
                        {isSaving ? "Saving..." : "Save Global AI Policy"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className={`cf-quota-overrides${showAiUserOverrideEditor ? "" : " cf-quota-overrides--collapsed"}`}>
                <div className="cf-quota-overrides__header">
                  <p className="cf-quota-overrides__title">Per-User AI Override</p>
                  <button
                    type="button"
                    className="btn-secondary cf-quota-overrides__toggle"
                    onClick={() => { setShowAiUserOverrideEditor((current) => !current); }}
                  >
                    {showAiUserOverrideEditor ? "Hide User AI Override" : "Show User AI Override"}
                  </button>
                </div>
                {!showAiUserOverrideEditor ? (
                  <p className="cf-quota-overrides__collapsed-note">
                    Hidden by default. Unhide to target a user and apply override limits.
                  </p>
                ) : (
                  <div className="cf-quota-overrides__grid">
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-override-uid">User UID</label>
                      <input
                        id="cf-ai-override-uid"
                        value={targetUserUidInput}
                        disabled={isSaving}
                        onChange={(event) => setTargetUserUidInput(event.target.value)}
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-override-requests">Daily requests / user</label>
                      <input
                        id="cf-ai-override-requests"
                        type="number"
                        min={1}
                        disabled={isSaving}
                        value={targetUserDailyRequestLimitInput}
                        onChange={(event) => setTargetUserDailyRequestLimitInput(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-override-tokens">Daily tokens / user</label>
                      <input
                        id="cf-ai-override-tokens"
                        type="number"
                        min={1}
                        disabled={isSaving}
                        value={targetUserDailyTokenLimitInput}
                        onChange={(event) => setTargetUserDailyTokenLimitInput(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-override-budget">Monthly budget / user (USD)</label>
                      <input
                        id="cf-ai-override-budget"
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={isSaving}
                        value={targetUserMonthlyBudgetInput}
                        onChange={(event) => setTargetUserMonthlyBudgetInput(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-override-github-rpd">GitHub requests / day / user</label>
                      <input
                        id="cf-ai-override-github-rpd"
                        type="number"
                        min={1}
                        disabled={isSaving}
                        value={targetUserGithubDailyRequestLimitInput}
                        onChange={(event) => setTargetUserGithubDailyRequestLimitInput(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="cf-quota-overrides__field">
                      <label htmlFor="cf-ai-override-github-tokens">GitHub tokens / day / user</label>
                      <input
                        id="cf-ai-override-github-tokens"
                        type="number"
                        min={1}
                        disabled={isSaving}
                        value={targetUserGithubDailyTokenLimitInput}
                        onChange={(event) => setTargetUserGithubDailyTokenLimitInput(event.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="cf-quota-overrides__actions">
                      <button type="button" className="btn-secondary" onClick={() => { void handleSaveUserAiOverride(); }} disabled={isSaving}>
                        {isSaving ? "Saving..." : "Save User Override"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="cf-quota-right">
              <div className="cf-quota-rings-grid">
                <ProgressRing
                  value={openAiRequestsPerDayUsed}
                  max={aiDailyRequestLimit}
                  label="OpenAI Requests / Day"
                  loading={!hasLoadedOnce}
                />
                <ProgressRing
                  value={openAiTokensPerDayUsed}
                  max={aiDailyTokenLimit}
                  label="OpenAI Tokens / Day"
                  loading={!hasLoadedOnce}
                />
                <ProgressRing
                  value={aiMonthlySpend}
                  max={Math.max(1, aiMonthlyBudgetLimit)}
                  label="OpenAI Budget / Month"
                  loading={!hasLoadedOnce}
                />
                <ProgressRing
                  value={openAiRateLimitedToday}
                  max={Math.max(1, aiDailyRequestLimit)}
                  label="OpenAI Rate-Limits / Day"
                  loading={!hasLoadedOnce}
                />
              </div>

              <div className="cf-quota-right__items">
                {aiProviderLimits.models.length === 0 ? (
                  <p className="settings-meta">No OpenAI header snapshots captured yet. Run at least one cloud request to populate live limits.</p>
                ) : (
                  aiProviderLimits.models.map((modelSnapshot) => (
                    <div key={modelSnapshot.model} className="cf-quota-item">
                      <h4>{modelSnapshot.model}</h4>
                      <p>
                        RPM: {modelSnapshot.requestsPerMinuteRemaining ?? "?"} / {modelSnapshot.requestsPerMinuteLimit ?? "?"}
                        {modelSnapshot.requestsResetIn ? ` • reset ${modelSnapshot.requestsResetIn}` : ""}
                      </p>
                      <p>
                        TPM: {modelSnapshot.tokensPerMinuteRemaining ?? "?"} / {modelSnapshot.tokensPerMinuteLimit ?? "?"}
                        {modelSnapshot.tokensResetIn ? ` • reset ${modelSnapshot.tokensResetIn}` : ""}
                      </p>
                      <p>
                        Window usage: requests {typeof modelSnapshot.requestWindowUsedPercent === "number" ? `${modelSnapshot.requestWindowUsedPercent.toFixed(1)}%` : "n/a"},
                        tokens {typeof modelSnapshot.tokenWindowUsedPercent === "number" ? `${modelSnapshot.tokenWindowUsedPercent.toFixed(1)}%` : "n/a"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : aiLimitsError ? (
          <p className="error-text">{aiLimitsError}</p>
        ) : (
          <p className="settings-meta">AI provider limits are loading...</p>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>Global Firestore Quota (Super Admin)</h3>
        </div>
        <div className="cf-quota-dashboard">
          {/* ── Left column: countdown + metadata + overrides ── */}
          <div className="cf-quota-left">
            <CountdownBadge
              secondsLeft={pacificResetCountdown.secondsLeft}
              timeString={pacificResetCountdown.timeString}
              loading={!hasLoadedOnce}
            />

            {hasLoadedOnce ? (
              <div className="cf-quota-meta-row">
                <span>Project: <strong>{globalQuota?.projectId || "courseforge-prod"}</strong></span>
                <span>Source: <strong>{globalQuota?.source ?? "fallback"}</strong></span>
                {globalQuota?.fetchedAt ? (
                  <span>Fetched: <strong>{new Date(globalQuota.fetchedAt).toLocaleString()}</strong></span>
                ) : null}
              </div>
            ) : (
              <SkeletonBlock height="52px" borderRadius="8px" />
            )}

            <div className={`cf-quota-overrides${showManualOverrides ? "" : " cf-quota-overrides--collapsed"}`}>
              <div className="cf-quota-overrides__header">
                <p className="cf-quota-overrides__title">Manual Overrides</p>
                <button
                  type="button"
                  className="btn-secondary cf-quota-overrides__toggle"
                  onClick={() => { setShowManualOverrides((current) => !current); }}
                >
                  {showManualOverrides ? "Hide" : "Unhide"}
                </button>
              </div>
              {!showManualOverrides ? (
                <p className="cf-quota-overrides__collapsed-note">
                  Hidden by default. Use Unhide to edit limits or reset overrides.
                </p>
              ) : !hasLoadedOnce ? (
                <div style={{ display: "grid", gap: "0.55rem" }}>
                  <SkeletonBlock height="52px" borderRadius="6px" />
                  <SkeletonBlock height="52px" borderRadius="6px" />
                  <SkeletonBlock height="52px" borderRadius="6px" />
                  <SkeletonBlock height="52px" borderRadius="6px" />
                </div>
              ) : (
                <div className="cf-quota-overrides__grid">
                  <div className="cf-quota-overrides__field">
                    <label htmlFor="cf-override-reads">Read limit / day</label>
                    <input
                      id="cf-override-reads"
                      type="number"
                      min={1}
                      disabled={isSaving}
                      style={{ width: getNumericInputWidth(quotaOverrides.readLimitPerDay) }}
                      value={formatInputNumber(quotaOverrides.readLimitPerDay)}
                      onChange={(event) => {
                        const next = parsePositiveIntegerInput(event.target.value);
                        setQuotaOverrides((current) => ({ ...current, readLimitPerDay: next }));
                      }}
                      placeholder={String(globalQuota?.readLimitPerDay ?? DEFAULT_GLOBAL_READ_LIMIT_PER_DAY)}
                    />
                  </div>
                  <div className="cf-quota-overrides__field">
                    <label htmlFor="cf-override-writes">Write limit / day</label>
                    <input
                      id="cf-override-writes"
                      type="number"
                      min={1}
                      disabled={isSaving}
                      style={{ width: getNumericInputWidth(quotaOverrides.writeLimitPerDay) }}
                      value={formatInputNumber(quotaOverrides.writeLimitPerDay)}
                      onChange={(event) => {
                        const next = parsePositiveIntegerInput(event.target.value);
                        setQuotaOverrides((current) => ({ ...current, writeLimitPerDay: next }));
                      }}
                      placeholder={String(globalQuota?.writeLimitPerDay ?? DEFAULT_GLOBAL_WRITE_LIMIT_PER_DAY)}
                    />
                  </div>
                  <div className="cf-quota-overrides__field">
                    <label htmlFor="cf-override-deletes">Delete limit / day</label>
                    <input
                      id="cf-override-deletes"
                      type="number"
                      min={1}
                      disabled={isSaving}
                      style={{ width: getNumericInputWidth(quotaOverrides.deleteLimitPerDay) }}
                      value={formatInputNumber(quotaOverrides.deleteLimitPerDay)}
                      onChange={(event) => {
                        const next = parsePositiveIntegerInput(event.target.value);
                        setQuotaOverrides((current) => ({ ...current, deleteLimitPerDay: next }));
                      }}
                      placeholder={String(globalQuota?.deleteLimitPerDay ?? DEFAULT_GLOBAL_DELETE_LIMIT_PER_DAY)}
                    />
                  </div>
                  <div className="cf-quota-overrides__field">
                    <label htmlFor="cf-override-functions">Functions invocations / month</label>
                    <input
                      id="cf-override-functions"
                      type="number"
                      min={1}
                      disabled={isSaving}
                      style={{ width: getNumericInputWidth(quotaOverrides.functionInvocationsLimitPerMonth) }}
                      value={formatInputNumber(quotaOverrides.functionInvocationsLimitPerMonth)}
                      onChange={(event) => {
                        const next = parsePositiveIntegerInput(event.target.value);
                        setQuotaOverrides((current) => ({ ...current, functionInvocationsLimitPerMonth: next }));
                      }}
                      placeholder={String(globalQuota?.functionInvocationsLimitPerMonth ?? DEFAULT_GLOBAL_FUNCTION_INVOCATIONS_LIMIT_PER_MONTH)}
                    />
                  </div>
                  <div className="cf-quota-overrides__actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={isSaving}
                      onClick={() => {
                        setQuotaOverrides({
                          readLimitPerDay: null,
                          writeLimitPerDay: null,
                          deleteLimitPerDay: null,
                          functionInvocationsLimitPerMonth: null,
                        });
                        setStatus("Quota overrides reset to API/fallback defaults.");
                      }}
                    >
                      Reset Overrides
                    </button>
                    <p className="admin-note" style={{ margin: 0, fontSize: "0.78rem" }}>
                      Leave blank to use live API value or fallback default. Saved locally on this device.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {showReadTelemetryWarning ? (
              <p className="error-text">Read telemetry is still 0 after load. Live read usage did not hydrate correctly.</p>
            ) : null}
          </div>

          {/* ── Right column: 4 progress rings ── */}
          <div className="cf-quota-rings-grid">
            <ProgressRing
              value={resolvedCurrentReads?.value ?? 0}
              max={effectiveReadLimitPerDay}
              label="Reads / Day"
              sublabel={isCurrentUsageGateOpen ? resolvedCurrentReads?.source : undefined}
              loading={!hasLoadedOnce || !isCurrentUsageGateOpen}
            />
            <ProgressRing
              value={resolvedCurrentWrites?.value ?? 0}
              max={effectiveWriteLimitPerDay}
              label="Writes / Day"
              sublabel={isCurrentUsageGateOpen ? resolvedCurrentWrites?.source : undefined}
              loading={!hasLoadedOnce || !isCurrentUsageGateOpen}
            />
            <ProgressRing
              value={0}
              max={effectiveDeleteLimitPerDay}
              label="Deletes / Day"
              loading={!hasLoadedOnce}
            />
            <ProgressRing
              value={0}
              max={effectiveFunctionInvocationsLimitPerMonth}
              label="Functions / Month"
              loading={!hasLoadedOnce}
            />
          </div>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>Azure Cosmos DB Quota (Super Admin)</h3>
        </div>
        <div className="cf-quota-dashboard">
          <div className="cf-quota-left">
            <CountdownBadge
              secondsLeft={pacificResetCountdown.secondsLeft}
              timeString={pacificResetCountdown.timeString}
              loading={!hasLoadedOnce}
              titleText="Azure usage counters are interpreted on the same daily reset cadence used by app telemetry."
              labelText="Azure telemetry reset cadence"
            />

            {hasLoadedOnce ? (
              <div className="cf-quota-meta-row">
                <span>Project: <strong>{azureQuota?.projectId || "courseforge-prod"}</strong></span>
                <span>Source: <strong>{azureQuota?.source ?? "fallback"}</strong></span>
                <span>Configured: <strong>{azureQuota?.configured ? "yes" : "no"}</strong></span>
                <span>Mirror enabled: <strong>{azureQuota?.mirrorEnabled ? "yes" : "no"}</strong></span>
                <span>DB/Container: <strong>{azureQuota?.databaseId ?? "courseforge"}</strong>/<strong>{azureQuota?.containerId ?? "textbooks"}</strong></span>
                {azureQuota?.fetchedAt ? (
                  <span>Fetched: <strong>{new Date(azureQuota.fetchedAt).toLocaleString()}</strong></span>
                ) : null}
              </div>
            ) : (
              <SkeletonBlock height="52px" borderRadius="8px" />
            )}

            {azureQuota?.message ? <p className="settings-meta">{azureQuota.message}</p> : null}
          </div>

          <div className="cf-quota-rings-grid">
            <ProgressRing
              value={azureQuota?.currentRequestUnitsToday ?? 0}
              max={effectiveAzureRuPerDayLimit}
              label="Azure RU / Day"
              loading={!hasLoadedOnce}
            />
            <ProgressRing
              value={azureQuota?.currentWritesToday ?? 0}
              max={effectiveAzureRuPerSecondLimit}
              label="Azure Writes / Day"
              loading={!hasLoadedOnce}
            />
            <ProgressRing
              value={azureQuota?.currentReadsToday ?? 0}
              max={effectiveAzureRuPerSecondLimit}
              label="Azure Reads / Day"
              loading={!hasLoadedOnce}
            />
            <ProgressRing
              value={0}
              max={effectiveAzureStorageGbLimit}
              label="Azure Storage GB"
              loading={!hasLoadedOnce}
            />
          </div>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>Backup & Failover Controls</h3>
        </div>

        <div className="cf-quota-dashboard" style={{ marginBottom: "0.9rem" }}>
          <div className="cf-quota-left">
            <div className="cf-quota-meta-row">
              <span>Primary DB: <strong>{backupConfig?.primaryDb ?? "firestore"}</strong></span>
              <span>Mirror: <strong>{backupConfig?.mirrorEnabled ? "enabled" : "disabled"}</strong></span>
              <span>Mode: <strong>{backupConfig?.backupMode ?? "interval"}</strong></span>
              <span>
                Last backup: <strong>{backupConfig?.lastBackupAt ? new Date(backupConfig.lastBackupAt).toLocaleString() : "never"}</strong>
              </span>
              <span>
                Next backup: <strong>{backupConfig?.nextBackupAt ? new Date(backupConfig.nextBackupAt).toLocaleString() : "n/a"}</strong>
              </span>
            </div>

            <div className="cf-quota-overrides">
              <div className="cf-quota-overrides__grid">
                <div className="cf-quota-overrides__field">
                  <label htmlFor="cf-backup-primary-db">Primary DB</label>
                  <select
                    id="cf-backup-primary-db"
                    disabled={isSaving}
                    value={backupConfig?.primaryDb ?? "firestore"}
                    onChange={(event) => {
                      const next = event.target.value === "cosmos" ? "cosmos" : "firestore";
                      setBackupConfig((current) => current ? { ...current, primaryDb: next } : current);
                    }}
                  >
                    <option value="firestore">Firestore</option>
                    <option value="cosmos">Cosmos</option>
                  </select>
                </div>

                <div className="cf-quota-overrides__field">
                  <label htmlFor="cf-backup-mode">Backup mode</label>
                  <select
                    id="cf-backup-mode"
                    disabled={isSaving}
                    value={backupConfig?.backupMode ?? "interval"}
                    onChange={(event) => {
                      const next = event.target.value === "manual" ? "manual" : "interval";
                      setBackupConfig((current) => current ? { ...current, backupMode: next } : current);
                    }}
                  >
                    <option value="interval">Interval</option>
                    <option value="manual">Manual only</option>
                  </select>
                </div>

                <div className="cf-quota-overrides__field">
                  <label htmlFor="cf-backup-frequency">Backup frequency (minutes)</label>
                  <input
                    id="cf-backup-frequency"
                    type="number"
                    min={15}
                    step={1}
                    disabled={isSaving}
                    value={backupFrequencyInput}
                    onChange={(event) => setBackupFrequencyInput(event.target.value)}
                  />
                </div>

                <div className="cf-quota-overrides__field">
                  <label htmlFor="cf-backup-mirror-enabled">Mirror enabled</label>
                  <select
                    id="cf-backup-mirror-enabled"
                    disabled={isSaving}
                    value={backupConfig?.mirrorEnabled ? "enabled" : "disabled"}
                    onChange={(event) => {
                      const enabled = event.target.value === "enabled";
                      setBackupConfig((current) => current ? { ...current, mirrorEnabled: enabled } : current);
                    }}
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div className="cf-quota-overrides__field">
                  <label htmlFor="cf-backup-firestore-enabled">Firestore availability</label>
                  <select
                    id="cf-backup-firestore-enabled"
                    disabled={isSaving}
                    value={backupConfig?.firestoreEnabled ? "enabled" : "disabled"}
                    onChange={(event) => {
                      const enabled = event.target.value === "enabled";
                      setBackupConfig((current) => current ? { ...current, firestoreEnabled: enabled } : current);
                    }}
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div className="cf-quota-overrides__field">
                  <label htmlFor="cf-backup-cosmos-enabled">Cosmos availability</label>
                  <select
                    id="cf-backup-cosmos-enabled"
                    disabled={isSaving}
                    value={backupConfig?.cosmosEnabled ? "enabled" : "disabled"}
                    onChange={(event) => {
                      const enabled = event.target.value === "enabled";
                      setBackupConfig((current) => current ? { ...current, cosmosEnabled: enabled } : current);
                    }}
                  >
                    <option value="enabled">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div className="cf-quota-overrides__actions">
                  <button type="button" className="btn-secondary" onClick={() => { void handleSaveBackupConfig(); }} disabled={isSaving}>
                    {isSaving ? "Saving..." : "Save Backup Controls"}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => { void handleRunBackupNow(); }} disabled={isRunningBackup || isSaving}>
                    {isRunningBackup ? "Running Backup..." : "Run Backup Now"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="cf-quota-right__scroll-wrap">
            <div className="cf-quota-right__items">
              {backupJobs.length === 0 ? (
                <p className="settings-meta">No backup jobs recorded yet.</p>
              ) : (
                <>
                  {backupJobDisplay.latest ? (() => {
                    const latest = backupJobDisplay.latest;
                    const cardKey = `latest:${latest.id}`;
                    const isExpanded = expandedBackupCards[cardKey] === true;
                    return (
                      <button
                        key={latest.id}
                        type="button"
                        className={`cf-quota-item cf-quota-item--compact${isExpanded ? " cf-quota-item--expanded" : ""}`}
                        onClick={() => toggleBackupCardExpansion(cardKey)}
                        aria-expanded={isExpanded}
                      >
                        <h4>{latest.status.toUpperCase()} · {formatShortDateTime(latest.startedAt)}</h4>
                        <p className="cf-quota-item__glance">
                          by {latest.triggeredBy} • fin {formatShortDateTime(latest.finishedAt)} • s/m/f {latest.docsScanned}/{latest.docsMirrored}/{latest.docsFailed} • ru {latest.requestUnitsUsed.toFixed(2)}
                        </p>
                        <p className="cf-quota-item__hint">{isExpanded ? "Tap to collapse" : "Tap to expand"}</p>
                        {isExpanded ? (
                          <div className="cf-quota-item__detail">
                            <p>Message: {latest.message}</p>
                            <p>Job ID: {latest.id}</p>
                          </div>
                        ) : (
                          <p className="cf-quota-item__detail-preview">{truncateMessage(latest.message, 80)}</p>
                        )}
                      </button>
                    );
                  })() : null}

                  {backupJobDisplay.grouped.map((group) => {
                    const groupedKey = `group:${group.sample.status}:${group.sample.triggeredBy}:${group.sample.message.trim().toLowerCase()}`;
                    const isExpanded = expandedBackupCards[groupedKey] === true;
                    return (
                      <button
                        key={`${group.sample.status}-${group.sample.triggeredBy}-${group.sample.id}`}
                        type="button"
                        className={`cf-quota-item cf-quota-item--compact${isExpanded ? " cf-quota-item--expanded" : ""}`}
                        onClick={() => toggleBackupCardExpansion(groupedKey)}
                        aria-expanded={isExpanded}
                      >
                        <h4>{group.sample.status.toUpperCase()} x{group.count} · {formatShortDateTime(group.latestAt)}</h4>
                        <p className="cf-quota-item__glance">
                          by {group.sample.triggeredBy} • s/m/f {group.sample.docsScanned}/{group.sample.docsMirrored}/{group.sample.docsFailed} • ru {group.sample.requestUnitsUsed.toFixed(2)}
                        </p>
                        <p className="cf-quota-item__hint">{isExpanded ? "Tap to collapse" : "Tap to expand"}</p>
                        {isExpanded ? (
                          <div className="cf-quota-item__detail">
                            <p>Latest message: {group.sample.message}</p>
                            <p>Latest finished: {formatShortDateTime(group.sample.finishedAt)}</p>
                          </div>
                        ) : (
                          <p className="cf-quota-item__detail-preview">{truncateMessage(group.sample.message, 80)}</p>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
            <div className="cf-quota-right__fade" aria-hidden="true" />
          </div>
        </div>

        <div className="admin-section__header">
          <h3>School Admin Promotion Requests</h3>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>User</th>
              <th>School</th>
              <th>Reason</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {promotions.map((request) => (
              <tr key={request.id}>
                <td>{request.displayName || request.email} ({request.email})</td>
                <td>{request.schoolName}</td>
                <td>{request.reason || "-"}</td>
                <td>{request.createdAt ? new Date(request.createdAt).toLocaleString() : "-"}</td>
                <td>
                  <button type="button" className="btn-primary-sm" onClick={() => { void handlePromotionResolution(request.id, true); }} disabled={isSaving}>Approve</button>
                  <button type="button" className="btn-danger-sm" onClick={() => { void handlePromotionResolution(request.id, false); }} disabled={isSaving}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>Global User Roles</h3>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Admin</th>
              <th>Super Admin</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.uid}>
                <td>{user.email}</td>
                <td>{user.displayName || "-"}</td>
                <td>{user.isAdmin ? "Yes" : "No"}</td>
                <td>{user.isSuperAdmin ? "Yes" : "No"}</td>
                <td>
                  <button type="button" className="btn-secondary" onClick={() => { void handleAdminToggle(user.uid, !user.isAdmin); }} disabled={isSaving}>
                    {user.isAdmin ? "Revoke Admin" : "Promote Admin"}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => { void handleSuperAdminToggle(user.uid, !user.isSuperAdmin); }} disabled={isSaving}>
                    {user.isSuperAdmin ? "Transfer Super" : "Promote Super"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>Schools / Districts</h3>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>School</th>
              <th>District</th>
              <th>Members</th>
            </tr>
          </thead>
          <tbody>
            {schools.map((school) => (
              <tr key={school.schoolId}>
                <td>{school.schoolName}</td>
                <td>{school.districtName ?? "-"}</td>
                <td>{school.memberCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {status ? <p className="cf-toast cf-toast--success">{status}</p> : null}
      {error ? <p className="cf-toast cf-toast--error">{error}</p> : null}
        </>
      )}
    </div>
  );
}

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
  type PromotionRequestRow,
  type SchoolDirectoryRow,
  type SuperAdminDashboardStats,
  type SuperAdminGlobalQuota,
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

function formatInputNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function getNumericInputWidth(value: number | null | undefined, minimumDigits = 7): string {
  const digitCount = formatInputNumber(value).length;
  const widthDigits = Math.max(minimumDigits, digitCount || minimumDigits);
  return `${widthDigits + 1}ch`;
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
  const [showManualOverrides, setShowManualOverrides] = React.useState(false);
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

      const [statsResult, usersResult, textbooksResult, schoolsResult, promotionsResult, quotaResult] = await Promise.allSettled([
        statsPromise,
        getAllUsers(),
        getAllTextbooksAdmin({ collectionName: "textbooks" }),
        listAllSchoolsForSuperAdmin(),
        promotionsPromise,
        getSuperAdminGlobalQuota(),
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
        </div>
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

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

function usePacificMidnightCountdown(): string {
  const [secondsLeft, setSecondsLeft] = React.useState(getSecondsUntilPacificMidnight);
  React.useEffect(() => {
    const tick = (): void => { setSecondsLeft(getSecondsUntilPacificMidnight()); };
    const id = window.setInterval(tick, 1000);
    return () => { window.clearInterval(id); };
  }, []);
  return formatCountdown(secondsLeft);
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
  const [currentUsageLoadingFrame, setCurrentUsageLoadingFrame] = React.useState(0);
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

  React.useEffect(() => {
    if (isCurrentUsageGateOpen) {
      setCurrentUsageLoadingFrame(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setCurrentUsageLoadingFrame((frame) => (frame + 1) % 4);
    }, 300);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isCurrentUsageGateOpen]);

  function formatCurrentUsageDisplay(currentValue: CurrentUsageValue | null): string {
    if (!isCurrentUsageGateOpen) {
      return `Fetching${".".repeat(currentUsageLoadingFrame + 1)}`;
    }

    if (!currentValue) {
      return "-";
    }

    if (currentValue.source === "monitoring") {
      return `${currentValue.value.toLocaleString()} (from Cloud Monitoring)`;
    }

    if (currentValue.source === "quota") {
      return currentValue.value.toLocaleString();
    }

    if (currentValue.source === "sync-usage") {
      return `${currentValue.value.toLocaleString()} (from backend sync telemetry)`;
    }

    if (currentValue.source === "stats") {
      return `${currentValue.value.toLocaleString()} (from stats)`;
    }

    return `${currentValue.value.toLocaleString()} (from local sync budget)`;
  }

  const quotaCurrentReadsDisplay = formatCurrentUsageDisplay(resolvedCurrentReads);
  const quotaCurrentWritesDisplay = formatCurrentUsageDisplay(resolvedCurrentWrites);
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
    setIsSaving(true);
    setError(null);
    try {
      const message = await setUserSuperAdminStatus(uid, isSuperAdmin);
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
        <p className="admin-user-label">Signed in as {currentUserEmail ?? "super admin"}</p>
      </header>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>Global Stats</h3>
          <button type="button" className="btn-secondary" onClick={() => { void loadAll(); }} disabled={isLoading}>
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
        <div className="metadata-training-grid">
          <p className="settings-meta">Users: <strong>{stats?.usersCount ?? 0}</strong></p>
          <p className="settings-meta">Schools: <strong>{stats?.schoolsCount ?? 0}</strong></p>
          <p className="settings-meta">Textbooks: <strong>{stats?.textbooksCount ?? 0}</strong></p>
          <p className="settings-meta">Pending promotions: <strong>{stats?.pendingPromotionRequests ?? 0}</strong></p>
          <p className="settings-meta">Tracked reads today: <strong>{stats?.trackedReadsToday ?? 0}</strong></p>
          <p className="settings-meta">Tracked writes today: <strong>{stats?.trackedWritesToday ?? 0}</strong></p>
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>Global Firestore Quota (Super Admin)</h3>
          <span className="admin-note" style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>
            Daily reset in <strong>{pacificResetCountdown}</strong> (midnight Pacific Time)
          </span>
        </div>
        <div className="metadata-training-grid">
          <p className="settings-meta">Source: <strong>{globalQuota?.source ?? "fallback"}</strong></p>
          <p className="settings-meta">Project: <strong>{globalQuota?.projectId || "courseforge-prod"}</strong></p>
          <p className="settings-meta">Read limit/day: <strong>{effectiveReadLimitPerDay.toLocaleString()}</strong></p>
          <p className="settings-meta">Write limit/day: <strong>{effectiveWriteLimitPerDay.toLocaleString()}</strong></p>
          <p className="settings-meta">Delete limit/day: <strong>{effectiveDeleteLimitPerDay.toLocaleString()}</strong></p>
          <p className="settings-meta">Functions invocations/month: <strong>{effectiveFunctionInvocationsLimitPerMonth.toLocaleString()}</strong></p>
          <p className="settings-meta">Current reads today: <strong>{quotaCurrentReadsDisplay}</strong></p>
          <p className="settings-meta">Current writes today: <strong>{quotaCurrentWritesDisplay}</strong></p>
          <p className="settings-meta">Fetched at: <strong>{globalQuota?.fetchedAt ? new Date(globalQuota.fetchedAt).toLocaleString() : "-"}</strong></p>
        </div>
        <div className="admin-filter-bar" style={{ marginTop: "0.75rem" }}>
          <label>
            Read limit/day
            <input
              type="number"
              min={1}
              value={formatInputNumber(quotaOverrides.readLimitPerDay)}
              onChange={(event) => {
                const next = parsePositiveIntegerInput(event.target.value);
                setQuotaOverrides((current) => ({ ...current, readLimitPerDay: next }));
              }}
              placeholder={String(globalQuota?.readLimitPerDay ?? DEFAULT_GLOBAL_READ_LIMIT_PER_DAY)}
            />
          </label>
          <label>
            Write limit/day
            <input
              type="number"
              min={1}
              value={formatInputNumber(quotaOverrides.writeLimitPerDay)}
              onChange={(event) => {
                const next = parsePositiveIntegerInput(event.target.value);
                setQuotaOverrides((current) => ({ ...current, writeLimitPerDay: next }));
              }}
              placeholder={String(globalQuota?.writeLimitPerDay ?? DEFAULT_GLOBAL_WRITE_LIMIT_PER_DAY)}
            />
          </label>
          <label>
            Delete limit/day
            <input
              type="number"
              min={1}
              value={formatInputNumber(quotaOverrides.deleteLimitPerDay)}
              onChange={(event) => {
                const next = parsePositiveIntegerInput(event.target.value);
                setQuotaOverrides((current) => ({ ...current, deleteLimitPerDay: next }));
              }}
              placeholder={String(globalQuota?.deleteLimitPerDay ?? DEFAULT_GLOBAL_DELETE_LIMIT_PER_DAY)}
            />
          </label>
          <label>
            Functions invocations/month
            <input
              type="number"
              min={1}
              value={formatInputNumber(quotaOverrides.functionInvocationsLimitPerMonth)}
              onChange={(event) => {
                const next = parsePositiveIntegerInput(event.target.value);
                setQuotaOverrides((current) => ({ ...current, functionInvocationsLimitPerMonth: next }));
              }}
              placeholder={String(globalQuota?.functionInvocationsLimitPerMonth ?? DEFAULT_GLOBAL_FUNCTION_INVOCATIONS_LIMIT_PER_MONTH)}
            />
          </label>
        </div>
        <p className="admin-note">
          Leave a field blank to use the live API value (or fallback default). Changes are saved locally on this device for super-admin tuning.
        </p>
        {showReadTelemetryWarning ? (
          <p className="error-text">Read telemetry is still 0 after load. This indicates live read usage did not hydrate correctly.</p>
        ) : null}
        <div className="admin-section__header" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          <div />
          <button
            type="button"
            className="btn-secondary"
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
            Reset Quota Overrides
          </button>
        </div>
        {globalQuota?.message ? <p className="admin-note">{globalQuota.message}</p> : null}
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
                    {user.isSuperAdmin ? "Revoke Super" : "Promote Super"}
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

      {status ? <p className="settings-meta">{status}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

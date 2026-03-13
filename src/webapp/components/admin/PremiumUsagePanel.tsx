import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { AdminPremiumUsageRow } from "../../../core/services";
import {
  MONTHLY_BASELINE_PERCENT,
  getDefaultDailyLimitPercent,
  getDefaultWeeklyLimitPercent,
  getPremiumUsageReport,
  managePremiumUser,
} from "../../../core/services";
import { useUIStore } from "../../store/uiStore";

const AUTO_REFRESH_MS = 15000;

function toPercent(used: number, limit: number): string {
  if (limit <= 0) {
    return "0.0";
  }

  return ((used / limit) * 100).toFixed(1);
}

export function PremiumUsagePanel(): React.JSX.Element {
  const [rows, setRows] = useState<AdminPremiumUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [pendingUids, setPendingUids] = useState<Set<string>>(new Set());

  const syncStatus = useUIStore((state) => state.syncStatus);
  const lastSyncTime = useUIStore((state) => state.lastSyncTime);

  const projectedRemainingMonth = useMemo(() => {
    if (rows.length === 0) {
      return "0.0";
    }

    const monthly = rows.reduce((sum, row) => sum + row.premiumUsage.premiumRequestsUsedThisMonth, 0);
    const limits = rows.reduce((sum, row) => sum + row.premiumUsage.monthlyLimitPercent, 0);
    const remaining = Math.max(0, limits - monthly);
    return remaining.toFixed(1);
  }, [rows]);

  const loadReport = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const next = await getPremiumUsageReport();
      setRows(next);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load premium usage report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      void loadReport();
    }, AUTO_REFRESH_MS);

    return () => clearInterval(intervalId);
  }, [loadReport]);

  useEffect(() => {
    if (syncStatus === "synced" && lastSyncTime) {
      void loadReport();
    }
  }, [loadReport, lastSyncTime, syncStatus]);

  async function runAction(
    uid: string,
    action: "freeze" | "unfreeze" | "resetDaily" | "resetWeekly" | "resetMonthly",
    freezePremium?: boolean
  ): Promise<void> {
    setPendingUids((prev) => new Set(prev).add(uid));
    try {
      const updated = await managePremiumUser(uid, action, freezePremium);
      setRows((prev) => prev.map((row) => (row.uid === uid ? updated : row)));
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update premium usage.");
    } finally {
      setPendingUids((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <h3>Premium Usage Management</h3>
        <button type="button" onClick={() => void loadReport()} disabled={loading} className="btn-secondary">
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <p className="admin-note">
        Premium usage auto-refreshes on workflow completion and every 15 seconds while this tab is open.
      </p>
      <p className="admin-note">
        Baseline policy: monthly baseline {MONTHLY_BASELINE_PERCENT}% with derived defaults D:{getDefaultDailyLimitPercent()} /
        W:{getDefaultWeeklyLimitPercent()} and monthly cap M:100. Monthly auto-reset runs at local 31st 07:00, or last day
        07:00 when a month has no day 31.
      </p>
      <p className="admin-note">
        Recent premium audit events are currently written to the local Copilot workspace log and are not synced into the browser admin view.
      </p>

      <div className="admin-premium-summary">
        <span>
          Last reset timestamp: <strong>{rows[0]?.premiumUsage.lastResetDate ?? "-"}</strong>
        </span>
        <span>
          Projected remaining monthly budget: <strong>{projectedRemainingMonth}</strong>
        </span>
        <span>
          Last updated: <strong>{lastUpdated ? new Date(lastUpdated).toLocaleString() : "-"}</strong>
        </span>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <table className="admin-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Tier</th>
            <th>Today</th>
            <th>Week</th>
            <th>Month</th>
            <th>Limits</th>
            <th>Frozen</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isPending = pendingUids.has(row.uid);
            const usage = row.premiumUsage;

            return (
              <tr key={row.uid}>
                <td>
                  <strong>{row.email || row.uid}</strong>
                  <div className="admin-meta">{row.displayName || "-"}</div>
                </td>
                <td>{row.premiumTier}</td>
                <td>
                  {usage.premiumRequestsUsedToday} ({toPercent(usage.premiumRequestsUsedToday, usage.dailyLimitPercent)}%)
                </td>
                <td>
                  {usage.premiumRequestsUsedThisWeek} ({toPercent(usage.premiumRequestsUsedThisWeek, usage.weeklyLimitPercent)}%)
                </td>
                <td>
                  {usage.premiumRequestsUsedThisMonth} ({toPercent(usage.premiumRequestsUsedThisMonth, usage.monthlyLimitPercent)}%)
                </td>
                <td>
                  D:{usage.dailyLimitPercent} / W:{usage.weeklyLimitPercent} / M:{usage.monthlyLimitPercent}
                </td>
                <td>{usage.freezePremium ? "Yes" : "No"}</td>
                <td className="admin-premium-actions">
                  {usage.freezePremium ? (
                    <button
                      type="button"
                      className="btn-primary-sm"
                      disabled={isPending}
                      onClick={() => void runAction(row.uid, "unfreeze")}
                    >
                      Unfreeze
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-danger-sm"
                      disabled={isPending}
                      onClick={() => void runAction(row.uid, "freeze", true)}
                    >
                      Freeze
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isPending}
                    onClick={() => void runAction(row.uid, "resetDaily")}
                  >
                    Reset Daily
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isPending}
                    onClick={() => void runAction(row.uid, "resetWeekly")}
                  >
                    Reset Weekly
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isPending}
                    onClick={() => void runAction(row.uid, "resetMonthly")}
                  >
                    Reset Monthly
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

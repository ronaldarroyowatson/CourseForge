import React, { useCallback, useEffect, useState } from "react";

import type { DebugLoggingPolicyRecord, DebugUploadSummary } from "../../../core/services";
import {
  getDebugLoggingPolicyAdmin,
  listRecentDebugUploadsAdmin,
  setDebugLoggingPolicyAdmin,
} from "../../../core/services";

interface PolicyFormState {
  enabledGlobally: boolean;
  maxUploadBytes: string;
  maxLocalLogBytes: string;
  disabledUserIdsCsv: string;
}

function toPolicyForm(policy: DebugLoggingPolicyRecord): PolicyFormState {
  return {
    enabledGlobally: policy.enabledGlobally,
    maxUploadBytes: String(policy.maxUploadBytes),
    maxLocalLogBytes: String(policy.maxLocalLogBytes),
    disabledUserIdsCsv: policy.disabledUserIds.join(", "),
  };
}

export function DebugLoggingPanel(): React.JSX.Element {
  const [policy, setPolicy] = useState<DebugLoggingPolicyRecord | null>(null);
  const [form, setForm] = useState<PolicyFormState>({
    enabledGlobally: true,
    maxUploadBytes: String(500 * 1024),
    maxLocalLogBytes: String(1_500_000),
    disabledUserIdsCsv: "",
  });
  const [uploads, setUploads] = useState<DebugUploadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const [nextPolicy, nextUploads] = await Promise.all([
        getDebugLoggingPolicyAdmin(),
        listRecentDebugUploadsAdmin(),
      ]);

      setPolicy(nextPolicy);
      setForm(toPolicyForm(nextPolicy));
      setUploads(nextUploads);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load debug logging admin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function updateForm<K extends keyof PolicyFormState>(field: K, value: PolicyFormState[K]): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function savePolicy(): Promise<void> {
    try {
      setError(null);
      setStatus(null);
      setIsSaving(true);

      const maxUploadBytes = Number(form.maxUploadBytes);
      const maxLocalLogBytes = Number(form.maxLocalLogBytes);

      if (!Number.isFinite(maxUploadBytes) || maxUploadBytes <= 0) {
        setError("Max upload size must be a positive number.");
        return;
      }

      if (!Number.isFinite(maxLocalLogBytes) || maxLocalLogBytes <= 0) {
        setError("Max local log size must be a positive number.");
        return;
      }

      const disabledUserIds = form.disabledUserIdsCsv
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

      const next = await setDebugLoggingPolicyAdmin({
        enabledGlobally: form.enabledGlobally,
        maxUploadBytes,
        maxLocalLogBytes,
        disabledUserIds,
      });

      setPolicy(next);
      setForm(toPolicyForm(next));
      setStatus("Debug logging policy saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save debug logging policy.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <h3>Debug Logging Controls</h3>
        <button type="button" onClick={() => void loadData()} disabled={loading} className="btn-secondary">
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <p className="admin-note">
        Configure global debug logging behavior, per-user disable list, and payload size limits for cloud uploads.
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}

      <div className="form-grid">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={form.enabledGlobally}
            onChange={(event) => updateForm("enabledGlobally", event.target.checked)}
          />
          Enable Debug Logging Globally
        </label>

        <label>
          Max Upload Size (bytes)
          <input
            type="number"
            value={form.maxUploadBytes}
            onChange={(event) => updateForm("maxUploadBytes", event.target.value)}
          />
        </label>

        <label>
          Max Local Log Size (bytes)
          <input
            type="number"
            value={form.maxLocalLogBytes}
            onChange={(event) => updateForm("maxLocalLogBytes", event.target.value)}
          />
        </label>

        <label>
          Per-User Disable List (comma-separated UIDs)
          <textarea
            rows={4}
            value={form.disabledUserIdsCsv}
            onChange={(event) => updateForm("disabledUserIdsCsv", event.target.value)}
            placeholder="uid-1, uid-2"
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="button" onClick={() => void savePolicy()} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Debug Policy"}
        </button>
      </div>

      <div className="admin-premium-summary">
        <span>
          Last updated by: <strong>{policy?.updatedBy ?? "-"}</strong>
        </span>
        <span>
          Last updated at: <strong>{policy?.updatedAt ? new Date(policy.updatedAt).toLocaleString() : "-"}</strong>
        </span>
      </div>

      <h4>Recent Debug Uploads</h4>
      <table className="admin-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Uploaded</th>
            <th>Entries</th>
            <th>Total Size</th>
            <th>App Version</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody>
          {uploads.map((upload) => (
            <tr key={upload.reportPath}>
              <td>{upload.userId}</td>
              <td>{new Date(upload.uploadedAtMs || Date.parse(upload.createdAt)).toLocaleString()}</td>
              <td>{upload.entriesCount}</td>
              <td>{Math.round(upload.totalSizeBytes / 1024)} KB</td>
              <td>{upload.appVersion ?? "-"}</td>
              <td className="admin-meta">{upload.reportPath}</td>
            </tr>
          ))}
          {uploads.length === 0 ? (
            <tr>
              <td colSpan={6}>No debug uploads found.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

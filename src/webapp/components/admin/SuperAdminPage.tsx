import React from "react";

import {
  getAllUsers,
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
import { useAuthStore } from "../../store/authStore";

interface SuperAdminPageProps {
  onBack: () => void;
}

export function SuperAdminPage({ onBack }: SuperAdminPageProps): React.JSX.Element {
  const currentUserEmail = useAuthStore((state) => state.userEmail);
  const [users, setUsers] = React.useState<AdminUserRecord[]>([]);
  const [schools, setSchools] = React.useState<SchoolDirectoryRow[]>([]);
  const [promotions, setPromotions] = React.useState<PromotionRequestRow[]>([]);
  const [stats, setStats] = React.useState<SuperAdminDashboardStats | null>(null);
  const [globalQuota, setGlobalQuota] = React.useState<SuperAdminGlobalQuota | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  const loadAll = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [statsData, usersData, schoolsData, promotionsData, quotaData] = await Promise.all([
        getSuperAdminDashboardStats(),
        getAllUsers(),
        listAllSchoolsForSuperAdmin(),
        listSchoolAdminPromotionRequests("pending"),
        getSuperAdminGlobalQuota(),
      ]);
      setStats(statsData);
      setUsers(usersData);
      setSchools(schoolsData);
      setPromotions(promotionsData);
      setGlobalQuota(quotaData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load super admin dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadAll();
  }, [loadAll]);

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
        </div>
        <div className="metadata-training-grid">
          <p className="settings-meta">Source: <strong>{globalQuota?.source ?? "-"}</strong></p>
          <p className="settings-meta">Project: <strong>{globalQuota?.projectId || "-"}</strong></p>
          <p className="settings-meta">Read limit/day: <strong>{globalQuota?.readLimitPerDay ?? "Unknown"}</strong></p>
          <p className="settings-meta">Write limit/day: <strong>{globalQuota?.writeLimitPerDay ?? "Unknown"}</strong></p>
          <p className="settings-meta">Fetched at: <strong>{globalQuota?.fetchedAt ? new Date(globalQuota.fetchedAt).toLocaleString() : "-"}</strong></p>
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

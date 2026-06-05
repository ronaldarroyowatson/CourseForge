import React from "react";

import {
  getSchoolAdminDashboard,
  inviteSchoolUser,
  removeSchoolUser,
  requestSchoolAdminPromotion,
  setSchoolTextbookDeletionState,
  type SchoolDashboardData,
} from "../../../core/services";
import { executeGuiCliBoundCommand } from "../../../core/services/guiCliParityService";
import { useAuthStore } from "../../store/authStore";

interface SchoolAdminPageProps {
  onBack: () => void;
  embedded?: boolean;
}

export function SchoolAdminPage({ onBack, embedded = false }: SchoolAdminPageProps): React.JSX.Element {
  const schoolId = useAuthStore((state) => state.schoolId);
  const schoolName = useAuthStore((state) => state.schoolName);
  const currentUserEmail = useAuthStore((state) => state.userEmail);
  const [dashboard, setDashboard] = React.useState<SchoolDashboardData | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = React.useState("");

  const loadDashboard = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSchoolAdminDashboard(schoolId ?? undefined);
      setDashboard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load school admin dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, [schoolId]);

  React.useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleInvite(): Promise<void> {
    if (!inviteEmail.trim()) {
      setStatus("Enter an email address to invite.");
      return;
    }

    await executeGuiCliBoundCommand("courseforge admin school invite", async () => {
      setIsSaving(true);
      setError(null);
      try {
        const invite = await inviteSchoolUser(inviteEmail.trim(), schoolId ?? undefined);
        setStatus(`Invitation created for ${invite.email}.`);
        setInviteEmail("");
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to send invite.");
      } finally {
        setIsSaving(false);
      }
    }, {
      schoolId,
      inviteEmail,
    });
  }

  async function handleRemoveUser(uid: string): Promise<void> {
    if (!window.confirm("Remove this user from your school/district?")) {
      return;
    }

    await executeGuiCliBoundCommand("courseforge admin school remove-user", async () => {
      setIsSaving(true);
      setError(null);
      try {
        await removeSchoolUser(uid, schoolId ?? undefined);
        setStatus("User removed from school/district.");
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to remove user.");
      } finally {
        setIsSaving(false);
      }
    }, {
      schoolId,
      uid,
    });
  }

  async function handleTextbookDeletionToggle(textbookId: string, isDeleted: boolean): Promise<void> {
    await executeGuiCliBoundCommand("courseforge admin school textbook deletion toggle", async () => {
      setIsSaving(true);
      setError(null);
      try {
        await setSchoolTextbookDeletionState({ textbookId, isDeleted: !isDeleted, schoolId: schoolId ?? undefined });
        setStatus(!isDeleted ? "Textbook moved to recycle bin." : "Textbook restored from recycle bin.");
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to change textbook deletion state.");
      } finally {
        setIsSaving(false);
      }
    }, {
      schoolId,
      textbookId,
      isDeleted: !isDeleted,
    });
  }

  async function handlePromotionRequest(): Promise<void> {
    await executeGuiCliBoundCommand("courseforge admin school promotion request", async () => {
      setIsSaving(true);
      setError(null);
      try {
        const message = await requestSchoolAdminPromotion("Backup school admin requested from school dashboard.");
        setStatus(message);
        await loadDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to submit promotion request.");
      } finally {
        setIsSaving(false);
      }
    }, {
      schoolId,
    });
  }

  const body = (
    <>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>School Users</h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void executeGuiCliBoundCommand("courseforge admin school refresh", async () => {
                await loadDashboard();
              }, {
                schoolId,
              });
            }}
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
        <p className="admin-note">Manage teachers in your school or district and invite new staff by email.</p>
        <div className="admin-filter-bar admin-filter-bar--compact">
          <label>
            Invite Teacher Email
            <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teacher@school.edu" />
          </label>
          <button type="button" onClick={() => { void handleInvite(); }} disabled={isSaving}>Send Invite</button>
        </div>
        <button type="button" className="btn-secondary" onClick={() => { void handlePromotionRequest(); }} disabled={isSaving}>
          Request Additional School Admin
        </button>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(dashboard?.users ?? []).map((user) => (
              <tr key={user.uid}>
                <td>{user.email || "-"}</td>
                <td>{user.displayName || "-"}</td>
                <td>{user.isSchoolAdmin ? "School Admin" : "Teacher"}</td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "-"}</td>
                <td>
                  <button type="button" className="btn-danger-sm" onClick={() => { void handleRemoveUser(user.uid); }} disabled={isSaving}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <div className="admin-section__header">
          <h3>School Textbooks</h3>
        </div>
        <p className="admin-note">Delete or undelete textbooks uploaded by your school members while recycle-bin retention is active.</p>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Owner</th>
              <th>Grade/Subject</th>
              <th>Deleted</th>
              <th>Recycle Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(dashboard?.textbooks ?? []).map((textbook) => (
              <tr key={textbook.docPath} className={textbook.isDeleted ? "admin-row--deleted" : ""}>
                <td>{textbook.title}</td>
                <td>{textbook.ownerEmail ?? textbook.ownerId}</td>
                <td>{textbook.grade ?? "-"} / {textbook.subject ?? "-"}</td>
                <td>{textbook.isDeleted ? "Yes" : "No"}</td>
                <td>{textbook.recycleBinExpiresAt ? new Date(textbook.recycleBinExpiresAt).toLocaleString() : "-"}</td>
                <td>
                  <button
                    type="button"
                    className={textbook.isDeleted ? "btn-secondary" : "btn-danger-sm"}
                    onClick={() => { void handleTextbookDeletionToggle(textbook.id, textbook.isDeleted); }}
                    disabled={isSaving}
                  >
                    {textbook.isDeleted ? "Undelete" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {status ? <p className="settings-meta">{status}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </>
  );

  if (embedded) {
    return body;
  }

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header__left">
          <button type="button" onClick={onBack} className="btn-secondary admin-back-btn">← Back to App</button>
          <h1 className="admin-title">School Admin</h1>
        </div>
        <p className="admin-user-label">
          {dashboard?.schoolName ?? schoolName ?? "No school selected"}
          {dashboard?.districtName ? ` (${dashboard.districtName})` : ""}
          {currentUserEmail ? ` • ${currentUserEmail}` : ""}
        </p>
      </header>
      {body}
    </div>
  );
}

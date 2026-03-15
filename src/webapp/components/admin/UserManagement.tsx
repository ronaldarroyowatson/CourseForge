/**
 * UserManagement.tsx
 *
 * Admin-only panel: lists all users from the Firestore `users` collection and
 * provides buttons to note admin status. Actual custom-claim updates require
 * the backend Cloud Function or the `setAdmin.cjs` script.
 */
import React, { useCallback, useEffect, useState } from "react";

import type { AdminUserRecord } from "../../../core/services";
import { getAllUsers, setUserAdminStatus, setUserContentBlockStatus } from "../../../core/services";
import { refreshCurrentUserClaims } from "../../../firebase/auth";
import { useAuthStore } from "../../store/authStore";

export function UserManagement(): React.JSX.Element {
  const currentUserId = useAuthStore((state) => state.userId);
  const setAdminFlag = useAuthStore((state) => state.setAdminFlag);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingUids, setPendingUids] = useState<Set<string>>(new Set());

  const loadUsers = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getAllUsers();
      setUsers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  async function handleSetAdminStatus(uid: string, isAdmin: boolean): Promise<void> {
    setPendingUids((prev) => new Set(prev).add(uid));
    try {
      await setUserAdminStatus(uid, isAdmin);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, isAdmin } : u))
      );

      if (currentUserId === uid) {
        const refreshedAdminClaim = await refreshCurrentUserClaims();
        setAdminFlag(refreshedAdminClaim);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update admin status.");
    } finally {
      setPendingUids((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  }

  async function handleSetContentBlockStatus(uid: string, isContentBlocked: boolean): Promise<void> {
    setPendingUids((prev) => new Set(prev).add(uid));
    try {
      await setUserContentBlockStatus(
        uid,
        isContentBlocked,
        isContentBlocked ? "Blocked after textbook image moderation review." : undefined
      );
      setUsers((prev) => prev.map((u) => {
        if (u.uid !== uid) {
          return u;
        }

        return {
          ...u,
          isContentBlocked,
          contentBlockReason: isContentBlocked ? "Blocked after textbook image moderation review." : null,
        };
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update content block status.");
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
        <h3>User Management</h3>
        <button type="button" onClick={() => void loadUsers()} disabled={isLoading} className="btn-secondary">
          {isLoading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <p className="admin-note">
        <strong>Note:</strong> Promote and revoke actions call the secured
        Cloud Function, which updates both the Firebase Auth custom claim and the mirrored
        Firestore user profile.
      </p>

      {error ? <p className="error-text">{error}</p> : null}

      {!isLoading && users.length === 0 ? <p>No user records found.</p> : null}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Display Name</th>
            <th>Last Login</th>
            <th>Admin</th>
            <th>Cloud Sync Access</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.uid}>
              <td>{user.email || <em>—</em>}</td>
              <td>{user.displayName || <em>—</em>}</td>
              <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : <em>—</em>}</td>
              <td>{user.isAdmin ? "✅ Admin" : "—"}</td>
              <td>
                {user.isContentBlocked
                  ? `Blocked${user.contentBlockReason ? `: ${user.contentBlockReason}` : ""}`
                  : "Allowed"}
              </td>
              <td>
                <div className="admin-premium-actions">
                  {user.isAdmin ? (
                    <button
                      type="button"
                      onClick={() => void handleSetAdminStatus(user.uid, false)}
                      disabled={pendingUids.has(user.uid)}
                      className="btn-danger-sm"
                    >
                      Revoke Admin
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSetAdminStatus(user.uid, true)}
                      disabled={pendingUids.has(user.uid)}
                      className="btn-primary-sm"
                    >
                      Promote to Admin
                    </button>
                  )}

                  {user.isContentBlocked ? (
                    <button
                      type="button"
                      onClick={() => void handleSetContentBlockStatus(user.uid, false)}
                      disabled={pendingUids.has(user.uid)}
                      className="btn-secondary"
                    >
                      Unblock Cloud Sync
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSetContentBlockStatus(user.uid, true)}
                      disabled={pendingUids.has(user.uid)}
                      className="btn-danger-sm"
                    >
                      Block Cloud Sync
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

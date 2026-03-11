/**
 * ModerationQueue.tsx
 *
 * Admin-only panel: shows all content items with status === "submitted" from
 * all users. Admins can approve, reject, or archive each item.
 */
import React, { useCallback, useEffect, useState } from "react";

import type { ModerationItem } from "../../../core/services/adminFirestoreService";
import {
  adminArchiveContent,
  getSubmittedContent,
  updateContentStatus,
} from "../../../core/services/adminFirestoreService";

export function ModerationQueue(): React.JSX.Element {
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set());

  const loadQueue = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getSubmittedContent();
      setItems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load moderation queue.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  function addPending(path: string): void {
    setPendingPaths((prev) => new Set(prev).add(path));
  }
  function removePending(path: string): void {
    setPendingPaths((prev) => { const next = new Set(prev); next.delete(path); return next; });
  }

  async function handleApprove(item: ModerationItem): Promise<void> {
    addPending(item.docPath);
    try {
      await updateContentStatus(item.docPath, "approved");
      setItems((prev) => prev.filter((i) => i.docPath !== item.docPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve content.");
    } finally {
      removePending(item.docPath);
    }
  }

  async function handleReject(item: ModerationItem): Promise<void> {
    addPending(item.docPath);
    try {
      await updateContentStatus(item.docPath, "rejected");
      setItems((prev) => prev.filter((i) => i.docPath !== item.docPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject content.");
    } finally {
      removePending(item.docPath);
    }
  }

  async function handleArchive(item: ModerationItem): Promise<void> {
    addPending(item.docPath);
    try {
      await adminArchiveContent(item.docPath);
      setItems((prev) => prev.filter((i) => i.docPath !== item.docPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive content.");
    } finally {
      removePending(item.docPath);
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <h3>Content Moderation Queue</h3>
        <button type="button" onClick={() => void loadQueue()} disabled={isLoading} className="btn-secondary">
          {isLoading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {!isLoading && items.length === 0 ? (
        <p className="admin-empty">No content awaiting moderation.</p>
      ) : null}

      <ul className="admin-queue-list">
        {items.map((item) => {
          const isPending = pendingPaths.has(item.docPath);
          return (
            <li key={item.docPath} className="admin-queue-item">
              <div className="admin-queue-item__info">
                <strong>{item.title}</strong>
                <span className="admin-badge">{item.collectionName}</span>
                <p className="admin-meta">
                  Owner: {item.ownerEmail ?? item.ownerId} &bull; Modified: {item.lastModified ?? "—"}
                </p>
              </div>
              <div className="admin-queue-item__actions">
                <button
                  type="button"
                  onClick={() => void handleApprove(item)}
                  disabled={isPending}
                  className="btn-primary-sm"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => void handleReject(item)}
                  disabled={isPending}
                  className="btn-danger-sm"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => void handleArchive(item)}
                  disabled={isPending}
                  className="btn-secondary"
                >
                  Archive
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

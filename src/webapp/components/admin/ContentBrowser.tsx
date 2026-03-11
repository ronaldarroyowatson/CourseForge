import React from "react";

import type { AdminContentRecord } from "../../../core/services";
import {
  adminArchiveContent,
  adminSoftDeleteContent,
  adminUpdateContent,
  getAllTextbooksAdmin,
} from "../../../core/services";

type CollectionFilter = "all" | "textbooks" | "chapters" | "sections" | "vocabTerms";

interface EditState {
  title: string;
  summary: string;
  grade: string;
  subject: string;
  edition: string;
  publicationYear: string;
  status: AdminContentRecord["status"];
}

function buildEditState(record: AdminContentRecord): EditState {
  return {
    title: record.title,
    summary: record.summary ?? "",
    grade: record.grade ?? "",
    subject: record.subject ?? "",
    edition: record.edition ?? "",
    publicationYear: record.publicationYear ? String(record.publicationYear) : "",
    status: record.status,
  };
}

export function ContentBrowser(): React.JSX.Element {
  const [records, setRecords] = React.useState<AdminContentRecord[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingPaths, setPendingPaths] = React.useState<Set<string>>(new Set());
  const [editingPath, setEditingPath] = React.useState<string | null>(null);
  const [editState, setEditState] = React.useState<EditState | null>(null);

  const [filterIsbn, setFilterIsbn] = React.useState("");
  const [filterTitle, setFilterTitle] = React.useState("");
  const [filterOwnerEmail, setFilterOwnerEmail] = React.useState("");
  const [collectionName, setCollectionName] = React.useState<CollectionFilter>("all");

  async function handleSearch(): Promise<void> {
    setError(null);
    setIsLoading(true);
    try {
      const results = await getAllTextbooksAdmin({
        isbn: filterIsbn.trim() || undefined,
        titleContains: filterTitle.trim() || undefined,
        ownerEmail: filterOwnerEmail.trim() || undefined,
        collectionName,
      });
      setRecords(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setIsLoading(false);
    }
  }

  function addPending(path: string): void {
    setPendingPaths((prev) => new Set(prev).add(path));
  }

  function removePending(path: string): void {
    setPendingPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  }

  function startEditing(record: AdminContentRecord): void {
    setEditingPath(record.docPath);
    setEditState(buildEditState(record));
  }

  function stopEditing(): void {
    setEditingPath(null);
    setEditState(null);
  }

  function buildUpdatePayload(record: AdminContentRecord, nextState: EditState): Record<string, unknown> {
    switch (record.collectionName) {
      case "textbooks":
        return {
          title: nextState.title.trim(),
          grade: nextState.grade.trim(),
          subject: nextState.subject.trim(),
          edition: nextState.edition.trim(),
          publicationYear: nextState.publicationYear ? Number(nextState.publicationYear) : undefined,
          status: nextState.status,
        };
      case "chapters":
        return { name: nextState.title.trim(), description: nextState.summary.trim() || undefined, status: nextState.status };
      case "sections":
        return { title: nextState.title.trim(), notes: nextState.summary.trim() || undefined, status: nextState.status };
      case "vocabTerms":
        return { word: nextState.title.trim(), definition: nextState.summary.trim() || undefined, status: nextState.status };
      default:
        return { status: nextState.status };
    }
  }

  async function handleSave(record: AdminContentRecord): Promise<void> {
    if (!editState) {
      return;
    }

    addPending(record.docPath);
    try {
      const payload = buildUpdatePayload(record, editState);
      await adminUpdateContent(record.docPath, payload);
      setRecords((prev) => prev.map((item) => item.docPath === record.docPath ? {
        ...item,
        title: editState.title,
        summary: editState.summary,
        grade: editState.grade || undefined,
        subject: editState.subject || undefined,
        edition: editState.edition || undefined,
        publicationYear: editState.publicationYear ? Number(editState.publicationYear) : undefined,
        status: editState.status,
      } : item));
      stopEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      removePending(record.docPath);
    }
  }

  async function handleArchive(record: AdminContentRecord): Promise<void> {
    addPending(record.docPath);
    try {
      await adminArchiveContent(record.docPath, !record.isArchived);
      setRecords((prev) =>
        prev.map((item) => item.docPath === record.docPath ? { ...item, isArchived: !record.isArchived } : item)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed.");
    } finally {
      removePending(record.docPath);
    }
  }

  async function handleSoftDelete(record: AdminContentRecord): Promise<void> {
    if (!window.confirm(`Soft-delete "${record.title}"? It will be hidden from non-admin users.`)) {
      return;
    }

    addPending(record.docPath);
    try {
      await adminSoftDeleteContent(record.docPath, true);
      setRecords((prev) =>
        prev.map((item) => item.docPath === record.docPath ? { ...item, isDeleted: true } : item)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      removePending(record.docPath);
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section__header">
        <h3>Admin Content Browser</h3>
        <button type="button" onClick={() => void handleSearch()} disabled={isLoading} className="btn-secondary">
          {isLoading ? "Searching..." : "Refresh"}
        </button>
      </div>

      <p className="admin-note">
        Search textbooks, chapters, sections, and vocab by title, ISBN, or owner email.
        Edit, archive, and delete actions are routed through secured Cloud Functions.
      </p>

      <div className="admin-filter-bar">
        <label>
          Title / Name
          <input value={filterTitle} onChange={(event) => setFilterTitle(event.target.value)} placeholder="Partial match" />
        </label>
        <label>
          ISBN
          <input value={filterIsbn} onChange={(event) => setFilterIsbn(event.target.value)} placeholder="Textbooks only" />
        </label>
        <label>
          Owner Email
          <input value={filterOwnerEmail} onChange={(event) => setFilterOwnerEmail(event.target.value)} placeholder="teacher@school.edu" />
        </label>
        <label>
          Collection
          <select value={collectionName} onChange={(event) => setCollectionName(event.target.value as CollectionFilter)}>
            <option value="all">All content</option>
            <option value="textbooks">Textbooks</option>
            <option value="chapters">Chapters</option>
            <option value="sections">Sections</option>
            <option value="vocabTerms">Vocab Terms</option>
          </select>
        </label>
      </div>

      <button type="button" onClick={() => void handleSearch()} disabled={isLoading}>
        {isLoading ? "Searching..." : "Search"}
      </button>

      {error ? <p className="error-text">{error}</p> : null}
      {!isLoading && records.length === 0 ? <p className="admin-empty">Run a search to browse content.</p> : null}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Collection</th>
            <th>Title</th>
            <th>Owner</th>
            <th>Details</th>
            <th>Status</th>
            <th>Flags</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const isPending = pendingPaths.has(record.docPath);
            const isEditing = editingPath === record.docPath && editState !== null;

            return (
              <tr
                key={record.docPath}
                className={[
                  record.isDeleted ? "admin-row--deleted" : "",
                  record.isArchived ? "admin-row--archived" : "",
                ].filter(Boolean).join(" ")}
              >
                <td><span className="admin-badge">{record.collectionName}</span></td>
                <td>
                  {isEditing ? (
                    <input
                      value={editState.title}
                      title="Content title"
                      aria-label="Content title"
                      placeholder="Enter content title"
                      onChange={(event) => setEditState((current) => current ? { ...current, title: event.target.value } : current)}
                    />
                  ) : record.title}
                </td>
                <td>
                  <div>{record.ownerEmail ?? <span className="mono">{record.ownerId}</span>}</div>
                  <div className="admin-meta mono">{record.ownerId}</div>
                </td>
                <td>
                  {isEditing ? (
                    <div className="admin-inline-edit">
                      {record.collectionName === "textbooks" ? (
                        <>
                          <input
                            value={editState.grade}
                            onChange={(event) => setEditState((current) => current ? { ...current, grade: event.target.value } : current)}
                            placeholder="Grade"
                          />
                          <input
                            value={editState.subject}
                            onChange={(event) => setEditState((current) => current ? { ...current, subject: event.target.value } : current)}
                            placeholder="Subject"
                          />
                          <input
                            value={editState.edition}
                            onChange={(event) => setEditState((current) => current ? { ...current, edition: event.target.value } : current)}
                            placeholder="Edition"
                          />
                          <input
                            value={editState.publicationYear}
                            onChange={(event) => setEditState((current) => current ? { ...current, publicationYear: event.target.value } : current)}
                            placeholder="Year"
                          />
                        </>
                      ) : (
                        <textarea
                          value={editState.summary}
                          title="Content summary"
                          aria-label="Content summary"
                          placeholder="Enter summary"
                          onChange={(event) => setEditState((current) => current ? { ...current, summary: event.target.value } : current)}
                          rows={3}
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      {record.collectionName === "textbooks" ? (
                        <div>
                          <div>{record.grade ?? "—"} / {record.subject ?? "—"}</div>
                          <div className="admin-meta">ISBN: {record.isbnRaw ?? "—"}</div>
                        </div>
                      ) : (
                        <div>{record.summary ?? "—"}</div>
                      )}
                    </>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <select
                      value={editState.status}
                      title="Content status"
                      aria-label="Content status"
                      onChange={(event) => setEditState((current) => current ? { ...current, status: event.target.value as AdminContentRecord["status"] } : current)}
                    >
                      <option value="draft">draft</option>
                      <option value="submitted">submitted</option>
                      <option value="approved">approved</option>
                      <option value="rejected">rejected</option>
                    </select>
                  ) : (
                    <span className={`admin-status-badge admin-status-badge--${record.status}`}>
                      {record.status}
                    </span>
                  )}
                </td>
                <td>{record.isDeleted ? "Deleted" : record.isArchived ? "Archived" : "—"}</td>
                <td>
                  {isEditing ? (
                    <>
                      <button type="button" className="btn-primary-sm" onClick={() => void handleSave(record)} disabled={isPending}>
                        Save
                      </button>
                      <button type="button" className="btn-secondary" onClick={stopEditing} disabled={isPending}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-secondary" onClick={() => startEditing(record)} disabled={isPending}>
                        Edit
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => void handleArchive(record)} disabled={isPending}>
                        {record.isArchived ? "Unarchive" : "Archive"}
                      </button>
                      {!record.isDeleted ? (
                        <button type="button" className="btn-danger-sm" onClick={() => void handleSoftDelete(record)} disabled={isPending}>
                          Delete
                        </button>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

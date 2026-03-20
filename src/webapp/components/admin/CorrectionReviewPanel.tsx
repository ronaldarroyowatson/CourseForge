import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { CorrectionRecord } from "../../../core/services/metadataCorrectionLearningService";
import {
  listCorrectionsAdmin,
  reviewCorrectionsAdmin,
} from "../../../core/services/adminFirestoreService";

interface FiltersState {
  publisher: string;
  pageType: "all" | "cover" | "title" | "other";
  source: "all" | "vision" | "ocr" | "vision+ocr";
  reviewStatus: "all" | "pending" | "accepted" | "rejected";
  flaggedOnly: boolean;
  confidenceMin: string;
  confidenceMax: string;
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_FILTERS: FiltersState = {
  publisher: "",
  pageType: "all",
  source: "all",
  reviewStatus: "pending",
  flaggedOnly: false,
  confidenceMin: "",
  confidenceMax: "",
  dateFrom: "",
  dateTo: "",
};

function toNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function CorrectionReviewPanel(): React.JSX.Element {
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [records, setRecords] = useState<CorrectionRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState<"errorScore" | "timestamp" | "finalConfidence">("errorScore");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [modifyMetadata, setModifyMetadata] = useState({
    title: "",
    subtitle: "",
    edition: "",
    publisher: "",
    series: "",
    gradeLevel: "",
    subject: "",
    confidence: "",
  });

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedRecordId) ?? null,
    [records, selectedRecordId]
  );

  const loadRecords = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const response = await listCorrectionsAdmin({
        page,
        pageSize,
        sortBy,
        sortDirection,
        filters: {
          publisher: filters.publisher.trim() || undefined,
          pageType: filters.pageType,
          source: filters.source,
          reviewStatus: filters.reviewStatus,
          flaggedOnly: filters.flaggedOnly,
          confidenceMin: toNumber(filters.confidenceMin),
          confidenceMax: toNumber(filters.confidenceMax),
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
        },
      });

      setRecords(response.items);
      setTotal(response.total);
      if (response.items.length > 0 && !selectedRecordId) {
        setSelectedRecordId(response.items[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load correction records.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, selectedRecordId, sortBy, sortDirection]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!selectedRecord) {
      setModifyMetadata({
        title: "",
        subtitle: "",
        edition: "",
        publisher: "",
        series: "",
        gradeLevel: "",
        subject: "",
        confidence: "",
      });
      return;
    }

    setModifyMetadata({
      title: selectedRecord.finalMetadata.title ?? "",
      subtitle: selectedRecord.finalMetadata.subtitle ?? "",
      edition: selectedRecord.finalMetadata.edition ?? "",
      publisher: selectedRecord.finalMetadata.publisher ?? "",
      series: selectedRecord.finalMetadata.series ?? "",
      gradeLevel: selectedRecord.finalMetadata.gradeLevel ?? "",
      subject: selectedRecord.finalMetadata.subject ?? "",
      confidence: selectedRecord.finalConfidence.toString(),
    });
  }, [selectedRecord]);

  function updateModifyMetadataField(
    field: keyof typeof modifyMetadata,
    value: string
  ): void {
    setModifyMetadata((current) => ({ ...current, [field]: value }));
  }

  function updateFilter<K extends keyof FiltersState>(field: K, value: FiltersState[K]): void {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  }

  function toggleRecordSelection(id: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll(checked: boolean): void {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(new Set(records.map((record) => record.id)));
  }

  async function runBulkAction(action: "accept" | "reject"): Promise<void> {
    const ids = [...selectedIds];
    if (!ids.length) {
      setStatus("Select at least one record first.");
      return;
    }

    try {
      setError(null);
      const result = await reviewCorrectionsAdmin({ action, recordIds: ids });
      setStatus(`${result.updated} record(s) updated.`);
      setSelectedIds(new Set());
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk action failed.");
    }
  }

  async function runSingleAction(action: "accept" | "reject" | "modify"): Promise<void> {
    if (!selectedRecord) {
      return;
    }

    try {
      setError(null);
      const payload = action === "modify"
        ? {
            action,
            recordIds: [selectedRecord.id],
            modifiedMetadata: {
              title: modifyMetadata.title || null,
              subtitle: modifyMetadata.subtitle || null,
              edition: modifyMetadata.edition || null,
              publisher: modifyMetadata.publisher || null,
              series: modifyMetadata.series || null,
              gradeLevel: modifyMetadata.gradeLevel || null,
              subject: modifyMetadata.subject || null,
              confidence: Math.max(0, Math.min(1, Number(modifyMetadata.confidence) || selectedRecord.finalConfidence)),
            },
          }
        : {
            action,
            recordIds: [selectedRecord.id],
          };

      const result = await reviewCorrectionsAdmin(payload as {
        action: "accept" | "reject" | "modify";
        recordIds: string[];
        modifiedMetadata?: Partial<CorrectionRecord["finalMetadata"]>;
      });
      setStatus(`${result.updated} record(s) updated.`);
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review action failed.");
    }
  }

  function exportSelected(): void {
    const selected = records.filter((record) => selectedIds.has(record.id));
    if (!selected.length) {
      setStatus("Select records before exporting.");
      return;
    }

    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `metadata-corrections-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`${selected.length} record(s) exported.`);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="admin-section" aria-label="Metadata correction review">
      <div className="admin-section__header">
        <h3>Metadata Corrections Review</h3>
        <button type="button" className="btn-secondary" onClick={() => void loadRecords()} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <p className="admin-note">
        Review correction samples, prioritize by confidence error score, and accept/reject or modify records before they influence global rules.
      </p>

      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}

      <div className="form-grid">
        <label>
          Publisher
          <input value={filters.publisher} onChange={(event) => updateFilter("publisher", event.target.value)} />
        </label>
        <label>
          Page Type
          <select value={filters.pageType} onChange={(event) => updateFilter("pageType", event.target.value as FiltersState["pageType"])}>
            <option value="all">All</option>
            <option value="cover">Cover</option>
            <option value="title">Title</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Source
          <select value={filters.source} onChange={(event) => updateFilter("source", event.target.value as FiltersState["source"])}>
            <option value="all">All</option>
            <option value="vision">Vision</option>
            <option value="ocr">OCR</option>
            <option value="vision+ocr">Vision+OCR</option>
          </select>
        </label>
        <label>
          Review Status
          <select value={filters.reviewStatus} onChange={(event) => updateFilter("reviewStatus", event.target.value as FiltersState["reviewStatus"])}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label>
          Min Confidence
          <input value={filters.confidenceMin} onChange={(event) => updateFilter("confidenceMin", event.target.value)} />
        </label>
        <label>
          Max Confidence
          <input value={filters.confidenceMax} onChange={(event) => updateFilter("confidenceMax", event.target.value)} />
        </label>
        <label>
          Date From
          <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} />
        </label>
        <label>
          Date To
          <input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} />
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={filters.flaggedOnly} onChange={(event) => updateFilter("flaggedOnly", event.target.checked)} />
          Flagged only
        </label>
      </div>

      <div className="form-actions">
        <label>
          Sort By
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "errorScore" | "timestamp" | "finalConfidence")}>
            <option value="errorScore">Confidence Error</option>
            <option value="timestamp">Date</option>
            <option value="finalConfidence">Final Confidence</option>
          </select>
        </label>
        <label>
          Direction
          <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
        <button type="button" onClick={() => void runBulkAction("accept")}>Accept Selected</button>
        <button type="button" className="btn-secondary" onClick={() => void runBulkAction("reject")}>Reject Selected</button>
        <button type="button" className="btn-secondary" onClick={exportSelected}>Export Selected</button>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                title="Select all rows"
                aria-label="Select all correction rows"
                checked={records.length > 0 && selectedIds.size === records.length}
                onChange={(event) => toggleSelectAll(event.target.checked)}
              />
            </th>
            <th>Date</th>
            <th>Publisher</th>
            <th>Page</th>
            <th>Source</th>
            <th>Final Confidence</th>
            <th>Error Score</th>
            <th>Flagged</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} className={selectedRecordId === record.id ? "admin-table__row--active" : ""}>
              <td>
                <input
                  type="checkbox"
                  title={`Select correction ${record.id}`}
                  aria-label={`Select correction ${record.id}`}
                  checked={selectedIds.has(record.id)}
                  onChange={() => toggleRecordSelection(record.id)}
                />
              </td>
              <td>
                <button type="button" className="btn-link" onClick={() => setSelectedRecordId(record.id)}>
                  {new Date(record.timestamp).toLocaleString()}
                </button>
              </td>
              <td>{record.publisher ?? "-"}</td>
              <td>{record.pageType}</td>
              <td>{record.finalMetadata.source}</td>
              <td>{record.finalConfidence.toFixed(2)}</td>
              <td>{record.errorScore.toFixed(2)}</td>
              <td>{record.flagged ? (record.reasonFlagged ?? "yes") : "no"}</td>
              <td>{record.reviewStatus}</td>
            </tr>
          ))}
          {records.length === 0 ? (
            <tr>
              <td colSpan={9}>No correction records found for these filters.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="admin-premium-summary">
        <span>Page {page} of {totalPages}</span>
        <span>Total records: {total}</span>
        <span>
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Prev</button>
          <button type="button" className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
        </span>
      </div>

      {selectedRecord ? (
        <div className="panel" aria-label="Correction preview">
          <h4>Sample Preview</h4>
          <p className="form-hint">Review image, source outputs, and corrected metadata before taking an action.</p>
          {selectedRecord.imageReference?.startsWith("data:image/")
            ? <img src={selectedRecord.imageReference} alt="Correction sample" className="cover-preview-thumb" />
            : <p className="settings-meta">Image reference: {selectedRecord.imageReference ?? "n/a"}</p>}

          <div className="form-grid">
            <label>
              Vision output
              <textarea rows={6} value={JSON.stringify(selectedRecord.originalVisionOutput, null, 2)} readOnly />
            </label>
            <label>
              OCR output
              <textarea rows={6} value={selectedRecord.originalOcrOutput?.rawText ?? ""} readOnly />
            </label>
            <label>
              Final title
              <input value={modifyMetadata.title} onChange={(event) => updateModifyMetadataField("title", event.target.value)} />
            </label>
            <label>
              Final subtitle
              <input value={modifyMetadata.subtitle} onChange={(event) => updateModifyMetadataField("subtitle", event.target.value)} />
            </label>
            <label>
              Final edition
              <input value={modifyMetadata.edition} onChange={(event) => updateModifyMetadataField("edition", event.target.value)} />
            </label>
            <label>
              Final publisher
              <input value={modifyMetadata.publisher} onChange={(event) => updateModifyMetadataField("publisher", event.target.value)} />
            </label>
            <label>
              Final series
              <input value={modifyMetadata.series} onChange={(event) => updateModifyMetadataField("series", event.target.value)} />
            </label>
            <label>
              Final grade level
              <input value={modifyMetadata.gradeLevel} onChange={(event) => updateModifyMetadataField("gradeLevel", event.target.value)} />
            </label>
            <label>
              Final subject
              <input value={modifyMetadata.subject} onChange={(event) => updateModifyMetadataField("subject", event.target.value)} />
            </label>
            <label>
              Final confidence (0-1)
              <input value={modifyMetadata.confidence} onChange={(event) => updateModifyMetadataField("confidence", event.target.value)} />
            </label>
          </div>

          <div className="form-actions">
            <button type="button" onClick={() => void runSingleAction("accept")}>Accept</button>
            <button type="button" className="btn-secondary" onClick={() => void runSingleAction("reject")}>Reject</button>
            <button type="button" className="btn-secondary" onClick={() => void runSingleAction("modify")}>Modify & Accept</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

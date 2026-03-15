import React, { useEffect, useState } from "react";

import type { DocumentIngestFingerprint } from "../../../core/models";
import { listFingerprintsBySection } from "../../../core/services/documentIngestService";

interface IngestHistoryPanelProps {
  sectionId: string;
  onClose: () => void;
}

export function IngestHistoryPanel({ sectionId, onClose }: IngestHistoryPanelProps): React.JSX.Element {
  const [records, setRecords] = useState<DocumentIngestFingerprint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load(): Promise<void> {
      setIsLoading(true);
      try {
        const rows = await listFingerprintsBySection(sectionId);
        const sorted = [...rows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        if (isMounted) {
          setRecords(sorted);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      isMounted = false;
    };
  }, [sectionId]);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <section className="panel ingest-history-panel">
      <div className="ingest-history-header">
        <h3>Import History</h3>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Close import history">
          ✕
        </button>
      </div>

      {isLoading ? <p>Loading history…</p> : null}

      {!isLoading && records.length === 0 ? (
        <p className="ingest-empty">No files have been imported for this section yet.</p>
      ) : null}

      {!isLoading && records.length > 0 ? (
        <table className="ingest-history-table">
          <thead>
            <tr>
              <th>File Name</th>
              <th>Imported</th>
              <th>SHA-256 (first 12)</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.fileName}</td>
                <td>{formatDate(record.createdAt)}</td>
                <td>
                  <code className="ingest-hash">{record.fileHash.slice(0, 12)}…</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

import React, { useState } from "react";
import { ArchiveIcon } from "../icons/ArchiveIcon";
import { PencilIcon } from "../icons/PencilIcon";
import { StarIcon } from "../icons/StarIcon";

import type { Textbook } from "../../../core/models";
import {
  clearWriteBudgetForManualRetry,
  getPendingSyncDiagnostics,
  getSyncThrottleWindowMs,
  getSyncWriteBatchLimit,
  syncNow,
} from "../../../core/services/syncService";
import { useRepositories } from "../../hooks/useRepositories";
import { useUIStore } from "../../store/uiStore";

type RetrySyncProgressTone = "info" | "success" | "warning" | "error";

const RETRY_SYNC_WINDOW_DELAY_MS = 5500;
const RETRY_SYNC_TICK_MS = 1000;

interface RetrySyncProgressState {
  percent: number;
  detail: string;
  tone: RetrySyncProgressTone;
}

interface TextbookListProps {
  textbooks: Textbook[];
  isLoading: boolean;
  loadError: string | null;
  selectedTextbookId: string | null;
  onSelectTextbook: (id: string) => void;
  onContinueToSections: () => void;
  onDeleted: (id: string) => void;
  onRefresh: () => void;
}

function getSyncBadge(textbook: Textbook): { label: string; className: string } {
  if (textbook.pendingSync) {
    return { label: "Pending cloud sync", className: "sync-badge sync-badge--pending" };
  }

  if (textbook.source === "cloud") {
    return { label: "Cloud synced", className: "sync-badge sync-badge--synced" };
  }

  return { label: "Local only", className: "sync-badge sync-badge--local" };
}

function sortTextbooks(textbooks: Textbook[]): Textbook[] {
  return [...textbooks].sort((a, b) => {
    // Favorites first
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    // Archived last
    if (a.isArchived && !b.isArchived) return 1;
    if (!a.isArchived && b.isArchived) return -1;
    return 0;
  });
}

export function TextbookList({
  textbooks,
  isLoading,
  loadError,
  selectedTextbookId,
  onSelectTextbook,
  onContinueToSections,
  onDeleted,
  onRefresh,
}: TextbookListProps): React.JSX.Element {
  const { removeTextbook, toggleTextbookFavorite, toggleTextbookArchive } = useRepositories();
  const { setSelectedTextbook } = useUIStore();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retrySyncInProgress, setRetrySyncInProgress] = useState<Set<string>>(new Set());
  const [retrySyncProgress, setRetrySyncProgress] = useState<Map<string, RetrySyncProgressState>>(new Map());

  function updateRetrySyncProgress(textbookId: string, percent: number, detail: string, tone: RetrySyncProgressTone): void {
    setRetrySyncProgress((prev) => {
      const next = new Map(prev);
      next.set(textbookId, { percent, detail, tone });
      return next;
    });
  }

  async function handleDelete(id: string): Promise<void> {
    onDeleted(id);

    try {
      await removeTextbook(id);
    } catch {
      setErrorMessage("Unable to delete textbook.");
      onRefresh();
    }
  }

  async function handleRetrySync(textbookId: string): Promise<void> {
    setErrorMessage(null);
    // Clear any stale write-budget-exceeded flag so the retry can proceed.
    // The accumulated write count is preserved; only the blocked gate is lifted.
    clearWriteBudgetForManualRetry();
    updateRetrySyncProgress(textbookId, 8, "Preparing retry...", "info");
    setRetrySyncInProgress((prev) => new Set(prev).add(textbookId));

    try {
      const diagnostics = await getPendingSyncDiagnostics();
      const batchLimit = Math.max(1, getSyncWriteBatchLimit());
      const throttleDelayMs = Math.max(RETRY_SYNC_WINDOW_DELAY_MS, getSyncThrottleWindowMs() + 500);
      const initialPending = Math.max(0, diagnostics.pendingCount);
      const estimatedBatchTotal = Math.max(1, Math.ceil(Math.max(initialPending, 1) / batchLimit));
      const maxAttempts = Math.max(estimatedBatchTotal * 3, 6);

      let previousPending = initialPending;
      let stalledAttempts = 0;

      const waitForNextWindow = async (basePercent: number, reason: string): Promise<void> => {
        const totalTicks = Math.max(1, Math.ceil(throttleDelayMs / RETRY_SYNC_TICK_MS));

        for (let tick = totalTicks; tick >= 1; tick -= 1) {
          updateRetrySyncProgress(
            textbookId,
            Math.min(98, basePercent),
            `${reason} Next batch window in ${tick}s.`,
            "warning"
          );

          await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), RETRY_SYNC_TICK_MS);
          });
        }
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const currentBatch = Math.min(estimatedBatchTotal, Math.max(1, Math.ceil((attempt + 1) / 2)));
        updateRetrySyncProgress(
          textbookId,
          Math.min(85, 10 + attempt * 6),
          `Preparing batch ${currentBatch} of ${estimatedBatchTotal}...`,
          "info"
        );

        const startedAt = Date.now();
        const syncResult = await syncNow();
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);

        if (syncResult.throttled) {
          await waitForNextWindow(76, "Upload queued. Waiting for sync window.");
          continue;
        }

        if (syncResult.permissionDenied) {
          updateRetrySyncProgress(textbookId, 24, `Upload blocked: ${syncResult.message}`, "error");
          setErrorMessage(syncResult.message);
          break;
        }

        if (syncResult.writeBudgetExceeded || syncResult.readBudgetExceeded) {
          updateRetrySyncProgress(textbookId, 64, `Upload paused: ${syncResult.message}`, "warning");
          setErrorMessage(syncResult.message);
          break;
        }

        if (!syncResult.success) {
          if (syncResult.retryable) {
            updateRetrySyncProgress(textbookId, 84, `Upload pending retry: ${syncResult.message}`, "warning");
            await waitForNextWindow(84, "Preparing next retry attempt.");
            continue;
          }

          updateRetrySyncProgress(textbookId, 40, `Upload failed: ${syncResult.message}`, "error");
          setErrorMessage(syncResult.message);
          break;
        }

        const pendingNow = Math.max(0, syncResult.pendingCount);
        const uploadedThisBatch = Math.max(previousPending - pendingNow, syncResult.syncRunWriteCount ?? 0);
        const uploadedTotal = Math.max(0, initialPending - pendingNow);
        const completedBatches = Math.max(1, Math.ceil(Math.max(1, uploadedTotal) / batchLimit));
        const throughput = uploadedThisBatch > 0 ? uploadedThisBatch / elapsedSeconds : 0;

        if (pendingNow === 0) {
          updateRetrySyncProgress(
            textbookId,
            100,
            `Upload complete. Final batch ${Math.min(completedBatches, estimatedBatchTotal)} of ${estimatedBatchTotal} uploaded ${uploadedThisBatch} items at ${throughput.toFixed(1)} items/s.`,
            "success"
          );
          break;
        }

        const completionPercent = initialPending > 0
          ? Math.round(Math.min(96, 20 + (uploadedTotal / initialPending) * 70))
          : 90;

        updateRetrySyncProgress(
          textbookId,
          completionPercent,
          `Batch ${Math.min(completedBatches, estimatedBatchTotal)} of ${estimatedBatchTotal} uploaded ${uploadedThisBatch} items at ${throughput.toFixed(1)} items/s. ${pendingNow} items remaining.`,
          "info"
        );

        if (pendingNow >= previousPending) {
          stalledAttempts += 1;
        } else {
          stalledAttempts = 0;
        }

        if (stalledAttempts >= 2) {
          updateRetrySyncProgress(
            textbookId,
            88,
            `Upload stalled with ${pendingNow} pending items. Sync will continue in background windows.`,
            "warning"
          );
          break;
        }

        previousPending = pendingNow;
        await waitForNextWindow(completionPercent, "Batch complete.");
      }

      onRefresh();
    } catch {
      updateRetrySyncProgress(textbookId, 40, "Unable to retry cloud sync. Please try again.", "error");
      setErrorMessage("Unable to retry cloud sync. Please try again.");
    } finally {
      setRetrySyncInProgress((prev) => {
        const next = new Set(prev);
        next.delete(textbookId);
        return next;
      });
    }
  }

  async function handleToggleFavorite(textbook: Textbook): Promise<void> {
    try {
      await toggleTextbookFavorite(textbook.id, !textbook.isFavorite);
      onRefresh();
    } catch {
      setErrorMessage("Unable to update favorite status.");
    }
  }

  async function handleToggleArchive(textbook: Textbook): Promise<void> {
    try {
      await toggleTextbookArchive(textbook.id, !textbook.isArchived);
      onRefresh();
    } catch {
      setErrorMessage("Unable to update archive status.");
    }
  }

  function handleEdit(textbook: Textbook): void {
    setSelectedTextbook(textbook);
  }

  const sorted = sortTextbooks(textbooks);

  return (
    <section className="panel">
      <h3>Textbooks</h3>

      {isLoading ? <p>Loading textbooks...</p> : null}
      {loadError ? <p className="error-text">{loadError}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {!isLoading && textbooks.length === 0 ? <p>No textbooks yet.</p> : null}

      <div className="nav-button-row">
        <button
          type="button"
          onClick={onContinueToSections}
          disabled={!selectedTextbookId}
          aria-label="Continue to sections"
        >
          Continue to Sections
        </button>
      </div>

      <ul className="textbook-list">
        {sorted.map((textbook) => {
          const syncBadge = getSyncBadge(textbook);
          const retryProgress = retrySyncProgress.get(textbook.id);

          return (<li
            key={textbook.id}
            className={[
              "textbook-row",
              textbook.isArchived ? "textbook-row--archived" : "",
              textbook.isFavorite ? "textbook-row--favorite" : "",
            ].filter(Boolean).join(" ")}
          >
            {textbook.coverImageUrl ? (
              <img
                src={textbook.coverImageUrl}
                alt={`${textbook.title} cover`}
                className="textbook-row__cover"
              />
            ) : null}

            <div className="textbook-row__info">
              <strong>{textbook.title}</strong>
              {textbook.subtitle ? <p className="textbook-row__meta">{textbook.subtitle}</p> : null}
              <p>
                Grade {textbook.grade} &bull; {textbook.subject} &bull; {textbook.publicationYear}
              </p>
              {textbook.seriesName || textbook.publisher || textbook.gradeBand ? (
                <p className="textbook-row__meta">
                  {textbook.seriesName ? `Series: ${textbook.seriesName}` : ""}
                  {textbook.seriesName && textbook.publisher ? " • " : ""}
                  {textbook.publisher ? `Publisher: ${textbook.publisher}` : ""}
                  {(textbook.seriesName || textbook.publisher) && textbook.gradeBand ? " • " : ""}
                  {textbook.gradeBand ? `Grade Band: ${textbook.gradeBand}` : ""}
                </p>
              ) : null}
              <p className="textbook-row__meta">
                ISBN: {textbook.isbnRaw?.trim() ? textbook.isbnRaw : "Not set"}
                {textbook.relatedIsbns && textbook.relatedIsbns.length > 0 ? (
                  <span className="related-isbn-badge">
                    {" "}+{textbook.relatedIsbns.length} related
                  </span>
                ) : null}
              </p>
              <p className="textbook-row__meta">
                <span className={syncBadge.className}>{syncBadge.label}</span>
                {textbook.pendingSync && (
                  <button
                    type="button"
                    onClick={() => void handleRetrySync(textbook.id)}
                    disabled={retrySyncInProgress.has(textbook.id)}
                    title="Retry cloud sync"
                    aria-label="Retry cloud sync"
                    className="btn-retry-sync"
                  >
                    {retrySyncInProgress.has(textbook.id) ? "Retrying..." : "Retry Sync"}
                  </button>
                )}
              </p>
              {retryProgress ? (
                <div className={`textbook-retry-progress textbook-retry-progress--${retryProgress.tone}`} role="status" aria-live="polite">
                  <p className="textbook-row__meta textbook-retry-progress__detail">
                    Retry Sync Progress: {retryProgress.percent}% - {retryProgress.detail}
                  </p>
                  <progress
                    className="textbook-retry-progress__bar"
                    max={100}
                    value={retryProgress.percent}
                    aria-label={`Retry sync upload progress for ${textbook.title}`}
                  />
                </div>
              ) : null}
              <div className="textbook-row__actions">
                <button
                  type="button"
                  onClick={() => onSelectTextbook(textbook.id)}
                  disabled={selectedTextbookId === textbook.id}
                >
                  {selectedTextbookId === textbook.id ? "Selected" : "Select"}
                </button>
                <button
                  type="button"
                  onClick={() => handleEdit(textbook)}
                  className="btn-icon"
                  title="Edit textbook"
                  aria-label="Edit textbook"
                >
                  <PencilIcon size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleFavorite(textbook)}
                  className="btn-icon"
                  title="Favorite textbook"
                  aria-label="Favorite textbook"
                >
                  <StarIcon size={15} filled={textbook.isFavorite} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleArchive(textbook)}
                  className="btn-icon"
                  title="Archive textbook"
                  aria-label="Archive textbook"
                >
                  <ArchiveIcon size={15} />
                </button>
              </div>
            </div>

            <button type="button" onClick={() => void handleDelete(textbook.id)}>
              Delete
            </button>
          </li>);
        })}
      </ul>
    </section>
  );
}

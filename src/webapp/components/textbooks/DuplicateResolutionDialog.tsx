import React from "react";
import { createPortal } from "react-dom";

import type { Textbook } from "../../../core/models";
import { countChaptersByTextbookId } from "../../../core/services/repositories/chapterRepository";
import { countSectionsByTextbookId } from "../../../core/services/repositories/sectionRepository";
import { computeMetadataRichness } from "../../../core/services/repositories/textbookRepository";

interface TextbookStats {
  chapters: number | null;
  sections: number | null;
  richness: { filled: number; total: number };
}

interface DuplicateResolutionDialogProps {
  pairIndex: number;
  totalPairs: number;
  left: Textbook;
  right: Textbook;
  onDelete: (idToDelete: string) => void;
  onKeepBoth: () => void;
}

function formatDate(iso: string | undefined): string {
  if (!iso) {
    return "—";
  }

  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function SourceBadge({ sourceType }: { sourceType: "auto" | "manual" | string }): React.JSX.Element {
  return (
    <span
      className={`source-badge source-badge--${sourceType === "auto" ? "auto" : "manual"}`}
      aria-label={`Added ${sourceType === "auto" ? "automatically" : "manually"}`}
    >
      {sourceType === "auto" ? "Auto" : "Manual"}
    </span>
  );
}

function StatsCell({ value }: { value: number | null }): React.JSX.Element {
  if (value === null) {
    return <span className="dup-dialog__loading" aria-label="Loading">…</span>;
  }

  return <>{value}</>;
}

function TextbookCard({
  textbook,
  stats,
  onDelete,
  deleteLabel,
}: {
  textbook: Textbook;
  stats: TextbookStats | null;
  onDelete: () => void;
  deleteLabel: string;
}): React.JSX.Element {
  const richness = stats ? stats.richness : computeMetadataRichness(textbook);

  return (
    <div className="dup-dialog__card">
      {textbook.coverImageUrl ? (
        <img
          src={textbook.coverImageUrl}
          alt={`Cover for ${textbook.title}`}
          className="dup-dialog__cover"
        />
      ) : (
        <div className="dup-dialog__cover dup-dialog__cover--placeholder" aria-hidden="true" />
      )}

      <table className="dup-dialog__table">
        <tbody>
          <tr>
            <th scope="row">Title</th>
            <td>{textbook.title}{textbook.subtitle ? <span className="dup-dialog__subtitle"> — {textbook.subtitle}</span> : null}</td>
          </tr>
          <tr>
            <th scope="row">ISBN</th>
            <td>{textbook.isbnRaw || "—"}</td>
          </tr>
          <tr>
            <th scope="row">Publisher</th>
            <td>{textbook.publisher || "—"}</td>
          </tr>
          <tr>
            <th scope="row">Year</th>
            <td>{textbook.publicationYear ?? "—"}</td>
          </tr>
          <tr>
            <th scope="row">Grade</th>
            <td>{textbook.grade || "—"}</td>
          </tr>
          <tr>
            <th scope="row">Added as</th>
            <td><SourceBadge sourceType={textbook.sourceType} /></td>
          </tr>
          <tr>
            <th scope="row">Created</th>
            <td>{formatDate(textbook.createdAt)}</td>
          </tr>
          <tr>
            <th scope="row">Chapters</th>
            <td><StatsCell value={stats?.chapters ?? null} /></td>
          </tr>
          <tr>
            <th scope="row">Sections</th>
            <td><StatsCell value={stats?.sections ?? null} /></td>
          </tr>
          <tr>
            <th scope="row">Metadata</th>
            <td>{richness.filled} / {richness.total} fields</td>
          </tr>
        </tbody>
      </table>

      <button
        type="button"
        className="btn-danger dup-dialog__delete-btn"
        onClick={onDelete}
        aria-label={deleteLabel}
      >
        {deleteLabel}
      </button>
    </div>
  );
}

export function DuplicateResolutionDialog({
  pairIndex,
  totalPairs,
  left,
  right,
  onDelete,
  onKeepBoth,
}: DuplicateResolutionDialogProps): React.JSX.Element | null {
  const [leftStats, setLeftStats] = React.useState<TextbookStats | null>(null);
  const [rightStats, setRightStats] = React.useState<TextbookStats | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadStats(textbook: Textbook): Promise<TextbookStats> {
      const [chapters, sections] = await Promise.all([
        countChaptersByTextbookId(textbook.id),
        countSectionsByTextbookId(textbook.id),
      ]);
      return { chapters, sections, richness: computeMetadataRichness(textbook) };
    }

    void loadStats(left).then((stats) => { if (active) setLeftStats(stats); });
    void loadStats(right).then((stats) => { if (active) setRightStats(stats); });

    return () => { active = false; };
  }, [left.id, right.id]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onKeepBoth();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onKeepBoth]);

  if (typeof document === "undefined") {
    return null;
  }

  const pairLabel = totalPairs > 1 ? `Duplicate ${pairIndex + 1} of ${totalPairs}` : null;

  return createPortal(
    <div className="dup-dialog-layer">
      <button
        type="button"
        aria-label="Keep both and dismiss"
        className="dup-dialog__backdrop"
        onClick={onKeepBoth}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate textbook detected"
        className="dup-dialog"
      >
        <header className="dup-dialog__header">
          <div>
            <h2 className="dup-dialog__title">Duplicate Textbook Detected</h2>
            {pairLabel ? <p className="dup-dialog__subtitle">{pairLabel}</p> : null}
            <p className="dup-dialog__desc">
              These two entries appear to be the same textbook. Review the details below and choose how to proceed.
            </p>
          </div>
        </header>

        <div className="dup-dialog__comparison">
          <TextbookCard
            textbook={left}
            stats={leftStats}
            onDelete={() => onDelete(left.id)}
            deleteLabel="Delete This Entry"
          />

          <div className="dup-dialog__vs" aria-hidden="true">vs</div>

          <TextbookCard
            textbook={right}
            stats={rightStats}
            onDelete={() => onDelete(right.id)}
            deleteLabel="Delete This Entry"
          />
        </div>

        <footer className="dup-dialog__footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onKeepBoth}
          >
            Keep Both
          </button>
          <p className="dup-dialog__footer-hint">
            Keeping both will dismiss this warning and not show it again for this pair.
          </p>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

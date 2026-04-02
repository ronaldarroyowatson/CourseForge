import React, { useMemo } from "react";
import type { TocChapter } from "../../../../core/services/textbookAutoExtractionService";
import { buildTocPreviewTree, type TocPreviewNodeModel } from "./PageRangeCalculator";
import { TocPreviewNode } from "./TocPreviewNode";

export interface TocHierarchyState {
  chapters: TocChapter[];
  confidence: number;
}

interface TocPreviewTreeProps {
  toc: TocHierarchyState;
  isBusy?: boolean;
  onUpdateNode: (node: TocPreviewNodeModel, update: { numberValue: string; title: string; pageStart?: number }) => void;
  onRegenerateNode: (node: TocPreviewNodeModel) => void;
}

export function TocPreviewTree({ toc, isBusy = false, onUpdateNode, onRegenerateNode }: TocPreviewTreeProps): React.JSX.Element {
  const summary = useMemo(() => buildTocPreviewTree(toc.chapters, toc.confidence), [toc.chapters, toc.confidence]);

  return (
    <section className="toc-preview-tree rounded-lg border border-teal-400/30 bg-slate-900/20 p-3 space-y-3" aria-label="Live TOC hierarchy preview">
      <div className="toc-preview-tree__header space-y-1">
        <h4>Live TOC Structure Preview</h4>
        <p className="form-hint">
          {summary.chapterCount} chapter/module nodes, {summary.sectionCount} section nodes, {summary.subsectionCount} subsection nodes.
          {" "}
          {summary.missingCount > 0 ? `${summary.missingCount} item(s) need attention.` : "No missing data detected."}
        </p>
      </div>

      {summary.nodes.length === 0 ? (
        <div className="toc-preview-tree__empty rounded-md border border-dashed border-slate-500/60 p-3 text-slate-200">
          <p><strong>Awaiting first TOC parse.</strong> Capture your first TOC page to populate this outline.</p>
        </div>
      ) : (
        <div className="toc-preview-tree__body space-y-2">
          {summary.nodes.map((node) => (
            <TocPreviewNode
              key={node.id}
              node={node}
              onUpdateNode={onUpdateNode}
              onRegenerateNode={onRegenerateNode}
              isBusy={isBusy}
            />
          ))}
        </div>
      )}
    </section>
  );
}

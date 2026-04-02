import React, { useState } from "react";
import type { TocPreviewNodeModel } from "./PageRangeCalculator";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { MissingDataWarning } from "./MissingDataWarning";
import { TocNodeEditor } from "./TocNodeEditor";

interface TocPreviewNodeProps {
  node: TocPreviewNodeModel;
  initiallyExpanded?: boolean;
  onUpdateNode: (node: TocPreviewNodeModel, update: { numberValue: string; title: string; pageStart?: number }) => void;
  onRegenerateNode: (node: TocPreviewNodeModel) => void;
  isBusy?: boolean;
}

function toNodeLabel(level: TocPreviewNodeModel["level"], value: string, headingLabel?: string): string {
  if (level === "chapter") {
    return `${headingLabel ?? "Chapter"} ${value || "?"}`;
  }

  if (level === "section") {
    return value.trim() ? value : "Additional Section";
  }

  return value.trim() ? value : "Additional Section";
}

export function TocPreviewNode({ node, initiallyExpanded = true, onUpdateNode, onRegenerateNode, isBusy = false }: TocPreviewNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [isEditing, setIsEditing] = useState(false);
  const hasChildren = node.children.length > 0;
  const heading = toNodeLabel(node.level, node.numberValue, node.headingLabel);

  return (
    <div className={`toc-preview-node toc-preview-node--${node.level} rounded-md border border-slate-500/50 bg-slate-900/20 p-2`}>
      <div className={`toc-preview-node__header flex justify-between gap-2 items-start${node.missingFields.length > 0 || node.confidence < 0.55 ? " toc-preview-node__header--warning bg-amber-300/10 rounded-md p-1" : ""}`}>
        <div className="toc-preview-node__left flex items-start gap-1 min-w-0">
          {hasChildren ? (
            <button
              type="button"
              className="btn-text toc-preview-node__toggle"
              aria-label={expanded ? "Collapse node" : "Expand node"}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="toc-preview-node__dot" aria-hidden="true">•</span>
          )}
          <p className="toc-preview-node__title leading-snug">
            {heading ? <strong>{heading}</strong> : null}
            {heading ? " " : null}
            <span className="toc-preview-node__name">{node.title || "Untitled"}</span>
            {" "}
            <span className="toc-preview-node__range">({node.pageRangeLabel})</span>
          </p>
        </div>

        <div className="toc-preview-node__meta flex flex-wrap justify-end gap-2 items-center">
          <span className="toc-preview-node__pages">
            Start: {typeof node.pageStart === "number" ? `p. ${node.pageStart}` : "-"} | End: {typeof node.pageEnd === "number" ? `p. ${node.pageEnd}` : "-"}
          </span>
          <ConfidenceIndicator confidence={node.confidence} />
          <button type="button" className="btn-secondary" onClick={() => setIsEditing((current) => !current)}>
            {isEditing ? "Close Edit" : "Edit"}
          </button>
          <button type="button" className="btn-secondary" disabled={isBusy} onClick={() => onRegenerateNode(node)}>
            Regenerate from image
          </button>
        </div>
      </div>

      <MissingDataWarning missingFields={node.missingFields} />

      {isEditing ? (
        <TocNodeEditor
          numberValue={node.numberValue}
          title={node.title}
          pageStart={node.pageStart}
          onSave={(update) => {
            onUpdateNode(node, update);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : null}

      {hasChildren && expanded ? (
        <div className="toc-preview-node__children space-y-2">
          {node.children.map((child) => (
            <TocPreviewNode
              key={child.id}
              node={child}
              initiallyExpanded={false}
              onUpdateNode={onUpdateNode}
              onRegenerateNode={onRegenerateNode}
              isBusy={isBusy}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

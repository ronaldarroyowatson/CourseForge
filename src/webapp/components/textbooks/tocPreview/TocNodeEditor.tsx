import React, { useState } from "react";

interface TocNodeEditorProps {
  numberValue: string;
  title: string;
  pageStart?: number;
  onSave: (update: { numberValue: string; title: string; pageStart?: number }) => void;
  onCancel: () => void;
}

function parsePageStart(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function TocNodeEditor({ numberValue, title, pageStart, onSave, onCancel }: TocNodeEditorProps): React.JSX.Element {
  const [localNumber, setLocalNumber] = useState(numberValue);
  const [localTitle, setLocalTitle] = useState(title);
  const [localPageStart, setLocalPageStart] = useState(typeof pageStart === "number" ? String(pageStart) : "");

  return (
    <div className="toc-node-editor rounded-md border border-slate-500/50 bg-slate-900/30 p-2 grid gap-2">
      <label>
        Number
        <input
          value={localNumber}
          onChange={(event) => setLocalNumber(event.target.value)}
          placeholder="e.g., 1.2"
        />
      </label>
      <label>
        Title
        <input
          value={localTitle}
          onChange={(event) => setLocalTitle(event.target.value)}
          placeholder="Section title"
        />
      </label>
      <label>
        Start Page
        <input
          value={localPageStart}
          onChange={(event) => setLocalPageStart(event.target.value)}
          placeholder="e.g., 42"
          inputMode="numeric"
        />
      </label>

      <div className="toc-node-editor__actions flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSave({
            numberValue: localNumber,
            title: localTitle,
            pageStart: parsePageStart(localPageStart),
          })}
        >
          Save
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

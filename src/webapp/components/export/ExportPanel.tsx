import React, { useMemo, useState } from "react";

import { exportChapterXml, exportSectionXml, exportTextbookXml } from "../../../core/xml";

interface ExportPanelProps {
  selectedTextbookId?: string;
  selectedChapterId?: string;
  selectedSectionId?: string;
}

type ExportScope = "section" | "chapter" | "textbook" | "none";

function getExportScope(props: ExportPanelProps): ExportScope {
  if (props.selectedSectionId) {
    return "section";
  }

  if (props.selectedChapterId) {
    return "chapter";
  }

  if (props.selectedTextbookId) {
    return "textbook";
  }

  return "none";
}

export function ExportPanel(props: ExportPanelProps): React.JSX.Element {
  const [xmlOutput, setXmlOutput] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scope = getExportScope(props);
  const canExport = scope !== "none";

  const fileName = useMemo(() => {
    if (scope === "section") {
      return `courseforge-section-${props.selectedSectionId}.xml`;
    }

    if (scope === "chapter") {
      return `courseforge-chapter-${props.selectedChapterId}.xml`;
    }

    if (scope === "textbook") {
      return `courseforge-textbook-${props.selectedTextbookId}.xml`;
    }

    return "courseforge-export.xml";
  }, [props.selectedChapterId, props.selectedSectionId, props.selectedTextbookId, scope]);

  async function handleExport(): Promise<void> {
    setErrorMessage(null);

    if (!canExport) {
      setErrorMessage("Select a textbook, chapter, or section before exporting.");
      return;
    }

    try {
      setIsExporting(true);

      if (scope === "section" && props.selectedSectionId) {
        setXmlOutput(await exportSectionXml(props.selectedSectionId));
        return;
      }

      if (scope === "chapter" && props.selectedChapterId) {
        setXmlOutput(await exportChapterXml(props.selectedChapterId));
        return;
      }

      if (scope === "textbook" && props.selectedTextbookId) {
        setXmlOutput(await exportTextbookXml(props.selectedTextbookId));
      }
    } catch {
      setErrorMessage("Unable to export XML. Please verify your selection and try again.");
    } finally {
      setIsExporting(false);
    }
  }

  function handleDownload(): void {
    if (!xmlOutput) {
      return;
    }

    const blob = new Blob([xmlOutput], { type: "application/xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(objectUrl);
  }

  return (
    <section className="panel">
      <h3>Export XML</h3>
      <p>
        Scope: <strong>{scope}</strong>
      </p>

      <div className="button-row">
        <button type="button" onClick={() => void handleExport()} disabled={!canExport || isExporting}>
          {isExporting ? "Exporting..." : "Export XML"}
        </button>

        <button type="button" onClick={handleDownload} disabled={!xmlOutput}>
          Download XML
        </button>
      </div>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      <label>
        Generated XML
        <textarea
          value={xmlOutput}
          rows={14}
          readOnly
          placeholder="Generated XML will appear here after export."
        />
      </label>
    </section>
  );
}

import React, { useEffect, useRef, useState } from "react";

import type { DocumentExtractionContext, ExtractedDocumentData } from "../../../core/services/documentIngestService";
import { extractFromDocuments, isSupportedDocumentType } from "../../../core/services/documentIngestService";
import { useRepositories } from "../../hooks/useRepositories";

interface DocumentIngestPanelProps {
  selectedSectionId: string | null;
  extractionContext?: DocumentExtractionContext;
  onDone: () => void;
}

type IngestStep = "upload" | "extracting" | "review" | "saving" | "done";

interface EditableVocabItem {
  word: string;
  definition?: string;
}

interface EditableConceptItem {
  name: string;
  explanation?: string;
}

function EditableList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
}): React.JSX.Element {
  return (
    <div className="ingest-review-section">
      <h4>{label} ({items.length})</h4>
      {items.length === 0 ? (
        <p className="ingest-empty">None found.</p>
      ) : (
        <ul className="ingest-item-list">
          {items.map((item, index) => (
            <li key={index} className="ingest-item-row">
              <input
                value={item}
                aria-label={`${label} item ${index + 1}`}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = e.target.value;
                  onChange(next);
                }}
                className="ingest-item-input"
              />
              <button
                type="button"
                className="btn-icon btn-danger"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                title="Remove"
                aria-label="Remove item"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditablePairList({
  label,
  nameLabel,
  detailLabel,
  items,
  onChange,
}: {
  label: string;
  nameLabel: string;
  detailLabel: string;
  items: Array<{ name: string; detail?: string }>;
  onChange: (next: Array<{ name: string; detail?: string }>) => void;
}): React.JSX.Element {
  return (
    <div className="ingest-review-section">
      <h4>{label} ({items.length})</h4>
      {items.length === 0 ? (
        <p className="ingest-empty">None found.</p>
      ) : (
        <ul className="ingest-item-list">
          {items.map((item, index) => (
            <li key={index} className="ingest-item-row">
              <input
                value={item.name}
                aria-label={`${nameLabel} ${index + 1}`}
                placeholder={nameLabel}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], name: e.target.value };
                  onChange(next);
                }}
                className="ingest-item-input"
              />
              <input
                value={item.detail ?? ""}
                aria-label={`${detailLabel} ${index + 1}`}
                placeholder={detailLabel}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], detail: e.target.value || undefined };
                  onChange(next);
                }}
                className="ingest-item-input"
              />
              <button
                type="button"
                className="btn-icon btn-danger"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                title="Remove"
                aria-label="Remove item"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function normalizeForDedupe(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function DocumentIngestPanel({
  selectedSectionId,
  extractionContext,
  onDone,
}: DocumentIngestPanelProps): React.JSX.Element {
  const {
    createVocabTerm,
    createConcept,
    createEquation,
    createKeyIdea,
    fetchVocabTermsBySectionId,
    fetchConceptsBySectionId,
    fetchEquationsBySectionId,
    fetchKeyIdeasBySectionId,
  } = useRepositories();

  const [step, setStep] = useState<IngestStep>("upload");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedDocumentData | null>(null);
  const [saveSummaryMessage, setSaveSummaryMessage] = useState<string | null>(null);

  // Editable review state (mirrors `extracted` but user can edit before saving)
  const [reviewVocabItems, setReviewVocabItems] = useState<EditableVocabItem[]>([]);
  const [reviewConceptItems, setReviewConceptItems] = useState<EditableConceptItem[]>([]);
  const [reviewEquations, setReviewEquations] = useState<string[]>([]);
  const [reviewKeyIdeas, setReviewKeyIdeas] = useState<string[]>([]);
  const [reviewNamesAndDates, setReviewNamesAndDates] = useState<Array<{ name: string; date?: string }>>([]);
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const blockingIssues = extracted?.quality.issues.filter((issue) => issue.severity === "error") ?? [];
  const warningIssues = extracted?.quality.issues.filter((issue) => issue.severity === "warning") ?? [];
  const canSaveExtractedContent = Boolean(extracted?.quality.accepted);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }

    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  async function handleFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const hasSupportedFile = files.some(isSupportedDocumentType);
    if (!hasSupportedFile) {
      setErrorMessage("No supported files were found. Use PDF, DOCX, TXT, HTML, Markdown, or RTF.");
      return;
    }

    setErrorMessage(null);
    setSaveSummaryMessage(null);
    setSelectedFileNames(files.map((file) => file.name));
    setStep("extracting");

    try {
      const data = await extractFromDocuments(files, {
        ...extractionContext,
        sectionId: selectedSectionId ?? undefined,
      });
      setExtracted(data);
      const extractedVocab: EditableVocabItem[] = data.vocabWithDefinitions?.length
        ? data.vocabWithDefinitions.map((entry) => ({ word: entry.word, definition: entry.definition }))
        : data.vocab.map((word) => ({ word }));

      const extractedConcepts: EditableConceptItem[] = data.conceptsWithExplanations?.length
        ? data.conceptsWithExplanations.map((entry) => ({ name: entry.name, explanation: entry.explanation }))
        : data.concepts.map((name) => ({ name }));

      setReviewVocabItems(
        extractedVocab.map((entry) => ({
          word: entry.word,
          definition: entry.definition,
        }))
      );
      setReviewConceptItems(
        extractedConcepts.map((entry) => ({
          name: entry.name,
          explanation: entry.explanation,
        }))
      );
      setReviewEquations([...data.equations]);
      setReviewKeyIdeas([...data.keyIdeas]);
      setReviewNamesAndDates(data.namesAndDates.map((nd) => ({ ...nd })));
      setStep("review");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Extraction failed. Please try again.");
      setStep("upload");
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    await handleFiles(files);
    event.target.value = "";
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    await handleFiles(files);
  }

  async function handleSave(): Promise<void> {
    if (!selectedSectionId) {
      setErrorMessage("No section selected. Please select a section first.");
      return;
    }

    setStep("saving");
    setErrorMessage(null);

    try {
      const [existingVocab, existingConcepts, existingEquations, existingKeyIdeas] = await Promise.all([
        fetchVocabTermsBySectionId(selectedSectionId),
        fetchConceptsBySectionId(selectedSectionId),
        fetchEquationsBySectionId(selectedSectionId),
        fetchKeyIdeasBySectionId(selectedSectionId),
      ]);

      const vocabSeen = new Set(existingVocab.map((item) => normalizeForDedupe(item.word)));
      const conceptSeen = new Set(existingConcepts.map((item) => normalizeForDedupe(item.name)));
      const equationSeen = new Set(existingEquations.map((item) => normalizeForDedupe(item.latex)));
      const keyIdeaSeen = new Set(existingKeyIdeas.map((item) => normalizeForDedupe(item.text)));

      const newVocab = reviewVocabItems
        .map((item) => ({
          word: item.word.trim(),
          definition: item.definition?.trim() || undefined,
        }))
        .filter((item) => item.word.length > 0)
        .filter((item) => {
          const normalized = normalizeForDedupe(item.word);
          if (vocabSeen.has(normalized)) {
            return false;
          }

          vocabSeen.add(normalized);
          return true;
        });

      const newConcepts = reviewConceptItems
        .map((item) => ({
          name: item.name.trim(),
          explanation: item.explanation?.trim() || undefined,
        }))
        .filter((item) => item.name.length > 0)
        .filter((item) => {
          const normalized = normalizeForDedupe(item.name);
          if (conceptSeen.has(normalized)) {
            return false;
          }

          conceptSeen.add(normalized);
          return true;
        });

      const newEquations = reviewEquations
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
          const normalized = normalizeForDedupe(item);
          if (equationSeen.has(normalized)) {
            return false;
          }

          equationSeen.add(normalized);
          return true;
        });

      const newKeyIdeasFromReview = reviewKeyIdeas
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
          const normalized = normalizeForDedupe(item);
          if (keyIdeaSeen.has(normalized)) {
            return false;
          }

          keyIdeaSeen.add(normalized);
          return true;
        });

      const newKeyIdeasFromNames = reviewNamesAndDates
        .filter((item) => item.name.trim())
        .map((item) => {
          const name = item.name.trim();
          const date = item.date?.trim();
          return date ? `${name} (${date})` : name;
        })
        .filter((item) => {
          const normalized = normalizeForDedupe(item);
          if (keyIdeaSeen.has(normalized)) {
            return false;
          }

          keyIdeaSeen.add(normalized);
          return true;
        });

      await Promise.all([
        ...newVocab.map((entry) => createVocabTerm({
          sectionId: selectedSectionId,
          word: entry.word,
          definition: entry.definition,
        })),
        ...newConcepts.map((entry) => createConcept({
          sectionId: selectedSectionId,
          name: entry.name,
          explanation: entry.explanation,
        })),
        ...newEquations.map((latex) => createEquation({ sectionId: selectedSectionId, name: latex, latex })),
        ...newKeyIdeasFromReview.map((text) => createKeyIdea({ sectionId: selectedSectionId, text })),
        ...newKeyIdeasFromNames.map((text) => createKeyIdea({ sectionId: selectedSectionId, text })),
      ]);

      const createdCount = newVocab.length + newConcepts.length + newEquations.length + newKeyIdeasFromReview.length + newKeyIdeasFromNames.length;
      setSaveSummaryMessage(
        createdCount === 0
          ? "No new items were added because everything in this import already exists in the section."
          : `Saved ${createdCount} new item(s) to this section.`
      );
      setStep("done");
    } catch {
      setErrorMessage("Some items could not be saved. Please try again.");
      setStep("review");
    }
  }

  if (!selectedSectionId) {
    return (
      <section className="panel ingest-panel">
        <h3>Upload Document</h3>
        <p className="error-text">Select a section before uploading a document.</p>
      </section>
    );
  }

  return (
    <section className="panel ingest-panel">
      <h3>Upload Document for Extraction</h3>

      {step === "upload" && (
        <>
          <p>Upload one or more PDF, DOCX, TXT, HTML, Markdown, or RTF files. You can drag files in, browse to them, or scan an entire folder.</p>
          <div
            className="ingest-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleDrop(event)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Drag and drop documents here or browse for files"
          >
            <strong>Drop documents here</strong>
            <p className="ingest-layout-summary">Best results come from chapter-specific exports rather than mixed folders.</p>
          </div>
          <div className="cover-input-row">
            <button type="button" className="cover-file-label ingest-picker-button" onClick={() => fileInputRef.current?.click()}>
              Browse Files
            </button>
            <button type="button" className="cover-file-label ingest-picker-button" onClick={() => folderInputRef.current?.click()}>
              Scan Folder
            </button>
          </div>
          <label className="cover-file-label cover-file-label-hidden">
            Browse Files
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Browse Files"
              multiple
              accept=".pdf,.txt,.docx,.html,.htm,.md,.markdown,.rtf,text/plain,text/html,application/xhtml+xml,text/markdown,text/x-markdown,text/rtf,application/rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => void handleFileSelected(e)}
              className="cover-file-input"
            />
          </label>
          <label className="cover-file-label cover-file-label-hidden">
            Scan Folder
            <input
              ref={folderInputRef}
              type="file"
              aria-label="Scan Folder"
              multiple
              onChange={(e) => void handleFileSelected(e)}
              className="cover-file-input"
            />
          </label>
          {errorMessage ? (
            <div className="ingest-alert ingest-alert-error" role="alert">
              <strong>Could not start import.</strong>
              <p>{errorMessage}</p>
              <p>Try a chapter-specific PDF, DOCX, TXT, HTML, Markdown, or RTF export instead.</p>
            </div>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onDone}>
            Cancel
          </button>
        </>
      )}

      {step === "extracting" && (
        <p>Extracting content with AI… Please wait.</p>
      )}

      {step === "review" && extracted !== null && (
        <>
          <p>Review and edit the extracted items below, then click Save to add them to this section.</p>

          {selectedFileNames.length > 0 ? (
            <p className="ingest-layout-summary">Processed {selectedFileNames.length} file(s): {selectedFileNames.join(", ")}.</p>
          ) : null}

          {blockingIssues.length > 0 ? (
            <div className="ingest-alert ingest-alert-error" role="alert">
              <strong>Import blocked.</strong>
              <ul className="ingest-issue-list">
                {blockingIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
              <p>Use a chapter-specific instructional document. Avoid source code, unrelated handouts, and mixed next-chapter material.</p>
            </div>
          ) : null}

          {warningIssues.length > 0 ? (
            <div className="ingest-alert ingest-alert-warning" role="status">
              <strong>Review notes.</strong>
              <ul className="ingest-issue-list">
                {warningIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {extracted.inferredChapterTitle || extracted.inferredSectionTitle ? (
            <p className="ingest-layout-summary">
              Inferred destination: {extracted.inferredChapterTitle ? `Chapter ${extracted.inferredChapterTitle}` : "Chapter unknown"}
              {" · "}
              {extracted.inferredSectionTitle ? `Section ${extracted.inferredSectionTitle}` : "Section unknown"}
            </p>
          ) : null}

          {extracted.quality.questionAnswerLayouts.length > 0 ? (
            <p className="ingest-layout-summary">
              Detected worksheet layout: {extracted.quality.questionAnswerLayouts.join(", ")}.
            </p>
          ) : null}

          <EditablePairList
            label="Vocab Terms"
            nameLabel="Word"
            detailLabel="Definition (optional)"
            items={reviewVocabItems.map((item) => ({ name: item.word, detail: item.definition }))}
            onChange={(next) => setReviewVocabItems(next.map((item) => ({ word: item.name, definition: item.detail })))}
          />
          <EditablePairList
            label="Concepts"
            nameLabel="Concept"
            detailLabel="Explanation (optional)"
            items={reviewConceptItems.map((item) => ({ name: item.name, detail: item.explanation }))}
            onChange={(next) => setReviewConceptItems(next.map((item) => ({ name: item.name, explanation: item.detail })))}
          />
          <EditableList label="Equations" items={reviewEquations} onChange={setReviewEquations} />
          <EditableList label="Key Ideas" items={reviewKeyIdeas} onChange={setReviewKeyIdeas} />

          <div className="ingest-review-section">
            <h4>Names & Dates ({reviewNamesAndDates.length})</h4>
            {reviewNamesAndDates.length === 0 ? (
              <p className="ingest-empty">None found.</p>
            ) : (
              <ul className="ingest-item-list">
                {reviewNamesAndDates.map((nd, index) => (
                  <li key={index} className="ingest-item-row">
                    <input
                      value={nd.name}
                      placeholder="Name"
                      onChange={(e) => {
                        const next = [...reviewNamesAndDates];
                        next[index] = { ...nd, name: e.target.value };
                        setReviewNamesAndDates(next);
                      }}
                      className="ingest-item-input"
                    />
                    <input
                      value={nd.date ?? ""}
                      placeholder="Date (optional)"
                      onChange={(e) => {
                        const next = [...reviewNamesAndDates];
                        next[index] = { ...nd, date: e.target.value || undefined };
                        setReviewNamesAndDates(next);
                      }}
                      className="ingest-item-input ingest-item-date"
                    />
                    <button
                      type="button"
                      className="btn-icon btn-danger"
                      onClick={() => setReviewNamesAndDates((prev) => prev.filter((_, i) => i !== index))}
                      title="Remove"
                      aria-label="Remove name/date"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

          <div className="form-actions">
            <button type="button" onClick={() => void handleSave()} disabled={!canSaveExtractedContent}>
              Save to Section
            </button>
            <button type="button" className="btn-secondary" onClick={onDone}>
              Discard
            </button>
          </div>
        </>
      )}

      {step === "saving" && (
        <p>Saving items to section…</p>
      )}

      {step === "done" && (
        <>
          <p className="success-text">{saveSummaryMessage ?? "Items saved successfully to this section."}</p>
          <button type="button" onClick={onDone}>
            Close
          </button>
        </>
      )}
    </section>
  );
}

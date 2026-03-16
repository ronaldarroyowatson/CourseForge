import React from "react";

import type { GlossaryEntry } from "../../../core/models";
import {
  deleteGlossaryEntry,
  listGlossaryEntries,
  saveGlossaryEntry,
} from "../../../core/services";

export function GlossaryManagementPanel(): React.JSX.Element {
  const [subject, setSubject] = React.useState("biology");
  const [sourceLanguage, setSourceLanguage] = React.useState("en");
  const [targetLanguage, setTargetLanguage] = React.useState("es");
  const [sourceTerm, setSourceTerm] = React.useState("");
  const [preferredTranslation, setPreferredTranslation] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [usageRef, setUsageRef] = React.useState("");
  const [rows, setRows] = React.useState<GlossaryEntry[]>([]);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  async function refreshRows(): Promise<void> {
    setErrorMessage(null);
    try {
      const items = await listGlossaryEntries({
        subject,
        sourceLanguage,
        targetLanguage,
      });
      setRows(items.sort((left, right) => right.updatedAt - left.updatedAt));
      setStatusMessage(`Loaded ${items.length} glossary entries.`);
    } catch {
      setErrorMessage("Unable to load glossary entries.");
    }
  }

  React.useEffect(() => {
    void refreshRows();
  }, []);

  async function handleSave(): Promise<void> {
    setErrorMessage(null);

    if (!sourceTerm.trim() || !preferredTranslation.trim()) {
      setErrorMessage("Source term and preferred translation are required.");
      return;
    }

    try {
      await saveGlossaryEntry({
        id: "",
        subject,
        sourceLanguage,
        targetLanguage,
        sourceTerm,
        preferredTranslation,
        notes: notes || undefined,
        usageRefs: usageRef ? [usageRef] : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: "admin",
      });

      setSourceTerm("");
      setPreferredTranslation("");
      setNotes("");
      setUsageRef("");
      await refreshRows();
      setStatusMessage("Glossary entry saved.");
    } catch {
      setErrorMessage("Unable to save glossary entry.");
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setErrorMessage(null);

    try {
      await deleteGlossaryEntry(id);
      await refreshRows();
      setStatusMessage("Glossary entry removed.");
    } catch {
      setErrorMessage("Unable to delete glossary entry.");
    }
  }

  return (
    <section className="admin-section" aria-live="polite">
      <div className="admin-section__header">
        <h3>Glossaries</h3>
        <button type="button" className="btn-secondary" onClick={() => { void refreshRows(); }}>
          Refresh
        </button>
      </div>

      <p className="admin-note">Manage subject-specific terms used to steer multilingual AI translation quality.</p>

      <div className="admin-filter-bar">
        <label>
          Subject
          <input value={subject} onChange={(event) => setSubject(event.target.value.trim().toLowerCase())} />
        </label>
        <label>
          Source Language
          <input value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value.trim().toLowerCase())} />
        </label>
        <label>
          Target Language
          <input value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value.trim().toLowerCase())} />
        </label>
        <button type="button" className="btn-secondary" onClick={() => { void refreshRows(); }}>
          Apply Filters
        </button>
      </div>

      <div className="admin-inline-edit">
        <label>
          Source Term
          <input value={sourceTerm} onChange={(event) => setSourceTerm(event.target.value)} placeholder="photosynthesis" />
        </label>
        <label>
          Preferred Translation
          <input value={preferredTranslation} onChange={(event) => setPreferredTranslation(event.target.value)} placeholder="fotosintesis" />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Classroom preferred wording." />
        </label>
        <label>
          Usage Ref
          <input value={usageRef} onChange={(event) => setUsageRef(event.target.value)} placeholder="game:quiz-1" />
        </label>
        <button type="button" className="btn-secondary" onClick={() => { void handleSave(); }}>
          Save Entry
        </button>
      </div>

      {statusMessage ? <p className="admin-meta">{statusMessage}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {rows.length === 0 ? (
        <p className="admin-empty">No glossary entries found for this filter.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Source Term</th>
              <th>Preferred Translation</th>
              <th>Subject</th>
              <th>Lang Pair</th>
              <th>Used In</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.sourceTerm}</td>
                <td>{entry.preferredTranslation}</td>
                <td>{entry.subject}</td>
                <td>{entry.sourceLanguage}-{entry.targetLanguage}</td>
                <td>{(entry.usageRefs ?? []).join(", ") || "-"}</td>
                <td>
                  <button type="button" className="btn-danger-sm" onClick={() => { void handleDelete(entry.id); }}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

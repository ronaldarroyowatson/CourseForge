import React from "react";

import type { TranslationMemoryEntry } from "../../../core/models";
import { listTranslationMemoryEntries } from "../../../core/services/repositories";
import {
  applyTranslationOverride,
  fetchLanguageRegistryFromUrl,
  resetTranslationToAi,
} from "../../../core/services/translationWorkflowService";
import { upsertTranslationMemoryCloudEntry } from "../../../core/services/translationMemoryCloudService";

function normalizeLanguage(value: string): string {
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return primary || "en";
}

export function TranslationMemoryPanel(): React.JSX.Element {
  const [language, setLanguage] = React.useState("en");
  const [rows, setRows] = React.useState<TranslationMemoryEntry[]>([]);
  const [draftTranslations, setDraftTranslations] = React.useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [roadmapStatus, setRoadmapStatus] = React.useState<string | null>(null);
  const [roadmapPreview, setRoadmapPreview] = React.useState<string[]>([]);

  async function refreshEntries(nextLanguage = language): Promise<void> {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const entries = await listTranslationMemoryEntries(normalizeLanguage(nextLanguage));
      entries.sort((left, right) => right.lastUpdated - left.lastUpdated);
      setRows(entries);
      setDraftTranslations(
        Object.fromEntries(entries.map((entry) => [entry.id, entry.translatedText]))
      );
      setStatusMessage(`Loaded ${entries.length} translation entr${entries.length === 1 ? "y" : "ies"}.`);
    } catch {
      setErrorMessage("Unable to load translation memory entries right now.");
    } finally {
      setIsLoading(false);
    }
  }

  React.useEffect(() => {
    void refreshEntries();
  }, []);

  async function handleOverride(entry: TranslationMemoryEntry, nextValue: string): Promise<void> {
    setErrorMessage(null);

    try {
      const updated = await applyTranslationOverride({
        language: language,
        termId: entry.termId,
        sourceText: entry.sourceText,
        translatedText: nextValue,
        actor: "admin",
      });

      await upsertTranslationMemoryCloudEntry(updated, "shared");
      setRows((previous) => previous.map((row) => (row.id === entry.id ? updated : row)));
      setDraftTranslations((previous) => ({
        ...previous,
        [entry.id]: updated.translatedText,
      }));
      setStatusMessage("Override saved and synced to shared translation memory.");
    } catch {
      setErrorMessage("Unable to save override right now.");
    }
  }

  async function handleResetToAi(entry: TranslationMemoryEntry): Promise<void> {
    setErrorMessage(null);

    try {
      const updated = await resetTranslationToAi(language, entry.termId);
      if (!updated) {
        setErrorMessage("Translation entry was not found.");
        return;
      }

      await upsertTranslationMemoryCloudEntry(updated, "shared");
      setRows((previous) => previous.map((row) => (row.id === entry.id ? updated : row)));
      setDraftTranslations((previous) => ({
        ...previous,
        [entry.id]: updated.translatedText,
      }));
      setStatusMessage("Translation reset to AI baseline and synced to cloud.");
    } catch {
      setErrorMessage("Unable to reset translation right now.");
    }
  }

  async function handleRoadmapRefresh(): Promise<void> {
    setRoadmapStatus(null);

    try {
      const registry = await fetchLanguageRegistryFromUrl();
      setRoadmapPreview(registry.roadmap.slice(0, 8));
      setRoadmapStatus(`Detected ${registry.supported.length} supported language packs and ${registry.roadmap.length} roadmap candidates.`);
    } catch {
      setRoadmapStatus("Unable to check language roadmap updates right now.");
    }
  }

  return (
    <section className="admin-section" aria-live="polite">
      <div className="admin-section__header">
        <h3>Translation Memory</h3>
        <button type="button" className="btn-secondary" onClick={() => { void refreshEntries(); }} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <p className="admin-note">Approve, override, or reset AI-generated terminology across all classrooms.</p>

      <div className="admin-filter-bar admin-filter-bar--compact">
        <label>
          Language
          <input
            value={language}
            onChange={(event) => {
              const nextLanguage = normalizeLanguage(event.target.value);
              setLanguage(nextLanguage);
            }}
            placeholder="en"
          />
        </label>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            void refreshEntries(language);
          }}
        >
          Load Language Entries
        </button>
      </div>

      {statusMessage ? <p className="admin-meta">{statusMessage}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {rows.length === 0 ? (
        <p className="admin-empty">No translation memory entries found for this language.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Term Id</th>
              <th>Source</th>
              <th>Translation</th>
              <th>Updated By</th>
              <th>Confidence</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              return (
                <tr key={entry.id}>
                  <td className="mono">{entry.termId}</td>
                  <td>{entry.sourceText}</td>
                  <td>
                    <textarea
                      aria-label={`Translation override for ${entry.termId}`}
                      value={draftTranslations[entry.id] ?? entry.translatedText}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setDraftTranslations((previous) => ({
                          ...previous,
                          [entry.id]: nextValue,
                        }));
                      }}
                      rows={2}
                    />
                  </td>
                  <td>{entry.updatedBy}</td>
                  <td>{Math.round(entry.confidence * 100)}%</td>
                  <td>
                    <div className="admin-premium-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          void handleOverride(entry, draftTranslations[entry.id] ?? entry.translatedText);
                        }}
                      >
                        Save Override
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          void handleResetToAi(entry);
                        }}
                      >
                        Reset to AI
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="admin-subsection">
        <h4 className="admin-subsection-title">Language Roadmap Updates</h4>
        <button type="button" className="btn-secondary" onClick={() => { void handleRoadmapRefresh(); }}>
          Check for New Languages
        </button>
        {roadmapStatus ? <p className="admin-meta">{roadmapStatus}</p> : null}
        {roadmapPreview.length > 0 ? <p className="admin-meta">Upcoming: {roadmapPreview.join(", ")}</p> : null}
      </div>
    </section>
  );
}

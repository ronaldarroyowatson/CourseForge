import React from "react";

import type { Equation } from "../../../core/models";
import {
  type EquationContext,
  type EquationInputFormat,
  normalizeEquationInput,
} from "../../../core/services/equationFormatService";
import { useRepositories } from "../../hooks/useRepositories";

interface EquationPanelProps {
  selectedSectionId: string | null;
  equationContext?: EquationContext;
}

const INPUT_FORMAT_OPTIONS: Array<{ value: EquationInputFormat; label: string }> = [
  { value: "latex", label: "LaTeX" },
  { value: "word-linear", label: "Word/Google linear" },
  { value: "word-omml", label: "Microsoft Word OMML (XML)" },
  { value: "mathml", label: "MathML / Overleaf export" },
  { value: "plain", label: "Plain text" },
];

export function EquationPanel({ selectedSectionId, equationContext }: EquationPanelProps): React.JSX.Element {
  const { createEquation, fetchEquationsBySectionId, removeEquation } = useRepositories();
  const [equations, setEquations] = React.useState<Equation[]>([]);
  const [name, setName] = React.useState("");
  const [rawEquation, setRawEquation] = React.useState("");
  const [format, setFormat] = React.useState<EquationInputFormat>("latex");
  const [conceptHint, setConceptHint] = React.useState("");
  const [description, setDescription] = React.useState("");
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);
  const equationFileRef = React.useRef<HTMLInputElement | null>(null);

  const normalized = React.useMemo(() => {
    return normalizeEquationInput({
      raw: rawEquation,
      format,
      context: {
        ...equationContext,
        conceptName: conceptHint.trim() || equationContext?.conceptName,
      },
    });
  }, [conceptHint, equationContext, format, rawEquation]);

  React.useEffect(() => {
    let isMounted = true;

    async function loadEquations(): Promise<void> {
      if (!selectedSectionId) {
        setEquations([]);
        return;
      }

      const rows = await fetchEquationsBySectionId(selectedSectionId);
      if (!isMounted) {
        return;
      }

      setEquations(rows);
    }

    void loadEquations();

    return () => {
      isMounted = false;
    };
  }, [fetchEquationsBySectionId, selectedSectionId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedLatex = normalized.repairSuggestion?.latex ?? normalized.latex.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName || !trimmedLatex || !trimmedDescription || !selectedSectionId) {
      return;
    }

    await createEquation({
      sectionId: selectedSectionId,
      name: trimmedName,
      latex: trimmedLatex,
      description: trimmedDescription,
    });

    setName("");
    setRawEquation("");
    setFormat("latex");
    setConceptHint("");
    setDescription("");
    setEquations(await fetchEquationsBySectionId(selectedSectionId));
    window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
  }

  async function handleEquationFileSelect(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    setRawEquation(text);
    if (/\.mml$/i.test(file.name)) {
      setFormat("mathml");
    } else if (/\.omml\.xml$/i.test(file.name) || /<m:oMath/i.test(text)) {
      setFormat("word-omml");
    } else if (/\.tex$/i.test(file.name)) {
      setFormat("latex");
    }

    event.target.value = "";
  }

  async function handleDelete(id: string): Promise<void> {
    await removeEquation(id);
    setEquations((current) => current.filter((equation) => equation.id !== id));
  }

  return (
    <section className="panel">
      <h3>Add Equation</h3>
      <form onSubmit={(event) => { void handleSubmit(event); }} className="form-grid">
        <label>
          Name
          <input ref={nameInputRef} value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Input Format
          <select value={format} onChange={(event) => setFormat(event.target.value as EquationInputFormat)}>
            {INPUT_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Equation Input
          <textarea
            value={rawEquation}
            onChange={(event) => setRawEquation(event.target.value)}
            rows={4}
            required
          />
        </label>
        <label>
          Concept Hint (optional)
          <input
            value={conceptHint}
            onChange={(event) => setConceptHint(event.target.value)}
            placeholder="e.g. quadratic formula"
          />
        </label>
        <label>
          Load Equation Snippet File
          <div className="cover-input-row">
            <button type="button" className="btn-secondary" onClick={() => equationFileRef.current?.click()}>
              Import .tex/.xml/.mml/.txt
            </button>
          </div>
          <input
            ref={equationFileRef}
            type="file"
            accept=".tex,.xml,.mml,.txt"
            className="cover-file-input"
            onChange={(event) => void handleEquationFileSelect(event)}
            aria-label="Import equation snippet file"
          />
        </label>
        <label>
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} required />
        </label>

        <div className="ingest-review-section">
          <h4>Equation Preview</h4>
          <p><strong>Detected format:</strong> {normalized.detectedFormat}</p>
          <p><strong>Normalized LaTeX:</strong> <span className="mono">{normalized.latex || "(empty)"}</span></p>
          <p><strong>Word-style linear preview:</strong> <span className="mono">{normalized.wordLinearPreview || "(empty)"}</span></p>
          {normalized.repairSuggestion ? (
            <>
              <p>
                <strong>Suggested repair ({Math.round(normalized.repairSuggestion.confidence * 100)}%):</strong>
                {" "}<span className="mono">{normalized.repairSuggestion.latex}</span>
              </p>
              <p>{normalized.repairSuggestion.reason}</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setRawEquation(normalized.repairSuggestion?.latex ?? rawEquation);
                  setFormat("latex");
                }}
              >
                Use Suggested Repair
              </button>
            </>
          ) : null}
          {normalized.warnings.length > 0 ? (
            <ul className="ingest-issue-list">
              {normalized.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <button type="submit">Save Equation</button>
      </form>

      {!selectedSectionId ? <p>Select a section to add equations.</p> : null}

      <ul className="textbook-list content-list">
        {equations.map((equation) => (
          <li key={equation.id} className="textbook-row">
            <div>
              <strong>{equation.name}</strong>
              <p className="mono">{equation.latex}</p>
              {equation.description ? <p>{equation.description}</p> : null}
            </div>
            <button type="button" onClick={() => { void handleDelete(equation.id); }}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

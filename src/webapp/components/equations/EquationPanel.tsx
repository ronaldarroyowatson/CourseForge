import React from "react";

import type { Equation } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface EquationPanelProps {
  selectedSectionId: string | null;
}

export function EquationPanel({ selectedSectionId }: EquationPanelProps): React.JSX.Element {
  const { createEquation, fetchEquationsBySectionId, removeEquation } = useRepositories();
  const [equations, setEquations] = React.useState<Equation[]>([]);
  const [name, setName] = React.useState("");
  const [latex, setLatex] = React.useState("");
  const [description, setDescription] = React.useState("");
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);

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
    const trimmedLatex = latex.trim();
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
    setLatex("");
    setDescription("");
    setEquations(await fetchEquationsBySectionId(selectedSectionId));
    window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
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
          LaTeX
          <input value={latex} onChange={(event) => setLatex(event.target.value)} required />
        </label>
        <label>
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} required />
        </label>
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

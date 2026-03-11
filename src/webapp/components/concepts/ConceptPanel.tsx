import React from "react";

import type { Concept } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface ConceptPanelProps {
  selectedSectionId: string | null;
}

export function ConceptPanel({ selectedSectionId }: ConceptPanelProps): React.JSX.Element {
  const { createConcept, fetchConceptsBySectionId, removeConcept } = useRepositories();
  const [concepts, setConcepts] = React.useState<Concept[]>([]);
  const [name, setName] = React.useState("");
  const [explanation, setExplanation] = React.useState("");
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    async function loadConcepts(): Promise<void> {
      if (!selectedSectionId) {
        setConcepts([]);
        return;
      }

      const rows = await fetchConceptsBySectionId(selectedSectionId);
      if (!isMounted) {
        return;
      }

      setConcepts(rows);
    }

    void loadConcepts();

    return () => {
      isMounted = false;
    };
  }, [fetchConceptsBySectionId, selectedSectionId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedExplanation = explanation.trim();

    if (!trimmedName || !trimmedExplanation || !selectedSectionId) {
      return;
    }

    await createConcept({
      sectionId: selectedSectionId,
      name: trimmedName,
      explanation: trimmedExplanation,
    });

    setName("");
    setExplanation("");
    setConcepts(await fetchConceptsBySectionId(selectedSectionId));
    window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
  }

  async function handleDelete(id: string): Promise<void> {
    await removeConcept(id);
    setConcepts((current) => current.filter((concept) => concept.id !== id));
  }

  return (
    <section className="panel">
      <h3>Add Concept</h3>
      <form onSubmit={(event) => { void handleSubmit(event); }} className="form-grid">
        <label>
          Name
          <input ref={nameInputRef} value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Explanation
          <input value={explanation} onChange={(event) => setExplanation(event.target.value)} required />
        </label>
        <button type="submit">Save Concept</button>
      </form>

      {!selectedSectionId ? <p>Select a section to add concepts.</p> : null}

      <ul className="textbook-list content-list">
        {concepts.map((concept) => (
          <li key={concept.id} className="textbook-row">
            <div>
              <strong>{concept.name}</strong>
              {concept.explanation ? <p>{concept.explanation}</p> : null}
            </div>
            <button type="button" onClick={() => { void handleDelete(concept.id); }}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

import React from "react";

import type { KeyIdea } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface KeyIdeaPanelProps {
  selectedSectionId: string | null;
}

export function KeyIdeaPanel({ selectedSectionId }: KeyIdeaPanelProps): React.JSX.Element {
  const { createKeyIdea, fetchKeyIdeasBySectionId, removeKeyIdea } = useRepositories();
  const [keyIdeas, setKeyIdeas] = React.useState<KeyIdea[]>([]);
  const [text, setText] = React.useState("");
  const keyIdeaInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    async function loadKeyIdeas(): Promise<void> {
      if (!selectedSectionId) {
        setKeyIdeas([]);
        return;
      }

      const rows = await fetchKeyIdeasBySectionId(selectedSectionId);
      if (!isMounted) {
        return;
      }

      setKeyIdeas(rows);
    }

    void loadKeyIdeas();

    return () => {
      isMounted = false;
    };
  }, [fetchKeyIdeasBySectionId, selectedSectionId]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedText = text.trim();
    if (!trimmedText || !selectedSectionId) {
      return;
    }

    await createKeyIdea({
      sectionId: selectedSectionId,
      text: trimmedText,
    });

    setText("");
    setKeyIdeas(await fetchKeyIdeasBySectionId(selectedSectionId));
    window.requestAnimationFrame(() => {
      keyIdeaInputRef.current?.focus();
    });
  }

  async function handleDelete(id: string): Promise<void> {
    await removeKeyIdea(id);
    setKeyIdeas((current) => current.filter((idea) => idea.id !== id));
  }

  return (
    <section className="panel">
      <h3>Add Key Idea</h3>
      <form onSubmit={(event) => { void handleSubmit(event); }} className="form-grid">
        <label>
          Key Idea
          <input ref={keyIdeaInputRef} value={text} onChange={(event) => setText(event.target.value)} required />
        </label>
        <button type="submit">Save Key Idea</button>
      </form>

      {!selectedSectionId ? <p>Select a section to add key ideas.</p> : null}

      <ul className="textbook-list content-list">
        {keyIdeas.map((idea) => (
          <li key={idea.id} className="textbook-row">
            <div>
              <strong>{idea.text}</strong>
            </div>
            <button type="button" onClick={() => { void handleDelete(idea.id); }}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

import React, { useEffect, useState } from "react";

import type { Textbook } from "../../../core/models";
import { useRepositories } from "../../hooks/useRepositories";

interface TextbookSelectorProps {
  selectedTextbookId?: string;
  onSelectTextbook: (id: string | undefined) => void;
}

export function TextbookSelector({
  selectedTextbookId,
  onSelectTextbook,
}: TextbookSelectorProps): React.JSX.Element {
  const { fetchTextbooks } = useRepositories();
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);

  useEffect(() => {
    async function loadTextbooks(): Promise<void> {
      const results = await fetchTextbooks();
      setTextbooks(results);
    }

    void loadTextbooks();
  }, [fetchTextbooks]);

  return (
    <label className="selector-field">
      Textbook
      <select
        value={selectedTextbookId ?? ""}
        onChange={(event) => onSelectTextbook(event.target.value || undefined)}
      >
        <option value="">Select textbook</option>
        {textbooks.map((textbook) => (
          <option key={textbook.id} value={textbook.id}>
            {textbook.title}
          </option>
        ))}
      </select>
    </label>
  );
}

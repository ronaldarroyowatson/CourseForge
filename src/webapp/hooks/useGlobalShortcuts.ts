import React from "react";

interface UseGlobalShortcutsInput {
  onGoTextbooks: () => void;
  onGoSettings: () => void;
  onGoAdmin?: () => void;
  onQuickSyncHint?: () => void;
}

export function useGlobalShortcuts(input: UseGlobalShortcutsInput): void {
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (isTyping) {
        return;
      }

      switch (event.key) {
        case "1":
          event.preventDefault();
          input.onGoTextbooks();
          return;
        case "2":
          event.preventDefault();
          input.onGoSettings();
          return;
        case "3":
          if (input.onGoAdmin) {
            event.preventDefault();
            input.onGoAdmin();
          }
          return;
        case "s":
        case "S":
          event.preventDefault();
          input.onQuickSyncHint?.();
          return;
        default:
          return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [input]);
}

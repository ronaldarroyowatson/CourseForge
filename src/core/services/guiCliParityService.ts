import { emitClientDebugTrace } from "./clientDebugTraceService";

const GUI_CLI_PARITY_HISTORY_KEY = "courseforge.guiCliParity.history.v1";
const MAX_GUI_CLI_HISTORY = 500;

export interface GuiCliParityHistoryEntry {
  timestamp: string;
  commandId: string;
  source: "gui" | "cli";
  context: Record<string, unknown>;
  ok: boolean;
  errorMessage?: string;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function readHistory(): GuiCliParityHistoryEntry[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(GUI_CLI_PARITY_HISTORY_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as GuiCliParityHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: GuiCliParityHistoryEntry[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(GUI_CLI_PARITY_HISTORY_KEY, JSON.stringify(entries.slice(-MAX_GUI_CLI_HISTORY)));
}

export function getGuiCliParityHistoryEntries(): GuiCliParityHistoryEntry[] {
  return readHistory();
}

export function clearGuiCliParityHistoryEntries(): void {
  writeHistory([]);
}

function recordGuiCliParityHistory(entry: GuiCliParityHistoryEntry): void {
  const next = [...readHistory(), entry];
  writeHistory(next);

  emitClientDebugTrace({
    channel: "gui-cli",
    event: entry.ok ? "bound_command_executed" : "bound_command_failed",
    level: entry.ok ? "info" : "error",
    payload: {
      commandId: entry.commandId,
      source: entry.source,
      ok: entry.ok,
      errorMessage: entry.errorMessage ?? null,
      context: entry.context,
    },
  });
}

export async function executeGuiCliBoundCommand<T>(
  commandId: string,
  action: () => Promise<T> | T,
  context: Record<string, unknown> = {}
): Promise<T> {
  const timestamp = new Date().toISOString();

  try {
    const result = await action();
    recordGuiCliParityHistory({
      timestamp,
      commandId,
      source: "gui",
      context,
      ok: true,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordGuiCliParityHistory({
      timestamp,
      commandId,
      source: "gui",
      context,
      ok: false,
      errorMessage: message,
    });
    throw error;
  }
}

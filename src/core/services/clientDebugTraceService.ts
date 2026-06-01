type DebugLevel = "info" | "warning" | "error";

const CLIENT_DEBUG_TRACE_KEY = "courseforge.clientDebugTrace.v1";
const MAX_CLIENT_DEBUG_TRACE_ENTRIES = 300;

export interface ClientDebugTraceEntry {
  timestamp: string;
  channel: string;
  event: string;
  level: DebugLevel;
  payload: Record<string, unknown>;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function readClientTraceEntries(): ClientDebugTraceEntry[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(CLIENT_DEBUG_TRACE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ClientDebugTraceEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeClientTraceEntries(entries: ClientDebugTraceEntry[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(CLIENT_DEBUG_TRACE_KEY, JSON.stringify(entries.slice(-MAX_CLIENT_DEBUG_TRACE_ENTRIES)));
}

function emitConsoleTrace(entry: ClientDebugTraceEntry): void {
  const prefix = `[CourseForge debug][${entry.channel}] ${entry.event}`;
  if (entry.level === "error") {
    console.error(prefix, entry.payload);
    return;
  }

  if (entry.level === "warning") {
    console.warn(prefix, entry.payload);
    return;
  }

  console.info(prefix, entry.payload);
}

export function emitClientDebugTrace(input: {
  channel: string;
  event: string;
  level?: DebugLevel;
  payload?: Record<string, unknown>;
}): void {
  const entry: ClientDebugTraceEntry = {
    timestamp: new Date().toISOString(),
    channel: input.channel,
    event: input.event,
    level: input.level ?? "info",
    payload: input.payload ?? {},
  };

  emitConsoleTrace(entry);
  const existing = readClientTraceEntries();
  writeClientTraceEntries([...existing, entry]);
}

export function getClientDebugTraceEntries(): ClientDebugTraceEntry[] {
  return readClientTraceEntries();
}
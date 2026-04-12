export type AutoCaptureTraceSeverity = "info" | "warning" | "error";
export type AutoCaptureTraceStatus = "running" | "completed" | "failed";

export interface AutoCaptureTraceEvent {
  id: string;
  timestamp: string;
  step: string;
  component: string;
  category: "orchestration" | "communication" | "ocr" | "agent" | "field" | "structure" | "upload" | "cache" | "error";
  action: string;
  severity: AutoCaptureTraceSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface AutoCaptureFieldDecision {
  id: string;
  timestamp: string;
  step: string;
  component: string;
  fieldKey: string;
  value: string | number | boolean | null;
  source: string;
  status: "detected" | "missing" | "rejected" | "overwritten";
  confidence?: number | null;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface AutoCaptureTraceSummary {
  totalEvents: number;
  totalFieldDecisions: number;
  warnings: number;
  errors: number;
}

export interface AutoCaptureTraceRun {
  runId: string;
  sessionTraceId: string;
  enabled: boolean;
  status: AutoCaptureTraceStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  stepsVisited: string[];
  events: AutoCaptureTraceEvent[];
  fieldDecisions: AutoCaptureFieldDecision[];
  summary: AutoCaptureTraceSummary;
}

interface AutoCaptureTraceStore {
  runs: AutoCaptureTraceRun[];
}

const AUTO_CAPTURE_VERBOSE_DEBUG_ENABLED_KEY = "courseforge.autoCapture.verboseDebugEnabled.v1";
const AUTO_CAPTURE_TRACE_STORE_KEY = "courseforge.autoCapture.traceStore.v1";
const MAX_STORED_RUNS = 6;
const MAX_EVENTS_PER_RUN = 500;
const MAX_FIELD_DECISIONS_PER_RUN = 400;

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function createTraceId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readStore(): AutoCaptureTraceStore {
  const storage = getStorage();
  if (!storage) {
    return { runs: [] };
  }

  const raw = storage.getItem(AUTO_CAPTURE_TRACE_STORE_KEY);
  if (!raw) {
    return { runs: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AutoCaptureTraceStore>;
    const runs = Array.isArray(parsed.runs)
      ? parsed.runs.filter((run): run is AutoCaptureTraceRun => Boolean(run && typeof run.runId === "string" && Array.isArray(run.events) && Array.isArray(run.fieldDecisions)))
      : [];
    return { runs };
  } catch {
    return { runs: [] };
  }
}

function writeStore(store: AutoCaptureTraceStore): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(AUTO_CAPTURE_TRACE_STORE_KEY, JSON.stringify(store));
}

function summarize(run: AutoCaptureTraceRun): AutoCaptureTraceSummary {
  const warnings = run.events.filter((event) => event.severity === "warning").length;
  const errors = run.events.filter((event) => event.severity === "error").length;
  return {
    totalEvents: run.events.length,
    totalFieldDecisions: run.fieldDecisions.length,
    warnings,
    errors,
  };
}

function trimRun(run: AutoCaptureTraceRun): AutoCaptureTraceRun {
  const events = run.events.length > MAX_EVENTS_PER_RUN
    ? run.events.slice(run.events.length - MAX_EVENTS_PER_RUN)
    : run.events;
  const fieldDecisions = run.fieldDecisions.length > MAX_FIELD_DECISIONS_PER_RUN
    ? run.fieldDecisions.slice(run.fieldDecisions.length - MAX_FIELD_DECISIONS_PER_RUN)
    : run.fieldDecisions;

  const trimmedRun: AutoCaptureTraceRun = {
    ...run,
    events,
    fieldDecisions,
    summary: summarize({ ...run, events, fieldDecisions }),
  };

  return trimmedRun;
}

export function isAutoCaptureVerboseDebugEnabled(): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  return storage.getItem(AUTO_CAPTURE_VERBOSE_DEBUG_ENABLED_KEY) === "1";
}

export function setAutoCaptureVerboseDebugEnabled(enabled: boolean): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(AUTO_CAPTURE_VERBOSE_DEBUG_ENABLED_KEY, enabled ? "1" : "0");
}

export function startAutoCaptureTraceRun(options: { sessionTraceId: string; enabled: boolean }): AutoCaptureTraceRun {
  const now = new Date().toISOString();
  const run: AutoCaptureTraceRun = {
    runId: createTraceId("auto-trace-run"),
    sessionTraceId: options.sessionTraceId,
    enabled: options.enabled,
    status: "running",
    startedAt: now,
    updatedAt: now,
    stepsVisited: [],
    events: [],
    fieldDecisions: [],
    summary: {
      totalEvents: 0,
      totalFieldDecisions: 0,
      warnings: 0,
      errors: 0,
    },
  };

  const store = readStore();
  store.runs = [run, ...store.runs].slice(0, MAX_STORED_RUNS);
  writeStore(store);
  return run;
}

export function updateAutoCaptureTraceRun(run: AutoCaptureTraceRun): AutoCaptureTraceRun {
  const next = trimRun({
    ...run,
    updatedAt: new Date().toISOString(),
  });

  const store = readStore();
  const index = store.runs.findIndex((entry) => entry.runId === next.runId);
  if (index >= 0) {
    store.runs[index] = next;
  } else {
    store.runs.unshift(next);
  }
  store.runs = store.runs.slice(0, MAX_STORED_RUNS);
  writeStore(store);

  return next;
}

export function recordAutoCaptureTraceEvent(
  run: AutoCaptureTraceRun,
  event: Omit<AutoCaptureTraceEvent, "id" | "timestamp">
): AutoCaptureTraceRun {
  const next: AutoCaptureTraceRun = {
    ...run,
    stepsVisited: run.stepsVisited.includes(event.step)
      ? run.stepsVisited
      : [...run.stepsVisited, event.step],
    events: [
      ...run.events,
      {
        ...event,
        id: createTraceId("auto-trace-event"),
        timestamp: new Date().toISOString(),
      },
    ],
  };

  return updateAutoCaptureTraceRun(next);
}

export function recordAutoCaptureFieldDecision(
  run: AutoCaptureTraceRun,
  decision: Omit<AutoCaptureFieldDecision, "id" | "timestamp">
): AutoCaptureTraceRun {
  const next: AutoCaptureTraceRun = {
    ...run,
    stepsVisited: run.stepsVisited.includes(decision.step)
      ? run.stepsVisited
      : [...run.stepsVisited, decision.step],
    fieldDecisions: [
      ...run.fieldDecisions,
      {
        ...decision,
        id: createTraceId("auto-trace-field"),
        timestamp: new Date().toISOString(),
      },
    ],
  };

  return updateAutoCaptureTraceRun(next);
}

export function completeAutoCaptureTraceRun(
  run: AutoCaptureTraceRun,
  status: AutoCaptureTraceStatus
): AutoCaptureTraceRun {
  const next: AutoCaptureTraceRun = {
    ...run,
    status,
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  return updateAutoCaptureTraceRun(next);
}

export function readLatestAutoCaptureTraceRun(): AutoCaptureTraceRun | null {
  const store = readStore();
  return store.runs[0] ?? null;
}

export function readAutoCaptureTraceRunById(runId: string): AutoCaptureTraceRun | null {
  const store = readStore();
  return store.runs.find((run) => run.runId === runId) ?? null;
}

export function clearAutoCaptureTraceRuns(): void {
  writeStore({ runs: [] });
}

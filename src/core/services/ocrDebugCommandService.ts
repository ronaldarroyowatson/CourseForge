import { getClientDebugTraceEntries, type ClientDebugTraceEntry } from "./clientDebugTraceService";

export type OcrDebugView =
  | "trace"
  | "pipeline"
  | "crops"
  | "garbage"
  | "rescans"
  | "fallback"
  | "confidence"
  | "structure"
  | "tokens"
  | "timings";

export type OcrDebugCommandId =
  | "courseforge ocr debug trace"
  | "courseforge ocr debug pipeline"
  | "courseforge ocr debug crops"
  | "courseforge ocr debug garbage"
  | "courseforge ocr debug rescans"
  | "courseforge ocr debug fallback"
  | "courseforge ocr debug confidence"
  | "courseforge ocr debug structure"
  | "courseforge ocr debug tokens"
  | "courseforge ocr debug timings"
  | "courseforge ocr debug export"
  | "courseforge ocr debug export --full"
  | "courseforge ocr debug export --html";

export interface OcrDebugReport {
  view: OcrDebugView | "export";
  generatedAt: string;
  totalEvents?: number;
  events?: Array<{
    timestamp: string;
    channel: string;
    event: string;
    level: string;
    payload: Record<string, unknown>;
  }>;
  summary?: {
    traceCount: number;
    longestTraceMs: number;
    traces: Array<{
      traceId: string;
      eventCount: number;
      startedAt: string;
      endedAt: string;
      durationMs: number;
    }>;
  };
  reports?: Record<string, OcrDebugReport>;
}

function toTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOcrEntry(entry: ClientDebugTraceEntry): boolean {
  if (entry.channel.toLowerCase() === "ocr") {
    return true;
  }

  const merged = `${entry.event} ${JSON.stringify(entry.payload || {})}`.toLowerCase();
  return merged.includes("ocr") || merged.includes("fallback") || merged.includes("traceid");
}

function matchesView(entry: ClientDebugTraceEntry, view: OcrDebugView): boolean {
  const merged = `${entry.event} ${JSON.stringify(entry.payload || {})}`.toLowerCase();

  if (view === "trace") {
    return true;
  }

  if (view === "pipeline") {
    return merged.includes("fallback") || merged.includes("provider_") || merged.includes("cloud_extract") || merged.includes("health_probe");
  }

  if (view === "crops") {
    return merged.includes("crop") || merged.includes("preprocess") || merged.includes("image");
  }

  if (view === "garbage") {
    return merged.includes("garbage") || merged.includes("unusable") || merged.includes("empty_text");
  }

  if (view === "rescans") {
    return merged.includes("rescan") || merged.includes("retry") || merged.includes("again");
  }

  if (view === "fallback") {
    return merged.includes("fallback") || merged.includes("provider_") || merged.includes("circuit");
  }

  if (view === "confidence") {
    return merged.includes("confidence") || merged.includes("score") || merged.includes("quality");
  }

  if (view === "structure") {
    return merged.includes("structure") || merged.includes("toc") || merged.includes("group");
  }

  if (view === "tokens") {
    return merged.includes("token") || merged.includes("auth") || merged.includes("provider policy");
  }

  if (view === "timings") {
    return true;
  }

  return false;
}

function buildTimingSummary(entries: ClientDebugTraceEntry[]): OcrDebugReport["summary"] {
  const traces = new Map<string, ClientDebugTraceEntry[]>();

  for (const entry of entries) {
    const traceId = typeof entry.payload?.traceId === "string" && entry.payload.traceId.length > 0
      ? entry.payload.traceId
      : "no-trace";
    const group = traces.get(traceId) ?? [];
    group.push(entry);
    traces.set(traceId, group);
  }

  const traceRows = Array.from(traces.entries()).map(([traceId, traceEntries]) => {
    const sorted = traceEntries.slice().sort((left, right) => toTimestampMs(left.timestamp) - toTimestampMs(right.timestamp));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return {
      traceId,
      eventCount: sorted.length,
      startedAt: first?.timestamp ?? "",
      endedAt: last?.timestamp ?? "",
      durationMs: Math.max(0, toTimestampMs(last?.timestamp ?? "") - toTimestampMs(first?.timestamp ?? "")),
    };
  }).sort((left, right) => right.durationMs - left.durationMs);

  return {
    traceCount: traceRows.length,
    longestTraceMs: traceRows[0]?.durationMs ?? 0,
    traces: traceRows,
  };
}

export function buildOcrDebugReportFromEntries(entries: ClientDebugTraceEntry[], view: OcrDebugView): OcrDebugReport {
  const ocrEntries = entries.filter(isOcrEntry).filter((entry) => matchesView(entry, view));
  const normalized = ocrEntries
    .slice()
    .sort((left, right) => toTimestampMs(left.timestamp) - toTimestampMs(right.timestamp))
    .map((entry) => ({
      timestamp: entry.timestamp,
      channel: entry.channel,
      event: entry.event,
      level: entry.level,
      payload: entry.payload,
    }));

  if (view === "timings") {
    return {
      view,
      generatedAt: new Date().toISOString(),
      totalEvents: normalized.length,
      events: normalized,
      summary: buildTimingSummary(ocrEntries),
    };
  }

  return {
    view,
    generatedAt: new Date().toISOString(),
    totalEvents: normalized.length,
    events: normalized,
  };
}

export function renderOcrDebugReportHtml(report: OcrDebugReport): string {
  const rows = (report.events ?? [])
    .map((event) => {
      const timestamp = String(event.timestamp).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const channel = String(event.channel).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const level = String(event.level).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      const name = String(event.event).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      return `<tr><td>${timestamp}</td><td>${channel}</td><td>${level}</td><td>${name}</td></tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CourseForge OCR Debug Report</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 20px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
th { background: #f6f6f6; }
</style>
</head>
<body>
<h1>CourseForge OCR Debug Report</h1>
<p>Generated: ${report.generatedAt} | View: ${report.view}</p>
<table>
<thead><tr><th>Timestamp</th><th>Channel</th><th>Level</th><th>Event</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
}

export function runOcrDebugCommand(commandId: OcrDebugCommandId): OcrDebugReport | string {
  const entries = getClientDebugTraceEntries();

  const viewByCommand: Record<string, OcrDebugView> = {
    "courseforge ocr debug trace": "trace",
    "courseforge ocr debug pipeline": "pipeline",
    "courseforge ocr debug crops": "crops",
    "courseforge ocr debug garbage": "garbage",
    "courseforge ocr debug rescans": "rescans",
    "courseforge ocr debug fallback": "fallback",
    "courseforge ocr debug confidence": "confidence",
    "courseforge ocr debug structure": "structure",
    "courseforge ocr debug tokens": "tokens",
    "courseforge ocr debug timings": "timings",
  };

  if (commandId === "courseforge ocr debug export --full") {
    const views: OcrDebugView[] = ["trace", "pipeline", "crops", "garbage", "rescans", "fallback", "confidence", "structure", "tokens", "timings"];
    const reports: Record<string, OcrDebugReport> = {};
    for (const view of views) {
      reports[view] = buildOcrDebugReportFromEntries(entries, view);
    }
    return {
      view: "export",
      generatedAt: new Date().toISOString(),
      reports,
    };
  }

  if (commandId === "courseforge ocr debug export") {
    return {
      view: "export",
      generatedAt: new Date().toISOString(),
      reports: {
        trace: buildOcrDebugReportFromEntries(entries, "trace"),
      },
    };
  }

  if (commandId === "courseforge ocr debug export --html") {
    return renderOcrDebugReportHtml(buildOcrDebugReportFromEntries(entries, "trace"));
  }

  const view = viewByCommand[commandId];
  return buildOcrDebugReportFromEntries(entries, view ?? "trace");
}

export const GUI_OCR_DEBUG_COMMANDS: Array<{ id: OcrDebugCommandId; label: string }> = [
  { id: "courseforge ocr debug trace", label: "Trace" },
  { id: "courseforge ocr debug pipeline", label: "Pipeline" },
  { id: "courseforge ocr debug fallback", label: "Fallback" },
  { id: "courseforge ocr debug timings", label: "Timings" },
  { id: "courseforge ocr debug export", label: "Export JSON" },
  { id: "courseforge ocr debug export --html", label: "Export HTML" },
];

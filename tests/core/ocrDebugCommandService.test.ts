import { describe, expect, it } from "vitest";

import { buildOcrDebugReportFromEntries, runOcrDebugCommand } from "../../src/core/services/ocrDebugCommandService";

describe("ocr debug command service", () => {
  const sampleEntries = [
    {
      timestamp: "2026-06-05T10:00:00.000Z",
      channel: "ocr",
      event: "fallback_started",
      level: "info" as const,
      payload: { traceId: "ocr-a" },
    },
    {
      timestamp: "2026-06-05T10:00:01.000Z",
      channel: "ocr",
      event: "provider_extract_started",
      level: "info" as const,
      payload: { traceId: "ocr-a", providerId: "cloud_openai_vision" },
    },
    {
      timestamp: "2026-06-05T10:00:03.000Z",
      channel: "ocr",
      event: "provider_extract_succeeded",
      level: "info" as const,
      payload: { traceId: "ocr-a" },
    },
    {
      timestamp: "2026-06-05T10:00:04.000Z",
      channel: "ocr",
      event: "provider_extract_empty_text",
      level: "warning" as const,
      payload: { traceId: "ocr-b" },
    },
  ];

  it("builds filtered fallback and pipeline views", () => {
    const fallbackReport = buildOcrDebugReportFromEntries(sampleEntries, "fallback");
    const pipelineReport = buildOcrDebugReportFromEntries(sampleEntries, "pipeline");

    expect(fallbackReport.totalEvents).toBeGreaterThan(0);
    expect(pipelineReport.totalEvents).toBeGreaterThan(0);
  });

  it("builds timings summary from trace ids", () => {
    const timings = buildOcrDebugReportFromEntries(sampleEntries, "timings");

    expect(timings.summary?.traceCount).toBeGreaterThan(0);
    expect((timings.summary?.traces[0]?.durationMs ?? 0) >= 0).toBe(true);
  });

  it("supports export command IDs", () => {
    const jsonExport = runOcrDebugCommand("courseforge ocr debug export");
    const htmlExport = runOcrDebugCommand("courseforge ocr debug export --html");

    expect(typeof jsonExport).toBe("object");
    expect(typeof htmlExport).toBe("string");
  });
});

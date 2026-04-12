import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAutoCaptureTraceRuns,
  completeAutoCaptureTraceRun,
  readLatestAutoCaptureTraceRun,
  recordAutoCaptureFieldDecision,
  recordAutoCaptureTraceEvent,
  setAutoCaptureVerboseDebugEnabled,
  startAutoCaptureTraceRun,
} from "../../src/core/services/autoCaptureTraceService";

describe("autoCaptureTraceService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAutoCaptureTraceRuns();
    setAutoCaptureVerboseDebugEnabled(true);
  });

  it("builds a coherent run map spanning multiple failure modes", () => {
    let run = startAutoCaptureTraceRun({
      sessionTraceId: "session-test-001",
      enabled: true,
    });

    run = recordAutoCaptureTraceEvent(run, {
      step: "title",
      component: "ocr-service",
      category: "communication",
      action: "request_timeout",
      severity: "error",
      message: "OCR request timed out.",
      details: { attempt: 1, timeoutMs: 15000 },
    });

    run = recordAutoCaptureTraceEvent(run, {
      step: "toc",
      component: "toc-parser",
      category: "structure",
      action: "unit_detection_failed",
      severity: "warning",
      message: "Failed to detect unit heading from TOC page.",
      details: { pageIndex: 1 },
    });

    run = recordAutoCaptureTraceEvent(run, {
      step: "toc",
      component: "toc-parser",
      category: "structure",
      action: "hierarchy_conflict",
      severity: "warning",
      message: "Detected orphan chapter with no unit assignment.",
      details: { chapterNumber: "3" },
    });

    run = recordAutoCaptureFieldDecision(run, {
      step: "title",
      component: "metadata-mapper",
      fieldKey: "subject",
      value: "ELA",
      source: "vision",
      status: "rejected",
      reason: "No OCR evidence for ELA keywords in title page text.",
      details: { confidence: 0.91 },
    });

    run = recordAutoCaptureTraceEvent(run, {
      step: "toc",
      component: "server-upload",
      category: "upload",
      action: "validation_failed",
      severity: "error",
      message: "Server rejected upload due to hierarchy mismatch.",
      details: { code: "toc_hierarchy_invalid" },
    });

    run = completeAutoCaptureTraceRun(run, "failed");

    const latest = readLatestAutoCaptureTraceRun();
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe("failed");
    expect(latest?.stepsVisited).toContain("title");
    expect(latest?.stepsVisited).toContain("toc");
    expect(latest?.events.some((event) => event.action === "request_timeout")).toBe(true);
    expect(latest?.events.some((event) => event.action === "unit_detection_failed")).toBe(true);
    expect(latest?.events.some((event) => event.action === "hierarchy_conflict")).toBe(true);
    expect(latest?.events.some((event) => event.action === "validation_failed")).toBe(true);
    expect(latest?.fieldDecisions.some((decision) => decision.fieldKey === "subject" && decision.status === "rejected")).toBe(true);
    expect((latest?.summary.errors ?? 0) + (latest?.summary.warnings ?? 0)).toBeGreaterThan(0);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import {
  detectCourseForgeCacheState,
  getCurrentCacheMapSnapshot,
  recordCacheClearAction,
  recordCacheDetection,
  recordCacheRegression,
  recordCacheUsage,
  resetCacheTelemetryMap,
} from "../../src/core/services/cacheTelemetryService";

describe("cacheTelemetryService", () => {
  beforeEach(() => {
    resetCacheTelemetryMap();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("captures stale subject regression (Subject=ELA) in cache map", () => {
    recordCacheDetection({
      layer: "persisted-metadata",
      identifier: "metadata.subject",
      component: "metadata-parser",
      details: { value: "ELA" },
    });
    recordCacheUsage({
      layer: "persisted-metadata",
      identifier: "metadata.subject",
      component: "metadata-parser",
      status: "stale",
      reason: "Incoming OCR reported Science and stale metadata was rejected.",
    });
    recordCacheRegression({
      cause: "stale-metadata-subject",
      source: "metadata.subject",
      effect: "Subject mismatch avoided by rejecting stale ELA cache.",
      staleIdentifier: "metadata.subject",
    });

    const map = getCurrentCacheMapSnapshot();
    expect(map.detected.some((entry) => entry.identifier === "metadata.subject")).toBe(true);
    expect(map.staleOrMismatched.some((entry) => entry.identifier === "metadata.subject")).toBe(true);
    expect(map.regressions.some((entry) => entry.cause === "stale-metadata-subject")).toBe(true);
  });

  it("records stale TOC hierarchy usage and regeneration", () => {
    recordCacheDetection({
      layer: "cached-toc",
      identifier: "toc-autosave-session-1",
      component: "toc-parser",
    });
    recordCacheUsage({
      layer: "cached-toc",
      identifier: "toc-autosave-session-1",
      component: "toc-parser",
      status: "stale",
      reason: "TOC cache mismatch against fresh OCR pages.",
    });
    recordCacheUsage({
      layer: "cached-toc",
      identifier: "toc-autosave-session-1",
      component: "toc-parser",
      status: "regenerated",
      reason: "TOC was rebuilt from fresh OCR pages.",
    });

    const map = getCurrentCacheMapSnapshot();
    expect(map.staleOrMismatched).toHaveLength(1);
    expect(map.regenerated).toHaveLength(1);
  });

  it("records stuck upload cache detection and clear actions", () => {
    recordCacheDetection({
      layer: "cached-upload-state",
      identifier: "courseforge.autoTextbookUpload.v1",
      component: "auto-upload",
      details: { status: "preparing" },
    });
    recordCacheUsage({
      layer: "cached-upload-state",
      identifier: "courseforge.autoTextbookUpload.v1",
      component: "auto-upload",
      status: "stale",
      reason: "Upload remained in preparing beyond threshold.",
    });
    recordCacheClearAction({
      layer: "cached-upload-state",
      identifier: "courseforge.autoTextbookUpload.v1",
      component: "auto-upload",
      success: true,
      reason: "Force remove cleared stuck upload cache.",
    });

    const map = getCurrentCacheMapSnapshot();
    expect(map.detected).toHaveLength(1);
    expect(map.cleared).toHaveLength(1);
  });

  it("records communication token/session stale cache issues", () => {
    recordCacheDetection({
      layer: "token-session",
      identifier: "firebase.auth.token",
      component: "sync-service",
    });
    recordCacheUsage({
      layer: "token-session",
      identifier: "firebase.auth.token",
      component: "sync-service",
      status: "stale",
      reason: "Stale auth token rejected and forced refresh applied.",
    });

    const map = getCurrentCacheMapSnapshot();
    expect(map.staleOrMismatched.some((entry) => entry.layer === "token-session")).toBe(true);
  });

  it("detects local and session storage caches in browser state scan", async () => {
    window.localStorage.setItem("courseforge.cached.ocr.title", "v1");
    window.sessionStorage.setItem("courseforge.ui.tempState", "v2");

    const detected = await detectCourseForgeCacheState("test-scan");

    expect(detected.some((entry) => entry.layer === "localStorage")).toBe(true);
    expect(detected.some((entry) => entry.layer === "sessionStorage")).toBe(true);
  });

  it("records failed clear actions for locked/corrupted cache paths", () => {
    recordCacheClearAction({
      layer: "indexedDB",
      identifier: "courseforge-debug",
      component: "cache-clear",
      success: false,
      reason: "Database locked during deletion.",
      details: { error: "onblocked" },
    });

    const map = getCurrentCacheMapSnapshot();
    expect(map.issues).toHaveLength(1);
    expect(map.issues[0]?.identifier).toBe("courseforge-debug");
  });

  it("tracks multi-instance cache conflict regression", () => {
    recordCacheRegression({
      cause: "multi-instance-cache-conflict",
      source: "instance-lock-and-port-state",
      effect: "Second instance switched to existing process to avoid cache divergence.",
      details: { action: "switch" },
    });

    const map = getCurrentCacheMapSnapshot();
    expect(map.regressions).toHaveLength(1);
    expect(map.regressions[0]?.cause).toBe("multi-instance-cache-conflict");
  });
});

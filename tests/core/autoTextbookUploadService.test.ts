import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPersistedAutoTextbookUpload,
  hydratePersistedAutoTextbookUpload,
  initAutoTextbookUploadTracking,
  readPersistedAutoTextbookUpload,
  type AutoTextbookUploadSnapshot,
} from "../../src/core/services/autoTextbookUploadService";
import { useUIStore } from "../../src/webapp/store/uiStore";

const AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY = "courseforge.autoTextbookUpload.v1";

function makeSnapshot(overrides: Partial<AutoTextbookUploadSnapshot> = {}): AutoTextbookUploadSnapshot {
  const now = new Date().toISOString();
  return {
    sessionId: "test-session:pending",
    textbookId: "pending",
    title: "Test Textbook",
    isbnRaw: "9781234567890",
    status: "preparing",
    phase: "persisting",
    message: "Preparing...",
    totalItems: 10,
    completedItems: 0,
    pendingItems: 10,
    percentComplete: 0,
    writeCount: 0,
    readCount: 0,
    integrityState: "unknown",
    canResume: true,
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("autoTextbookUploadService – initAutoTextbookUploadTracking", () => {
  beforeEach(() => {
    window.localStorage.removeItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY);
    useUIStore.setState({ activeAutoTextbookUpload: null });
  });

  it("writes the snapshot to localStorage", () => {
    const snapshot = makeSnapshot();
    initAutoTextbookUploadTracking(snapshot);

    const raw = window.localStorage.getItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as AutoTextbookUploadSnapshot;
    expect(parsed.sessionId).toBe("test-session:pending");
    expect(parsed.status).toBe("preparing");
  });

  it("writes the snapshot to UIStore", () => {
    const snapshot = makeSnapshot();
    initAutoTextbookUploadTracking(snapshot);

    expect(useUIStore.getState().activeAutoTextbookUpload).toMatchObject({
      sessionId: "test-session:pending",
      status: "preparing",
    });
  });

  it("allows readPersistedAutoTextbookUpload to retrieve what was written", () => {
    const snapshot = makeSnapshot({ title: "Persisted Title" });
    initAutoTextbookUploadTracking(snapshot);

    const persisted = readPersistedAutoTextbookUpload();
    expect(persisted).not.toBeNull();
    expect(persisted?.title).toBe("Persisted Title");
  });

  it("overwrites a previously persisted snapshot with new data", () => {
    initAutoTextbookUploadTracking(makeSnapshot({ textbookId: "old-id" }));
    initAutoTextbookUploadTracking(makeSnapshot({ textbookId: "new-id" }));

    const persisted = readPersistedAutoTextbookUpload();
    expect(persisted?.textbookId).toBe("new-id");
  });
});

describe("autoTextbookUploadService – clearPersistedAutoTextbookUpload", () => {
  beforeEach(() => {
    window.localStorage.removeItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY);
    useUIStore.setState({ activeAutoTextbookUpload: null });
  });

  it("removes the snapshot from localStorage", () => {
    initAutoTextbookUploadTracking(makeSnapshot());
    clearPersistedAutoTextbookUpload();

    expect(window.localStorage.getItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY)).toBeNull();
  });

  it("clears the snapshot from UIStore", () => {
    initAutoTextbookUploadTracking(makeSnapshot());
    clearPersistedAutoTextbookUpload();

    expect(useUIStore.getState().activeAutoTextbookUpload).toBeNull();
  });

  it("is idempotent — calling twice does not throw", () => {
    expect(() => {
      clearPersistedAutoTextbookUpload();
      clearPersistedAutoTextbookUpload();
    }).not.toThrow();
  });

  it("returns null from readPersistedAutoTextbookUpload after clearing", () => {
    initAutoTextbookUploadTracking(makeSnapshot());
    clearPersistedAutoTextbookUpload();

    expect(readPersistedAutoTextbookUpload()).toBeNull();
  });
});

describe("autoTextbookUploadService – hydratePersistedAutoTextbookUpload", () => {
  beforeEach(() => {
    window.localStorage.removeItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY);
    useUIStore.setState({ activeAutoTextbookUpload: null });
  });

  it("restores a persisted snapshot into UIStore on app boot (simulated reload)", () => {
    const snapshot = makeSnapshot({ status: "paused", canResume: true });
    window.localStorage.setItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY, JSON.stringify(snapshot));

    // Simulate: UIStore is fresh (after page reload) but localStorage has persisted data
    useUIStore.setState({ activeAutoTextbookUpload: null });
    const hydrated = hydratePersistedAutoTextbookUpload();

    expect(hydrated).not.toBeNull();
    expect(hydrated?.status).toBe("paused");
    expect(useUIStore.getState().activeAutoTextbookUpload?.status).toBe("paused");
  });

  it("returns null and leaves UIStore clean when nothing is persisted", () => {
    const result = hydratePersistedAutoTextbookUpload();
    expect(result).toBeNull();
    expect(useUIStore.getState().activeAutoTextbookUpload).toBeNull();
  });

  it("does not hydrate corrupt localStorage data", () => {
    window.localStorage.setItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY, "{ invalid json {{");
    const result = hydratePersistedAutoTextbookUpload();
    expect(result).toBeNull();
  });
});

describe("autoTextbookUploadService – localStorage persistence round-trip", () => {
  beforeEach(() => {
    window.localStorage.removeItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY);
    useUIStore.setState({ activeAutoTextbookUpload: null });
  });

  it("initAutoTextbookUploadTracking → hydratePersistedAutoTextbookUpload round-trip", () => {
    const snapshot = makeSnapshot({ status: "preparing", canResume: true });
    initAutoTextbookUploadTracking(snapshot);

    // Simulate reload: clear UIStore, then hydrate from localStorage
    useUIStore.setState({ activeAutoTextbookUpload: null });
    const hydrated = hydratePersistedAutoTextbookUpload();

    expect(hydrated?.status).toBe("preparing");
    expect(hydrated?.canResume).toBe(true);
    expect(useUIStore.getState().activeAutoTextbookUpload?.title).toBe("Test Textbook");
  });

  it("clearPersistedAutoTextbookUpload removes data so hydrate returns null on next boot", () => {
    initAutoTextbookUploadTracking(makeSnapshot());
    clearPersistedAutoTextbookUpload();

    useUIStore.setState({ activeAutoTextbookUpload: null });
    expect(hydratePersistedAutoTextbookUpload()).toBeNull();
    expect(useUIStore.getState().activeAutoTextbookUpload).toBeNull();
  });
});

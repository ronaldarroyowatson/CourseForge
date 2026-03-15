import { beforeEach, describe, expect, it, vi } from "vitest";

const addDocMock = vi.hoisted(() => vi.fn<(arg0: unknown, arg1: unknown) => Promise<{ id: string }>>(async () => ({ id: "debug-report-1" })));
const collectionMock = vi.hoisted(() => vi.fn<(arg0: unknown, arg1: string) => { path: string }>((_db, path) => ({ path })));

vi.mock("../../src/firebase/firestore", () => ({
  firestoreDb: {},
}));

vi.mock("firebase/firestore", () => ({
  addDoc: (arg0: unknown, arg1: unknown) => addDocMock(arg0, arg1),
  collection: (arg0: unknown, arg1: string) => collectionMock(arg0, arg1),
  serverTimestamp: () => "server-ts",
}));

import {
  appendDebugLogEntry,
  clearDebugLogEntries,
  getDebugLogEntries,
  isDebugLoggingEnabled,
  setDebugLoggingEnabled,
  uploadAndClearDebugLogs,
} from "../../src/core/services/debugLogService";

describe("debugLogService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    addDocMock.mockClear();
    collectionMock.mockClear();
  });

  it("enables and disables debug logging", () => {
    expect(isDebugLoggingEnabled()).toBe(false);
    setDebugLoggingEnabled(true);
    expect(isDebugLoggingEnabled()).toBe(true);
    setDebugLoggingEnabled(false);
    expect(isDebugLoggingEnabled()).toBe(false);
  });

  it("drops oldest entries when max size is exceeded", () => {
    setDebugLoggingEnabled(true);

    appendDebugLogEntry({ eventType: "info", message: "entry-1", timestamp: "2026-01-01T00:00:00.000Z" }, 180);
    appendDebugLogEntry({ eventType: "info", message: "entry-2", timestamp: "2026-01-01T00:00:01.000Z" }, 180);
    appendDebugLogEntry({ eventType: "info", message: "entry-3", timestamp: "2026-01-01T00:00:02.000Z" }, 180);

    const entries = getDebugLogEntries();
    const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    expect(totalBytes).toBeLessThanOrEqual(180);
    expect(entries.at(-1)?.message).toBe("entry-3");
  });

  it("clears local debug log entries", () => {
    setDebugLoggingEnabled(true);
    appendDebugLogEntry({ eventType: "info", message: "to-clear" });
    expect(getDebugLogEntries().length).toBe(1);

    clearDebugLogEntries();
    expect(getDebugLogEntries()).toEqual([]);
  });

  it("uploads logs to cloud and removes local copy", async () => {
    setDebugLoggingEnabled(true);
    appendDebugLogEntry({ eventType: "auto_mode", message: "capture start" });
    appendDebugLogEntry({ eventType: "auto_mode", message: "capture finish" });

    const result = await uploadAndClearDebugLogs({ userId: "teacher-1", appVersion: "1.2.3" });

    expect(result.uploadedCount).toBe(2);
    expect(collectionMock).toHaveBeenCalledWith(expect.anything(), "debugReports");
    expect(addDocMock).toHaveBeenCalledTimes(1);
    expect(getDebugLogEntries()).toEqual([]);
  });
});

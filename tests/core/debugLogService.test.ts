import { beforeEach, describe, expect, it, vi } from "vitest";

const callableRegistry = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
  return {
    handlers,
    register(name: string, handler: (payload: unknown) => Promise<unknown>): void {
      handlers.set(name, handler);
    },
    clear(): void {
      handlers.clear();
    },
  };
});

vi.mock("../../src/firebase/functions", () => ({
  functionsClient: {},
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_client: unknown, name: string) => {
    return async (payload: unknown) => {
      const handler = callableRegistry.handlers.get(name);
      if (!handler) {
        throw new Error(`Missing callable mock for ${name}`);
      }
      return { data: await handler(payload) };
    };
  },
}));

import {
  appendDebugLogEntry,
  clearDebugLogEntries,
  getDebugLogEntries,
  getDebugLogStorageStats,
  isDebugLoggingEnabled,
  setDebugLoggingEnabled,
  uploadAndClearDebugLogs,
} from "../../src/core/services/debugLogService";

function registerDefaultPolicy(): void {
  callableRegistry.register("getDebugLoggingPolicy", async () => ({
    success: true,
    data: {
      enabledGlobally: true,
      disabledUserIds: [],
      maxUploadBytes: 600 * 1024,
      maxLocalLogBytes: 500,
      updatedBy: "admin-1",
      updatedAt: "2026-03-15T00:00:00.000Z",
    },
  }));
}

describe("debugLogService", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    callableRegistry.clear();
    registerDefaultPolicy();
    callableRegistry.register("uploadDebugLogReport", async (payload) => {
      const data = payload as { entries?: unknown[] };
      const count = Array.isArray(data.entries) ? data.entries.length : 0;
      return {
        success: true,
        data: {
          reportId: "1710500000000",
          uploadedCount: count,
          uploadedAt: 1_710_500_000_000,
        },
      };
    });

    await clearDebugLogEntries();
  });

  it("enables and disables debug logging", () => {
    expect(isDebugLoggingEnabled()).toBe(false);
    setDebugLoggingEnabled(true);
    expect(isDebugLoggingEnabled()).toBe(true);
    setDebugLoggingEnabled(false);
    expect(isDebugLoggingEnabled()).toBe(false);
  });

  it("drops oldest entries when max local size is exceeded", async () => {
    setDebugLoggingEnabled(true);

    await appendDebugLogEntry({ eventType: "info", message: "entry-1" }, "teacher-1");
    await appendDebugLogEntry({ eventType: "info", message: "entry-2" }, "teacher-1");
    await appendDebugLogEntry({ eventType: "info", message: "entry-3" }, "teacher-1");

    const entries = await getDebugLogEntries();
    const stats = await getDebugLogStorageStats();

    expect(stats.totalBytes).toBeLessThanOrEqual(500);
    expect(entries.at(-1)?.message).toBe("entry-3");
  });

  it("clears local debug log entries", async () => {
    setDebugLoggingEnabled(true);
    await appendDebugLogEntry({ eventType: "info", message: "to-clear" }, "teacher-1");
    expect((await getDebugLogEntries()).length).toBe(1);

    await clearDebugLogEntries();
    expect(await getDebugLogEntries()).toEqual([]);
  });

  it("uploads logs to cloud and removes local copy", async () => {
    setDebugLoggingEnabled(true);
    await appendDebugLogEntry({ eventType: "auto_capture_start", message: "capture start", autoModeStep: "cover" }, "teacher-1");
    await appendDebugLogEntry({ eventType: "auto_capture_complete", message: "capture finish", autoModeStep: "cover" }, "teacher-1");

    const result = await uploadAndClearDebugLogs({ userId: "teacher-1", appVersion: "1.2.3" });

    expect(result.uploadedCount).toBe(2);
    expect(await getDebugLogEntries()).toEqual([]);
  });

  it("rejects uploads larger than policy limit", async () => {
    setDebugLoggingEnabled(true);

    callableRegistry.register("getDebugLoggingPolicy", async () => ({
      success: true,
      data: {
        enabledGlobally: true,
        disabledUserIds: [],
        maxUploadBytes: 60,
        maxLocalLogBytes: 10_000,
        updatedBy: "admin-1",
        updatedAt: "2026-03-15T00:00:00.000Z",
      },
    }));

    await appendDebugLogEntry({ eventType: "info", message: "x".repeat(300) }, "teacher-1");

    await expect(uploadAndClearDebugLogs({ userId: "teacher-1" })).rejects.toThrow(
      "Debug log too large to upload"
    );
  });

  it("no-ops when global policy disables debug logging", async () => {
    setDebugLoggingEnabled(true);
    callableRegistry.register("getDebugLoggingPolicy", async () => ({
      success: true,
      data: {
        enabledGlobally: false,
        disabledUserIds: [],
        maxUploadBytes: 500 * 1024,
        maxLocalLogBytes: 1_500_000,
        updatedBy: "admin-1",
        updatedAt: "2026-03-15T00:00:00.000Z",
      },
    }));

    const entry = await appendDebugLogEntry({ eventType: "info", message: "blocked" }, "teacher-1");
    expect(entry).toBeNull();
    expect(await getDebugLogEntries()).toEqual([]);
  });
});

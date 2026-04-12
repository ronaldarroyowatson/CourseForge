import { beforeEach, describe, expect, it, vi } from "vitest";

const forceRemoveMock = vi.hoisted(() => vi.fn(async () => true));
const clearPersistedMock = vi.hoisted(() => vi.fn(() => undefined));
const clearDebugMock = vi.hoisted(() => vi.fn(async () => undefined));
const appendDebugMock = vi.hoisted(() => vi.fn(async () => null));
const clearSyncRuntimeCachesMock = vi.hoisted(() => vi.fn(() => undefined));

vi.mock("../../src/core/services/autoTextbookUploadService", () => ({
  forceRemoveAutoTextbookUpload: forceRemoveMock,
  clearPersistedAutoTextbookUpload: clearPersistedMock,
}));

vi.mock("../../src/core/services/debugLogService", () => ({
  clearDebugLogEntries: clearDebugMock,
  appendDebugLogEntry: appendDebugMock,
}));

vi.mock("../../src/core/services/syncService", () => ({
  clearSyncRuntimeCaches: clearSyncRuntimeCachesMock,
}));

import { clearAllCourseForgeCaches } from "../../src/core/services/cacheControlService";

describe("cacheControlService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    forceRemoveMock.mockClear();
    clearPersistedMock.mockClear();
    clearDebugMock.mockClear();
    appendDebugMock.mockClear();
    clearSyncRuntimeCachesMock.mockClear();
  });

  it("clears CourseForge local/session storage entries and runtime caches", async () => {
    window.localStorage.setItem("courseforge.autoTextbookUpload.v1", "{}");
    window.localStorage.setItem("courseforge.sync.writeBudgetDaily", "{}");
    window.localStorage.setItem("other.app.key", "keep");
    window.sessionStorage.setItem("courseforge.temp", "1");

    const summary = await clearAllCourseForgeCaches("test");

    expect(clearSyncRuntimeCachesMock).toHaveBeenCalledTimes(1);
    expect(summary.localStorageKeysRemoved).toContain("courseforge.autoTextbookUpload.v1");
    expect(summary.localStorageKeysRemoved).toContain("courseforge.sync.writeBudgetDaily");
    expect(summary.sessionStorageKeysRemoved).toContain("courseforge.temp");
    expect(window.localStorage.getItem("other.app.key")).toBe("keep");
    expect(clearDebugMock).toHaveBeenCalledTimes(1);
    expect(appendDebugMock).toHaveBeenCalledTimes(1);
  });
});

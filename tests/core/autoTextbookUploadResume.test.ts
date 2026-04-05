import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../src/webapp/store/uiStore";

const dbMockState = vi.hoisted(() => ({
  textbooks: [] as Array<Record<string, unknown>>,
  chapters: [] as Array<Record<string, unknown>>,
  sections: [] as Array<Record<string, unknown>>,
}));

const syncNowMock = vi.hoisted(() => vi.fn<(deps?: unknown) => Promise<{
  success: boolean;
  message: string;
  retryable: boolean;
  permissionDenied: boolean;
  throttled: boolean;
  writeLoopTriggered: boolean;
  writeBudgetExceeded: boolean;
  writeCount: number;
  writeBudgetLimit: number;
  readCount: number;
  readBudgetLimit: number;
  readBudgetExceeded: boolean;
  retryLimit: number;
  errorCode: string | null;
  pendingCount: number;
}>>(async () => ({
  success: true,
  message: "Cloud sync completed.",
  retryable: false,
  permissionDenied: false,
  throttled: false,
  writeLoopTriggered: false,
  writeBudgetExceeded: false,
  writeCount: 0,
  writeBudgetLimit: 500,
  readCount: 2385,
  readBudgetLimit: 5000,
  readBudgetExceeded: false,
  retryLimit: 3,
  errorCode: null,
  pendingCount: 0,
})));

const getCurrentUserMock = vi.hoisted(() => vi.fn(() => null));

vi.mock("../../src/core/services/db", () => ({
  STORE_NAMES: {
    textbooks: "textbooks",
    chapters: "chapters",
    sections: "sections",
  },
  getAll: vi.fn(async (storeName: "textbooks" | "chapters" | "sections") => dbMockState[storeName] ?? []),
  save: vi.fn(async (_storeName: string, value: { id: string }) => value.id),
}));

vi.mock("../../src/core/services/syncService", () => ({
  syncNow: (deps?: unknown) => syncNowMock(deps),
}));

vi.mock("../../src/firebase/auth", () => ({
  getCurrentUser: () => getCurrentUserMock(),
}));

vi.mock("../../src/firebase/firestore", () => ({
  firestoreDb: {},
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  deleteDoc: vi.fn(async () => undefined),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  getDocs: vi.fn(async () => ({ docs: [] })),
}));

import {
  initAutoTextbookUploadTracking,
  resumePersistedAutoTextbookUpload,
  type AutoTextbookUploadSnapshot,
} from "../../src/core/services/autoTextbookUploadService";

const AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY = "courseforge.autoTextbookUpload.v1";

function makePersistedSnapshot(overrides: Partial<AutoTextbookUploadSnapshot> = {}): AutoTextbookUploadSnapshot {
  const now = new Date().toISOString();
  return {
    sessionId: "resume:test",
    textbookId: "pending",
    title: "Methods of Science",
    isbnRaw: "9781402891001",
    status: "paused",
    phase: "failed",
    message: "Upload paused.",
    totalItems: 268,
    completedItems: 0,
    pendingItems: 268,
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

describe("autoTextbookUploadService resume recovery", () => {
  beforeEach(() => {
    dbMockState.textbooks = [];
    dbMockState.chapters = [];
    dbMockState.sections = [];
    syncNowMock.mockClear();
    getCurrentUserMock.mockReturnValue(null);
    window.localStorage.removeItem(AUTO_TEXTBOOK_UPLOAD_STORAGE_KEY);
    useUIStore.setState({ activeAutoTextbookUpload: null });
  });

  it("recovers pending textbookId from local textbook records before resuming", async () => {
    dbMockState.textbooks = [
      {
        id: "tb-real-001",
        title: "Methods of Science",
        isbnRaw: "9781402891001",
        pendingSync: true,
        lastModified: "2026-04-05T12:00:00.000Z",
      },
    ];

    initAutoTextbookUploadTracking(makePersistedSnapshot({ textbookId: "pending" }));

    const result = await resumePersistedAutoTextbookUpload();

    expect(result?.success).toBe(true);
    expect(syncNowMock).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().activeAutoTextbookUpload?.textbookId).toBe("tb-real-001");
  });

  it("fails safely when pending textbookId cannot be resolved and avoids read-only sync", async () => {
    initAutoTextbookUploadTracking(makePersistedSnapshot({ textbookId: "pending" }));

    const result = await resumePersistedAutoTextbookUpload();

    expect(result).toBeNull();
    expect(syncNowMock).not.toHaveBeenCalled();
    expect(useUIStore.getState().activeAutoTextbookUpload).toMatchObject({
      status: "failed",
      canResume: false,
    });
  });
});

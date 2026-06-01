import { beforeEach, describe, expect, it, vi } from "vitest";

const setDocMock = vi.hoisted(() => vi.fn(async () => undefined));
const getDocMock = vi.hoisted(() => vi.fn(async () => ({ exists: () => false })));
const docMock = vi.hoisted(() => vi.fn((_: unknown, path: string) => ({ path })));
const writeToAzureMock = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<unknown>>(async () => undefined));
const readFromAzureMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("firebase/firestore", () => ({
  doc: docMock,
  getDoc: getDocMock,
  setDoc: setDocMock,
}));

vi.mock("../../src/firebase/firestore", () => ({
  firestoreDb: {},
}));

vi.mock("../../src/services/azureSyncService", () => ({
  readFromAzure: readFromAzureMock,
  writeToAzure: writeToAzureMock,
}));

vi.mock("../../src/firebase/auth", () => ({
  getCurrentUser: vi.fn(() => null),
  getStoredLocalAuthSession: vi.fn(() => null),
}));

vi.mock("../../src/webapp/store/uiStore", () => ({
  useUIStore: {
    getState: vi.fn(() => ({
      addSyncDebugEvent: vi.fn(),
      setSyncStatus: vi.fn(),
      setLastSyncError: vi.fn(),
      setSyncErrorCode: vi.fn(),
      setPermissionDeniedSyncBlocked: vi.fn(),
      setLastSyncAt: vi.fn(),
      setPendingSyncCount: vi.fn(),
      setSyncDiagnostics: vi.fn(),
      setLastSyncSummary: vi.fn(),
      markLocalChange: vi.fn(),
    })),
  },
}));

import { syncWrite } from "../../src/services/syncService";

function createDeferredPromise(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("syncWrite coalescing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collapses repeated writes for the same record to the latest payload", async () => {
    const firstAzureWrite = createDeferredPromise();
    let azureCallCount = 0;

    writeToAzureMock.mockImplementation(async (...args: any[]) => {
      const data = args[2] as { value: number };
      azureCallCount += 1;
      if (azureCallCount === 1) {
        await firstAzureWrite.promise;
      }

      return data;
    });

    const firstWrite = syncWrite("textbooks", "tb-1", { value: 1 });
    const secondWrite = syncWrite("textbooks", "tb-1", { value: 2 });

    firstAzureWrite.resolve();
    await Promise.all([firstWrite, secondWrite]);

    expect(setDocMock).toHaveBeenCalledTimes(2);
    const firstSetDocCall = setDocMock.mock.calls[0] as unknown as unknown[];
    const secondSetDocCall = setDocMock.mock.calls[1] as unknown as unknown[];
    expect((firstSetDocCall[1] as { value?: number }).value).toBe(1);
    expect((secondSetDocCall[1] as { value?: number }).value).toBe(2);
    expect(writeToAzureMock).toHaveBeenCalledTimes(2);
    const firstAzureCall = writeToAzureMock.mock.calls[0] as unknown as unknown[];
    const secondAzureCall = writeToAzureMock.mock.calls[1] as unknown as unknown[];
    expect(firstAzureCall[2]).toEqual({ value: 1 });
    expect(secondAzureCall[2]).toEqual({ value: 2 });
  });
});

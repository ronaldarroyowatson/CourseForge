import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMocks = vi.hoisted(() => {
  const collectionGroup = vi.fn((_: unknown, name: string) => ({ kind: "collectionGroup", name }));
  const collection = vi.fn((_: unknown, path: string) => ({ kind: "collection", path }));
  const where = vi.fn((field: string, op: string, value: string) => ({ field, op, value }));
  const query = vi.fn((base: unknown, ...constraints: unknown[]) => ({ kind: "query", base, constraints }));
  const getDocs = vi.fn();
  const doc = vi.fn((_: unknown, path: string) => ({ path }));
  const deleteDoc = vi.fn().mockResolvedValue(undefined);
  const setDoc = vi.fn().mockResolvedValue(undefined);

  return {
    collectionGroup,
    collection,
    where,
    query,
    getDocs,
    doc,
    deleteDoc,
    setDoc,
  };
});

vi.mock("firebase/firestore", () => ({
  collectionGroup: firestoreMocks.collectionGroup,
  collection: firestoreMocks.collection,
  where: firestoreMocks.where,
  query: firestoreMocks.query,
  getDocs: firestoreMocks.getDocs,
  doc: firestoreMocks.doc,
  deleteDoc: firestoreMocks.deleteDoc,
  setDoc: firestoreMocks.setDoc,
}));

vi.mock("../../src/firebase/firestore", () => ({
  firestoreDb: {},
}));

vi.mock("../../src/firebase/auth", () => ({
  getAdminClaim: vi.fn(async () => false),
  getCurrentUser: vi.fn(() => null),
}));

vi.mock("../../src/webapp/store/uiStore", () => ({
  useUIStore: {
    getState: vi.fn(() => ({
      setSyncStatus: vi.fn(),
      setLastSyncError: vi.fn(),
      setSyncErrorCode: vi.fn(),
      setPermissionDeniedSyncBlocked: vi.fn(),
      addSyncDebugEvent: vi.fn(),
      setLastSyncAt: vi.fn(),
      setPendingSyncCount: vi.fn(),
      setSyncDiagnostics: vi.fn(),
      setLastSyncSummary: vi.fn(),
      markLocalChange: vi.fn(),
    })),
  },
}));

import { hardDeleteTextbookFromCloud } from "../../src/core/services/syncService";

describe("hardDeleteTextbookFromCloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    firestoreMocks.getDocs.mockImplementation(async (input: any) => {
      if (input?.kind === "query" && input?.base?.kind === "collectionGroup") {
        throw { code: "permission-denied" };
      }

      return { docs: [] };
    });
  });

  it("still deletes textbook root when collection-group reads are permission-denied", async () => {
    await expect(hardDeleteTextbookFromCloud("user-1", "tb-1")).resolves.toBeUndefined();

    expect(firestoreMocks.deleteDoc).toHaveBeenCalledWith({ path: "textbooks/tb-1" });
  });
});

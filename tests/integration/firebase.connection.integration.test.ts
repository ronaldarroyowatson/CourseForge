import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../src/webapp/store/uiStore";

type MockQueryClause = { field: string; op: string; value: unknown };
type MockQuery = {
  ref: { kind: "collection" | "collectionGroup"; name: string };
  clauses: MockQueryClause[];
};

function createMockDoc(pathValue: string, id: string, data: Record<string, unknown>) {
  return {
    id,
    ref: { path: pathValue },
    data: () => data,
  };
}

async function importAuthModule(options: {
  extensionRuntime?: boolean;
  signInUser?: { uid: string; email?: string | null; displayName?: string | null };
} = {}) {
  vi.resetModules();

  const authInstance = { currentUser: null };
  const signInUser = options.signInUser ?? { uid: "teacher-auth", email: "teacher@example.com", displayName: "Teacher" };

  const getAuth = vi.fn().mockReturnValue(authInstance);
  const initializeAuth = vi.fn().mockReturnValue(authInstance);
  const setPersistence = vi.fn().mockResolvedValue(undefined);
  const signInWithPopup = vi.fn().mockResolvedValue({ user: signInUser });
  const onIdTokenChanged = vi.fn().mockReturnValue(vi.fn());
  const signOut = vi.fn().mockResolvedValue(undefined);

  vi.doMock("firebase/auth", () => ({
    getAuth,
    initializeAuth,
    browserLocalPersistence: {},
    GoogleAuthProvider: vi.fn(),
    setPersistence,
    signInWithPopup,
    onIdTokenChanged,
    signOut,
  }));

  vi.doMock("firebase/auth/web-extension", () => ({
    browserPopupRedirectResolver: {},
  }));

  vi.doMock("../../src/firebase/firebaseApp", () => ({ firebaseApp: {} }));
  vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));
  vi.doMock("../../src/firebase/firebaseConfig", () => ({
    getFirebaseConfigError: () => null,
  }));

  if (options.extensionRuntime) {
    (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome = { runtime: { id: "extension-runtime" } };
  } else {
    delete (globalThis as { chrome?: unknown }).chrome;
  }

  const authModule = await import("../../src/firebase/auth");

  return {
    authModule,
    mocks: {
      getAuth,
      initializeAuth,
      setPersistence,
      signInWithPopup,
      onIdTokenChanged,
      signOut,
    },
  };
}

async function importSyncServiceModule(options: {
  localByStore?: Partial<Record<string, Array<Record<string, unknown>>>>;
  cloudQueryDocs?: Partial<Record<string, Array<ReturnType<typeof createMockDoc>>>>;
  currentUid?: string;
} = {}) {
  vi.resetModules();

  const getAll = vi.fn(async (storeName: string) => options.localByStore?.[storeName] ?? []);
  const save = vi.fn(async (_storeName: string, item: { id?: string }) => item.id ?? "saved-id");
  const deleteLocal = vi.fn(async () => undefined);

  const where = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
  const collection = vi.fn((_db: unknown, name: string) => ({ kind: "collection" as const, name }));
  const collectionGroup = vi.fn((_db: unknown, name: string) => ({ kind: "collectionGroup" as const, name }));
  const query = vi.fn((ref: MockQuery["ref"], ...clauses: MockQueryClause[]) => ({ ref, clauses }));
  const docFn = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }));
  const setDoc = vi.fn(async () => undefined);
  const deleteDoc = vi.fn(async () => undefined);
  const getDocs = vi.fn(async (queryObject: MockQuery) => {
    const ownerClause = queryObject.clauses.find((clause) => clause.field === "ownerId");
    const userClause = queryObject.clauses.find((clause) => clause.field === "userId");
    const ownerOrUserField = ownerClause ? "ownerId" : userClause ? "userId" : "none";
    const key = `${queryObject.ref.kind}:${queryObject.ref.name}:${ownerOrUserField}`;
    return { docs: options.cloudQueryDocs?.[key] ?? [] };
  });

  vi.doMock("../../src/core/services/db", () => ({
    STORE_NAMES: {
      textbooks: "textbooks",
      chapters: "chapters",
      sections: "sections",
      vocabTerms: "vocabTerms",
      equations: "equations",
      concepts: "concepts",
      keyIdeas: "keyIdeas",
    },
    getAll,
    save,
    delete: deleteLocal,
  }));

  vi.doMock("firebase/firestore", () => ({
    where,
    collection,
    collectionGroup,
    query,
    doc: docFn,
    setDoc,
    deleteDoc,
    getDocs,
  }));

  vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));
  vi.doMock("../../src/firebase/auth", () => ({
    getCurrentUser: () => ({ uid: options.currentUid ?? "teacher-app" }),
    getAdminClaim: async () => false,
  }));
  vi.doMock("../../src/webapp/store/uiStore", () => ({
    useUIStore: {
      getState: () => ({ addSyncDebugEvent: () => undefined }),
    },
  }));

  const syncModule = await import("../../src/core/services/syncService");
  syncModule.resetSyncSafetyStateForTests();

  return {
    syncModule,
    mocks: {
      getAll,
      save,
      deleteLocal,
      where,
      collection,
      collectionGroup,
      query,
      docFn,
      setDoc,
      deleteDoc,
      getDocs,
    },
  };
}

describe("Firebase connection + sync integration flows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("Firebase initialization success path resolves persistent auth", async () => {
    const { authModule, mocks } = await importAuthModule({ extensionRuntime: false });

    const auth = await authModule.initializePersistentAuth();

    expect(auth).toBeDefined();
    expect(mocks.getAuth).toHaveBeenCalledTimes(1);
    expect(mocks.setPersistence).toHaveBeenCalledTimes(1);
  });

  it("Google auth success path returns signed-in user", async () => {
    const { authModule, mocks } = await importAuthModule({
      signInUser: {
        uid: "google-user-1",
        email: "google-user@example.com",
        displayName: "Google User",
      },
    });

    const user = await authModule.signInWithGoogle();

    expect(user.uid).toBe("google-user-1");
    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
  });

  it("Firestore read success path downloads cloud documents into local stores", async () => {
    const cloudTextbookDoc = createMockDoc("textbooks/tb-read-1", "tb-read-1", {
      id: "tb-read-1",
      userId: "teacher-read",
      ownerId: "teacher-read",
      title: "Read Textbook",
      grade: "9",
      subject: "Science",
      edition: "1",
      publicationYear: 2026,
      isbnRaw: "1111111111111",
      isbnNormalized: "1111111111111",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:00:00.000Z",
      lastModified: "2026-03-12T00:00:00.000Z",
      pendingSync: false,
      source: "cloud",
      isFavorite: false,
      isArchived: false,
    });

    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-read",
      cloudQueryDocs: {
        "collection:textbooks:userId": [cloudTextbookDoc],
      },
    });

    await expect(syncModule.downloadCloudData("teacher-read")).resolves.toBeUndefined();
    expect(mocks.getDocs).toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalled();
  });

  it("Firestore write success path uploads minimal local payload", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      localByStore: {
        textbooks: [
          {
            id: "tb-write-1",
            title: "Write Textbook",
            grade: "8",
            subject: "Math",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "2222222222222",
            isbnNormalized: "2222222222222",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T00:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
      currentUid: "teacher-write",
    });

    await expect(syncModule.uploadLocalChanges("teacher-write")).resolves.toBeUndefined();

    expect(mocks.setDoc).toHaveBeenCalled();
    const writtenPayload = (mocks.setDoc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(writtenPayload.userId).toBe("teacher-write");
    expect(writtenPayload.ownerId).toBe("teacher-write");
    expect(writtenPayload.pendingSync).toBe(false);
    expect(writtenPayload.source).toBe("cloud");
    expect(writtenPayload.lastModified).toBe("2026-03-12T00:00:00.000Z");
  });

  it("local->cloud and cloud->local sync invocation succeeds for app-like usage", async () => {
    const { syncModule } = await importSyncServiceModule({
      localByStore: {
        textbooks: [
          {
            id: "tb-app-1",
            title: "App Local",
            grade: "7",
            subject: "History",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "3333333333333",
            isbnNormalized: "3333333333333",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T00:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
      currentUid: "teacher-app-flow",
      cloudQueryDocs: {
        "collection:textbooks:userId": [
          createMockDoc("textbooks/tb-app-cloud", "tb-app-cloud", {
            id: "tb-app-cloud",
            userId: "teacher-app-flow",
            ownerId: "teacher-app-flow",
            title: "App Cloud",
            grade: "7",
            subject: "History",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "4444444444444",
            isbnNormalized: "4444444444444",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T00:00:00.000Z",
            pendingSync: false,
            source: "cloud",
            isFavorite: false,
            isArchived: false,
          }),
        ],
      },
    });

    await expect(syncModule.uploadLocalChanges("teacher-app-flow")).resolves.toBeUndefined();
    await expect(syncModule.downloadCloudData("teacher-app-flow")).resolves.toBeUndefined();
  });

  it("local->cloud and cloud->local sync invocation succeeds for extension-like usage", async () => {
    (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome = { runtime: { id: "extension-runtime" } };

    const { syncModule } = await importSyncServiceModule({
      localByStore: {
        textbooks: [
          {
            id: "tb-ext-1",
            title: "Extension Local",
            grade: "7",
            subject: "Biology",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "5555555555555",
            isbnNormalized: "5555555555555",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T00:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
      currentUid: "teacher-extension-flow",
      cloudQueryDocs: {
        "collection:textbooks:userId": [
          createMockDoc("textbooks/tb-ext-cloud", "tb-ext-cloud", {
            id: "tb-ext-cloud",
            userId: "teacher-extension-flow",
            ownerId: "teacher-extension-flow",
            title: "Extension Cloud",
            grade: "7",
            subject: "Biology",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "6666666666666",
            isbnNormalized: "6666666666666",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T00:00:00.000Z",
            pendingSync: false,
            source: "cloud",
            isFavorite: false,
            isArchived: false,
          }),
        ],
      },
    });

    await expect(syncModule.uploadLocalChanges("teacher-extension-flow")).resolves.toBeUndefined();
    await expect(syncModule.downloadCloudData("teacher-extension-flow")).resolves.toBeUndefined();
  });

  it("permission-denied is surfaced with clear guidance", async () => {
    const { syncModule } = await importSyncServiceModule({ currentUid: "teacher-denied" });

    const result = await syncModule.syncNow({
      nowFn: () => 10_000,
      getCurrentUserFn: () => ({ uid: "teacher-denied" }),
      getPendingSyncDiagnosticsFn: async () => ({ pendingCount: 1, byStore: {} }),
      syncUserDataFn: async () => {
        throw { code: "permission-denied", message: "Denied by rules" };
      },
    });

    expect(result.success).toBe(false);
    expect(result.permissionDenied).toBe(true);
    expect(result.message.toLowerCase()).toContain("permission denied");
    expect(result.message).toContain("Firestore rules");
  });
});

describe("Webapp/extension communication mutation checks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("detects pending sync rows by store and ignores non-pending rows", async () => {
    const { syncModule } = await importSyncServiceModule({
      currentUid: "teacher-pending",
      localByStore: {
        textbooks: [
          {
            id: "tb-pending-1",
            pendingSync: true,
            source: "local",
            title: "Pending",
            grade: "9",
            subject: "Science",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "7777777777777",
            isbnNormalized: "7777777777777",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T00:00:00.000Z",
            isFavorite: false,
            isArchived: false,
          },
        ],
        chapters: [
          {
            id: "ch-clean-1",
            textbookId: "tb-pending-1",
            index: 1,
            name: "No pending",
            pendingSync: false,
            source: "cloud",
            lastModified: "2026-03-12T00:00:00.000Z",
          },
        ],
      },
    });

    const diagnostics = await syncModule.getPendingSyncDiagnostics();
    expect(diagnostics.pendingCount).toBe(1);
    expect(diagnostics.byStore.textbooks).toBe(1);
    expect(diagnostics.byStore.chapters).toBe(0);
  });

  it("resolves sync conflict in favor of newer local timestamp and uploads canonical payload", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-conflict",
      localByStore: {
        textbooks: [
          {
            id: "tb-conflict-1",
            title: "Local Winner",
            grade: "8",
            subject: "Math",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "8888888888888",
            isbnNormalized: "8888888888888",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T02:00:00.000Z",
            pendingSync: false,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
      cloudQueryDocs: {
        "collection:textbooks:userId": [
          createMockDoc("textbooks/tb-conflict-1", "tb-conflict-1", {
            id: "tb-conflict-1",
            userId: "teacher-conflict",
            ownerId: "teacher-conflict",
            title: "Cloud Older",
            grade: "8",
            subject: "Math",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "8888888888888",
            isbnNormalized: "8888888888888",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: false,
            source: "cloud",
            isFavorite: false,
            isArchived: false,
          }),
        ],
      },
    });

    await syncModule.syncUserData("teacher-conflict");

    expect(mocks.setDoc).toHaveBeenCalled();
    const cloudPayload = (mocks.setDoc.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(cloudPayload.title).toBe("Local Winner");
    expect(cloudPayload.ownerId).toBe("teacher-conflict");
    expect(cloudPayload.pendingSync).toBe(false);
  });

  it("resolves sync conflict in favor of newer cloud timestamp (false-negative mutation guard)", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-conflict-cloud",
      localByStore: {
        textbooks: [
          {
            id: "tb-conflict-2",
            title: "Local Older",
            grade: "8",
            subject: "Math",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "9999999999999",
            isbnNormalized: "9999999999999",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: false,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
      cloudQueryDocs: {
        "collection:textbooks:userId": [
          createMockDoc("textbooks/tb-conflict-2", "tb-conflict-2", {
            id: "tb-conflict-2",
            userId: "teacher-conflict-cloud",
            ownerId: "teacher-conflict-cloud",
            title: "Cloud Winner",
            grade: "8",
            subject: "Math",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "9999999999999",
            isbnNormalized: "9999999999999",
            lastModified: "2026-03-12T03:00:00.000Z",
            pendingSync: false,
            source: "cloud",
            isFavorite: false,
            isArchived: false,
          }),
        ],
      },
    });

    await syncModule.syncUserData("teacher-conflict-cloud");

    expect(mocks.setDoc).not.toHaveBeenCalled();
    const saveCalls = mocks.save.mock.calls as Array<[string, Record<string, unknown>]>;
    const textbookSave = saveCalls.find((call) => call[0] === "textbooks");
    expect(textbookSave?.[1]?.title).toBe("Cloud Winner");
  });

  it("surfaces permission-denied during upload with Firestore rules guidance", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-upload-denied",
      localByStore: {
        textbooks: [
          {
            id: "tb-denied-1",
            title: "Denied",
            grade: "7",
            subject: "History",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "1212121212121",
            isbnNormalized: "1212121212121",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T00:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
    });

    mocks.setDoc.mockRejectedValueOnce({ code: "permission-denied", message: "Denied by rules" });
    await expect(syncModule.uploadLocalChanges("teacher-upload-denied")).rejects.toThrow("Firestore rules");
  });

});

describe("Cross-surface pipeline communication", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("webapp -> firestore -> extension pipeline keeps canonical ids and avoids tampered cloud ids", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-pipeline-a",
      localByStore: {
        textbooks: [
          {
            id: "tb-pipeline-a-local",
            title: "Pipeline A",
            grade: "6",
            subject: "Science",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "1313131313131",
            isbnNormalized: "1313131313131",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
      cloudQueryDocs: {
        "collection:textbooks:userId": [
          createMockDoc("textbooks/tb-pipeline-a-cloud", "tb-pipeline-a-cloud", {
            id: "tb-tampered-id",
            userId: "teacher-pipeline-a",
            ownerId: "teacher-pipeline-a",
            title: "Pipeline Cloud",
            grade: "6",
            subject: "Science",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "1313131313131",
            isbnNormalized: "1313131313131",
            lastModified: "2026-03-12T02:00:00.000Z",
            pendingSync: false,
            source: "cloud",
            isFavorite: false,
            isArchived: false,
          }),
        ],
      },
    });

    await syncModule.uploadLocalChanges("teacher-pipeline-a");
    (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome = { runtime: { id: "extension-runtime" } };
    await syncModule.downloadCloudData("teacher-pipeline-a");

    expect(mocks.setDoc).toHaveBeenCalled();
    const saveCalls = mocks.save.mock.calls as Array<[string, Record<string, unknown>]>;
    expect(
      saveCalls.some(
        (call) =>
          call[0] === "textbooks" &&
          call[1]?.source === "cloud" &&
          call[1]?.id === "tb-pipeline-a-cloud"
      )
    ).toBe(true);
  });

  it("extension -> firestore -> webapp pipeline round-trip syncs local content", async () => {
    (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome = { runtime: { id: "extension-runtime" } };

    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-pipeline-b",
      localByStore: {
        textbooks: [
          {
            id: "tb-pipeline-b-local",
            title: "Pipeline B",
            grade: "5",
            subject: "Biology",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "1414141414141",
            isbnNormalized: "1414141414141",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
      cloudQueryDocs: {
        "collection:textbooks:userId": [
          createMockDoc("textbooks/tb-pipeline-b-cloud", "tb-pipeline-b-cloud", {
            id: "tb-pipeline-b-cloud",
            userId: "teacher-pipeline-b",
            ownerId: "teacher-pipeline-b",
            title: "Pipeline B Cloud",
            grade: "5",
            subject: "Biology",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "1414141414141",
            isbnNormalized: "1414141414141",
            lastModified: "2026-03-12T02:00:00.000Z",
            pendingSync: false,
            source: "cloud",
            isFavorite: false,
            isArchived: false,
          }),
        ],
      },
    });

    await syncModule.uploadLocalChanges("teacher-pipeline-b");
    delete (globalThis as { chrome?: unknown }).chrome;
    await syncModule.downloadCloudData("teacher-pipeline-b");

    expect(mocks.setDoc).toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalled();
  });

  it("webapp -> firestore -> function-like moderation -> firestore -> webapp applies moderated status", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-pipeline-c",
      localByStore: {
        sections: [
          {
            id: "sec-pipeline-c",
            textbookId: "tb-pipeline-c",
            chapterId: "ch-pipeline-c",
            index: 1,
            title: "Pipeline Section",
            notes: "draft notes",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
      },
      cloudQueryDocs: {
        "collectionGroup:sections:userId": [
          createMockDoc("textbooks/tb-pipeline-c/chapters/ch-pipeline-c/sections/sec-pipeline-c", "sec-pipeline-c", {
            id: "sec-pipeline-c",
            userId: "teacher-pipeline-c",
            ownerId: "teacher-pipeline-c",
            textbookId: "tb-pipeline-c",
            chapterId: "ch-pipeline-c",
            index: 1,
            title: "Pipeline Section",
            notes: "approved notes",
            status: "approved",
            lastModified: "2026-03-12T03:00:00.000Z",
            pendingSync: false,
            source: "cloud",
          }),
        ],
      },
    });

    await syncModule.uploadLocalChanges("teacher-pipeline-c");
    await syncModule.downloadCloudData("teacher-pipeline-c");

    const saveCalls = mocks.save.mock.calls as Array<[string, Record<string, unknown>]>;
    expect(
      saveCalls.some(
        (call) =>
          call[0] === "sections" &&
          call[1]?.source === "cloud" &&
          call[1]?.status === "approved" &&
          call[1]?.notes === "approved notes"
      )
    ).toBe(true);
  });

  it("extension -> firestore -> function-like moderation -> firestore -> extension updates section-scoped entities", async () => {
    (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome = { runtime: { id: "extension-runtime" } };

    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-pipeline-d",
      localByStore: {
        equations: [
          {
            id: "eq-pipeline-d",
            textbookId: "tb-pipeline-d",
            chapterId: "ch-pipeline-d",
            sectionId: "sec-pipeline-d",
            name: "Equation Draft",
            latex: "x+y=z",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
      },
      cloudQueryDocs: {
        "collectionGroup:equations:userId": [
          createMockDoc(
            "textbooks/tb-pipeline-d/chapters/ch-pipeline-d/sections/sec-pipeline-d/equations/eq-pipeline-d",
            "eq-pipeline-d",
            {
              id: "eq-pipeline-d",
              userId: "teacher-pipeline-d",
              ownerId: "teacher-pipeline-d",
              textbookId: "tb-pipeline-d",
              chapterId: "ch-pipeline-d",
              sectionId: "sec-pipeline-d",
              name: "Equation Approved",
              latex: "x+y=z",
              status: "approved",
              lastModified: "2026-03-12T04:00:00.000Z",
              pendingSync: false,
              source: "cloud",
            }
          ),
        ],
      },
    });

    await syncModule.uploadLocalChanges("teacher-pipeline-d");
    await syncModule.downloadCloudData("teacher-pipeline-d");

    const saveCalls = mocks.save.mock.calls as Array<[string, Record<string, unknown>]>;
    expect(
      saveCalls.some(
        (call) =>
          call[0] === "equations" &&
          call[1]?.source === "cloud" &&
          call[1]?.name === "Equation Approved" &&
          call[1]?.status === "approved"
      )
    ).toBe(true);
  });

  it("batch import upload writes canonical docs across hierarchy stores", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-batch",
      localByStore: {
        textbooks: [
          {
            id: "tb-batch",
            title: "Batch Textbook",
            grade: "10",
            subject: "Science",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "1515151515151",
            isbnNormalized: "1515151515151",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
        chapters: [
          {
            id: "ch-batch",
            textbookId: "tb-batch",
            index: 1,
            name: "Batch Chapter",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        sections: [
          {
            id: "sec-batch",
            textbookId: "tb-batch",
            chapterId: "ch-batch",
            index: 1,
            title: "Batch Section",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        vocabTerms: [
          {
            id: "v-batch",
            textbookId: "tb-batch",
            chapterId: "ch-batch",
            sectionId: "sec-batch",
            word: "Batch term",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        equations: [
          {
            id: "eq-batch",
            textbookId: "tb-batch",
            chapterId: "ch-batch",
            sectionId: "sec-batch",
            name: "Batch equation",
            latex: "a+b=c",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        concepts: [
          {
            id: "co-batch",
            textbookId: "tb-batch",
            chapterId: "ch-batch",
            sectionId: "sec-batch",
            name: "Batch concept",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        keyIdeas: [
          {
            id: "ki-batch",
            textbookId: "tb-batch",
            chapterId: "ch-batch",
            sectionId: "sec-batch",
            text: "Batch key idea",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
      },
    });

    await syncModule.uploadLocalChanges("teacher-batch");

    expect(mocks.setDoc).toHaveBeenCalledTimes(7);
  });

  it("uploads document-ingest records with canonical hierarchy paths so they are ready for cloud sync", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-doc-ingest",
      localByStore: {
        textbooks: [
          {
            id: "tb-doc-ingest",
            title: "Physical Science with Earth Science",
            grade: "8",
            subject: "Physical Science",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "1717171717171",
            isbnNormalized: "1717171717171",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
          },
        ],
        chapters: [
          {
            id: "ch-doc-ingest",
            textbookId: "tb-doc-ingest",
            index: 1,
            name: "The Scientific Method",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        sections: [
          {
            id: "sec-doc-ingest",
            textbookId: "tb-doc-ingest",
            chapterId: "ch-doc-ingest",
            index: 1,
            title: "Observation and Evidence",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        vocabTerms: [
          {
            id: "v-doc-ingest-1",
            textbookId: "tb-doc-ingest",
            chapterId: "ch-doc-ingest",
            sectionId: "sec-doc-ingest",
            word: "hypothesis",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
          {
            id: "v-doc-ingest-2",
            textbookId: "tb-doc-ingest",
            chapterId: "ch-doc-ingest",
            sectionId: "sec-doc-ingest",
            word: "variable",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        equations: [
          {
            id: "eq-doc-ingest-1",
            textbookId: "tb-doc-ingest",
            chapterId: "ch-doc-ingest",
            sectionId: "sec-doc-ingest",
            name: "speed",
            latex: "speed = distance / time",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        concepts: [
          {
            id: "co-doc-ingest-1",
            textbookId: "tb-doc-ingest",
            chapterId: "ch-doc-ingest",
            sectionId: "sec-doc-ingest",
            name: "controlled experiment",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
        keyIdeas: [
          {
            id: "ki-doc-ingest-1",
            textbookId: "tb-doc-ingest",
            chapterId: "ch-doc-ingest",
            sectionId: "sec-doc-ingest",
            text: "Scientists compare evidence before drawing conclusions.",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
          {
            id: "ki-doc-ingest-2",
            textbookId: "tb-doc-ingest",
            chapterId: "ch-doc-ingest",
            sectionId: "sec-doc-ingest",
            text: "Galileo Galilei (1609)",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
          },
        ],
      },
    });

    await syncModule.uploadLocalChanges("teacher-doc-ingest");

    expect(mocks.setDoc).toHaveBeenCalledTimes(9);
    const docPaths = mocks.setDoc.mock.calls.map((call) => ((call as unknown[])[0] as { path: string }).path);
    expect(docPaths).toContain("textbooks/tb-doc-ingest/chapters/ch-doc-ingest/sections/sec-doc-ingest/vocab/v-doc-ingest-1");
    expect(docPaths).toContain("textbooks/tb-doc-ingest/chapters/ch-doc-ingest/sections/sec-doc-ingest/equations/eq-doc-ingest-1");
    expect(docPaths).toContain("textbooks/tb-doc-ingest/chapters/ch-doc-ingest/sections/sec-doc-ingest/keyIdeas/ki-doc-ingest-2");

    const uploadedPayloads = mocks.setDoc.mock.calls.map((call) => (call as unknown[])[1] as Record<string, unknown>);
    expect(uploadedPayloads.every((payload) => payload.pendingSync === false)).toBe(true);
    expect(uploadedPayloads.every((payload) => payload.source === "cloud")).toBe(true);
    expect(uploadedPayloads.every((payload) => payload.ownerId === "teacher-doc-ingest" && payload.userId === "teacher-doc-ingest")).toBe(true);
  });

  it("minimizes cloud writes by skipping already-synced owned rows (false-negative mutation guard)", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-min-write",
      localByStore: {
        textbooks: [
          {
            id: "tb-min-write",
            userId: "teacher-min-write",
            title: "Already synced",
            grade: "9",
            subject: "Math",
            edition: "1",
            publicationYear: 2026,
            isbnRaw: "1616161616161",
            isbnNormalized: "1616161616161",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T00:00:00.000Z",
            pendingSync: false,
            source: "cloud",
            isFavorite: false,
            isArchived: false,
          },
        ],
      },
    });

    await syncModule.uploadLocalChanges("teacher-min-write");
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it("fail-first: tombstoned authored textbook must delete cloud copy even when cloud timestamp is newer", async () => {
    const { syncModule, mocks } = await importSyncServiceModule({
      currentUid: "teacher-delete-owner",
      localByStore: {
        textbooks: [
          {
            id: "tb-ghost-1",
            userId: "teacher-delete-owner",
            ownerId: "teacher-delete-owner",
            title: "Ghost Candidate",
            grade: "9",
            subject: "Science",
            edition: "1",
            publicationYear: 2021,
            isbnRaw: "",
            isbnNormalized: "",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T01:00:00.000Z",
            pendingSync: true,
            source: "local",
            isFavorite: false,
            isArchived: false,
            isDeleted: true,
          },
        ],
      },
      cloudQueryDocs: {
        "collection:textbooks:userId": [
          createMockDoc("textbooks/tb-ghost-1", "tb-ghost-1", {
            id: "tb-ghost-1",
            userId: "teacher-delete-owner",
            ownerId: "teacher-delete-owner",
            title: "Ghost Candidate",
            grade: "9",
            subject: "Science",
            edition: "1",
            publicationYear: 2021,
            isbnRaw: "",
            isbnNormalized: "",
            createdAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:00.000Z",
            lastModified: "2026-03-12T05:00:00.000Z",
            pendingSync: false,
            source: "cloud",
            isFavorite: false,
            isArchived: false,
          }),
        ],
      },
    });

    await syncModule.syncUserData("teacher-delete-owner");

    expect(mocks.deleteDoc).toHaveBeenCalledWith({ path: "textbooks/tb-ghost-1" });
    expect(mocks.deleteLocal).toHaveBeenCalledWith("textbooks", "tb-ghost-1");

    const resurrectedSaves = (mocks.save.mock.calls as Array<[string, Record<string, unknown>]>).filter(
      ([storeName, payload]) =>
        storeName === "textbooks"
        && payload.id === "tb-ghost-1"
        && payload.isDeleted !== true
        && payload.source === "cloud"
    );
    expect(resurrectedSaves.length).toBe(0);
  });
});

describe("Sync status UI and debug logging state", () => {
  beforeEach(() => {
    useUIStore.getState().clearSync();
  });

  it("records sync error events for debug panel", () => {
    useUIStore.getState().setSyncStatus("error", "permission denied from rules");

    const state = useUIStore.getState();
    expect(state.syncStatus).toBe("error");
    expect(state.syncDebugEvents.length).toBeGreaterThan(0);
    expect(state.syncDebugEvents[0]?.toLowerCase()).toContain("sync:error");
  });

  it("tracks sync status transitions and write budget indicators", () => {
    const ui = useUIStore.getState();

    ui.setSyncStatus("syncing", "Syncing local changes...");
    ui.setWriteBudget(510, 500, true);
    ui.setSyncStatus("error", "Cloud sync paused to prevent excessive writes.");

    const afterError = useUIStore.getState();
    expect(afterError.syncStatus).toBe("error");
    expect(afterError.writeBudgetExceeded).toBe(true);

    ui.setSyncStatus("synced", "Local changes synced.");
    const afterSuccess = useUIStore.getState();
    expect(afterSuccess.syncStatus).toBe("synced");
    expect(afterSuccess.syncMessage).toBe("Local changes synced.");
  });

  it("does not create false debug-error entries for non-error statuses (false-positive mutation guard)", () => {
    const ui = useUIStore.getState();

    ui.setSyncStatus("syncing", "syncing");
    ui.setSyncStatus("synced", "done");

    const state = useUIStore.getState();
    expect(state.syncDebugEvents.some((event) => event.includes("sync:error"))).toBe(false);
  });
});
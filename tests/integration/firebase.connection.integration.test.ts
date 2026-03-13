import { beforeEach, describe, expect, it, vi } from "vitest";

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

  const where = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
  const collection = vi.fn((_db: unknown, name: string) => ({ kind: "collection" as const, name }));
  const collectionGroup = vi.fn((_db: unknown, name: string) => ({ kind: "collectionGroup" as const, name }));
  const query = vi.fn((ref: MockQuery["ref"], ...clauses: MockQueryClause[]) => ({ ref, clauses }));
  const docFn = vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }));
  const setDoc = vi.fn(async () => undefined);
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
  }));

  vi.doMock("firebase/firestore", () => ({
    where,
    collection,
    collectionGroup,
    query,
    doc: docFn,
    setDoc,
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
      where,
      collection,
      collectionGroup,
      query,
      docFn,
      setDoc,
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
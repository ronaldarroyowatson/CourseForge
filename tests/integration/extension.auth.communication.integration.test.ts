import { beforeEach, describe, expect, it, vi } from "vitest";

async function importAuthModule(options: {
  extensionRuntime?: boolean;
  configError?: string | null;
  signInUser?: { uid: string; email?: string | null; displayName?: string | null };
} = {}) {
  vi.resetModules();

  const authInstance = { currentUser: null };
  const signInUser = options.signInUser ?? { uid: "teacher-ext", email: "ext@example.com", displayName: "Ext User" };

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
    getFirebaseConfigError: () => options.configError ?? null,
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

describe("Extension Firebase init/login communication", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("initializes extension auth persistence and completes popup login", async () => {
    const { authModule, mocks } = await importAuthModule({ extensionRuntime: true });

    await authModule.initializePersistentAuth();
    const user = await authModule.signInWithGoogle();

    expect(user.uid).toBe("teacher-ext");
    expect(mocks.initializeAuth).toHaveBeenCalledTimes(1);
    expect(mocks.setPersistence).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithPopup).toHaveBeenCalledTimes(1);
  });

  it("rejects login when Firebase config is invalid (false-negative mutation guard)", async () => {
    const { authModule } = await importAuthModule({
      extensionRuntime: true,
      configError: "Firebase config missing",
    });

    await expect(authModule.signInWithGoogle()).rejects.toThrow("Firebase config missing");
  });
});

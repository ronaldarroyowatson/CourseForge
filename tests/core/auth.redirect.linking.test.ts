import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("auth redirect linking", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stages pending provider intent before linkWithRedirect", async () => {
    const linkWithRedirect = vi.fn().mockResolvedValue(undefined);
    function MockOAuthProvider() {
      return {
        setCustomParameters: vi.fn(),
        addScope: vi.fn(),
      };
    }
    const mockAuth = {
      currentUser: { uid: "cloud-user-1" },
    };

    vi.doMock("firebase/auth", () => ({
      getAuth: vi.fn().mockReturnValue(mockAuth),
      initializeAuth: vi.fn().mockReturnValue(mockAuth),
      browserLocalPersistence: {},
      GoogleAuthProvider: vi.fn(),
      OAuthProvider: MockOAuthProvider,
      setPersistence: vi.fn().mockResolvedValue(undefined),
      getRedirectResult: vi.fn().mockResolvedValue(null),
      linkWithRedirect,
      linkWithPopup: vi.fn(),
      signInWithPopup: vi.fn(),
      signInWithRedirect: vi.fn(),
      onIdTokenChanged: vi.fn().mockReturnValue(vi.fn()),
      signOut: vi.fn(),
    }));

    vi.doMock("../../src/firebase/firebaseApp", () => ({ firebaseApp: {} }));
    vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));
    vi.doMock("../../src/firebase/firebaseConfig", () => ({ getFirebaseConfigError: () => null }));

    const { startLinkCurrentUserWithAuthProviderRedirect } = await import("../../src/firebase/auth");

    await startLinkCurrentUserWithAuthProviderRedirect("microsoft");

    expect(linkWithRedirect).toHaveBeenCalledTimes(1);
    const pending = localStorage.getItem("courseforge.pendingAuthRedirect");
    expect(pending).toBeTruthy();
    expect(JSON.parse(pending || "{}")).toMatchObject({
      mode: "link",
      providerId: "microsoft",
    });
  });

  it("resolves redirect result and returns link flow to settings route", async () => {
    const getRedirectResult = vi.fn().mockResolvedValue({ user: { uid: "cloud-user-2" } });
    const mockAuth = {
      currentUser: { uid: "cloud-user-2" },
    };

    function MockOAuthProvider() {
      return {
        setCustomParameters: vi.fn(),
        addScope: vi.fn(),
      };
    }

    vi.doMock("firebase/auth", () => ({
      getAuth: vi.fn().mockReturnValue(mockAuth),
      initializeAuth: vi.fn().mockReturnValue(mockAuth),
      browserLocalPersistence: {},
      GoogleAuthProvider: vi.fn(),
      OAuthProvider: MockOAuthProvider,
      setPersistence: vi.fn().mockResolvedValue(undefined),
      getRedirectResult,
      linkWithRedirect: vi.fn(),
      linkWithPopup: vi.fn(),
      signInWithPopup: vi.fn(),
      signInWithRedirect: vi.fn(),
      onIdTokenChanged: vi.fn().mockReturnValue(vi.fn()),
      signOut: vi.fn(),
    }));

    vi.doMock("../../src/firebase/firebaseApp", () => ({ firebaseApp: {} }));
    vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));
    vi.doMock("../../src/firebase/firebaseConfig", () => ({ getFirebaseConfigError: () => null }));

    const { resolvePendingAuthRedirectResult } = await import("../../src/firebase/auth");

    localStorage.setItem("courseforge.pendingAuthRedirect", JSON.stringify({
      mode: "link",
      providerId: "microsoft",
      fromPath: "/settings",
      startedAt: new Date().toISOString(),
    }));
    window.history.replaceState({}, "", "/login");

    await resolvePendingAuthRedirectResult();

    expect(getRedirectResult).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("courseforge.pendingAuthRedirect")).toBeNull();
    expect(window.location.pathname).toBe("/settings");
  });

  it("surfaces provider configuration errors before starting redirect", async () => {
    const linkWithRedirect = vi.fn().mockResolvedValue(undefined);
    const mockAuth = {
      currentUser: { uid: "cloud-user-3" },
    };

    function MockOAuthProvider() {
      return {
        setCustomParameters: vi.fn(),
        addScope: vi.fn(),
      };
    }

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "OPERATION_NOT_ALLOWED : The identity provider configuration is not found.",
        },
      }),
    } as Response);

    vi.doMock("firebase/auth", () => ({
      getAuth: vi.fn().mockReturnValue(mockAuth),
      initializeAuth: vi.fn().mockReturnValue(mockAuth),
      browserLocalPersistence: {},
      GoogleAuthProvider: vi.fn(),
      OAuthProvider: MockOAuthProvider,
      setPersistence: vi.fn().mockResolvedValue(undefined),
      getRedirectResult: vi.fn().mockResolvedValue(null),
      linkWithRedirect,
      linkWithPopup: vi.fn(),
      signInWithPopup: vi.fn(),
      signInWithRedirect: vi.fn(),
      onIdTokenChanged: vi.fn().mockReturnValue(vi.fn()),
      signOut: vi.fn(),
    }));

    vi.doMock("../../src/firebase/firebaseApp", () => ({
      firebaseApp: {
        options: {
          apiKey: "test-key",
        },
      },
    }));
    vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));
    vi.doMock("../../src/firebase/firebaseConfig", () => ({ getFirebaseConfigError: () => null }));

    const { startLinkCurrentUserWithAuthProviderRedirect } = await import("../../src/firebase/auth");

    await expect(startLinkCurrentUserWithAuthProviderRedirect("microsoft"))
      .rejects
      .toThrow("Microsoft sign-in is not configured");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(linkWithRedirect).not.toHaveBeenCalled();
    expect(localStorage.getItem("courseforge.pendingAuthRedirect")).toBeNull();
  });

  it("surfaces provider configuration errors for popup sign-in", async () => {
    const signInWithPopup = vi.fn().mockRejectedValue({
      code: "auth/operation-not-allowed",
      message: "OPERATION_NOT_ALLOWED : The identity provider configuration is not found.",
    });

    function MockOAuthProvider() {
      return {
        setCustomParameters: vi.fn(),
        addScope: vi.fn(),
      };
    }

    vi.doMock("firebase/auth", () => ({
      getAuth: vi.fn().mockReturnValue({ currentUser: null }),
      initializeAuth: vi.fn().mockReturnValue({ currentUser: null }),
      browserLocalPersistence: {},
      GoogleAuthProvider: vi.fn(),
      OAuthProvider: MockOAuthProvider,
      setPersistence: vi.fn().mockResolvedValue(undefined),
      getRedirectResult: vi.fn().mockResolvedValue(null),
      linkWithRedirect: vi.fn(),
      linkWithPopup: vi.fn(),
      signInWithPopup,
      signInWithRedirect: vi.fn(),
      onIdTokenChanged: vi.fn().mockReturnValue(vi.fn()),
      signOut: vi.fn(),
    }));

    vi.doMock("../../src/firebase/firebaseApp", () => ({ firebaseApp: {} }));
    vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));
    vi.doMock("../../src/firebase/firebaseConfig", () => ({ getFirebaseConfigError: () => null }));

    const { signInWithAuthProvider } = await import("../../src/firebase/auth");

    await expect(signInWithAuthProvider("github"))
      .rejects
      .toThrow("GitHub sign-in is not configured");
  });
});

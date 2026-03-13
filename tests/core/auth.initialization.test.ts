import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auth initialization behavior tests.
 *
 * Each test resets the module registry so cachedAuth and persistenceReady
 * are always null/false at test start, giving deterministic isolation.
 *
 * firebase/auth, firebaseApp, and firestoreDb are mocked to prevent any
 * real network or SDK side effects.
 */
describe("auth initialization behavior", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("onAuthStateChangedListener calls callback with fallback auth currentUser when initializePersistentAuth rejects", async () => {
    const mockCurrentUser = { uid: "fallback-user-1" };
    const mockUnsubscribe = vi.fn();
    const mockOnIdTokenChanged = vi.fn().mockReturnValue(mockUnsubscribe);
    const mockAuth = { currentUser: mockCurrentUser };

    vi.doMock("firebase/auth", () => ({
      getAuth: vi.fn().mockReturnValue(mockAuth),
      initializeAuth: vi.fn().mockReturnValue(mockAuth),
      browserLocalPersistence: {},
      // vi.fn() without an arrow body is constructor-compatible (for `new GoogleAuthProvider()`).
      GoogleAuthProvider: vi.fn(),
      // Rejecting setPersistence causes initializePersistentAuth to reject,
      // which triggers the fallback branch in onAuthStateChangedListener.
      setPersistence: vi.fn().mockRejectedValue(new Error("persistence-init-failed")),
      onIdTokenChanged: mockOnIdTokenChanged,
      signOut: vi.fn(),
      signInWithPopup: vi.fn(),
    }));
    vi.doMock("../../src/firebase/firebaseApp", () => ({ firebaseApp: {} }));
    vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));

    const { onAuthStateChangedListener } = await import("../../src/firebase/auth");

    const callback = vi.fn();
    onAuthStateChangedListener(callback);

    // Allow the void Promise chain (initializePersistentAuth rejection → catch branch) to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    expect(callback).toHaveBeenCalledWith(mockCurrentUser);
  });

  it("waitForAuthStateChange resolves with current user on timeout when no token event arrives", async () => {
    const mockCurrentUser = { uid: "timeout-user-2" };
    const mockAuth = { currentUser: mockCurrentUser };

    vi.doMock("firebase/auth", () => ({
      getAuth: vi.fn().mockReturnValue(mockAuth),
      initializeAuth: vi.fn().mockReturnValue(mockAuth),
      browserLocalPersistence: {},
      GoogleAuthProvider: vi.fn(),
      // setPersistence succeeds so initializePersistentAuth resolves cleanly.
      setPersistence: vi.fn().mockResolvedValue(undefined),
      // onIdTokenChanged captures the listener but never invokes it, simulating
      // a scenario where no token event arrives before the timeout fires.
      onIdTokenChanged: vi.fn().mockReturnValue(vi.fn()),
      signOut: vi.fn(),
      signInWithPopup: vi.fn(),
    }));
    vi.doMock("../../src/firebase/firebaseApp", () => ({ firebaseApp: {} }));
    vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));

    const { waitForAuthStateChange } = await import("../../src/firebase/auth");

    // 50ms timeout is sufficient; the timer path resolves with auth.currentUser.
    const user = await waitForAuthStateChange(50);

    expect(user).toBe(mockCurrentUser);
  });

  it("getCurrentUser does not throw in non-extension runtime with no cached auth", async () => {
    // JSDOM does not expose chrome.runtime, so isExtensionRuntime() returns false.
    vi.doMock("firebase/auth", () => ({
      getAuth: vi.fn().mockReturnValue({ currentUser: null }),
      initializeAuth: vi.fn(),
      browserLocalPersistence: {},
      GoogleAuthProvider: vi.fn(),
      setPersistence: vi.fn().mockResolvedValue(undefined),
      onIdTokenChanged: vi.fn().mockReturnValue(vi.fn()),
      signOut: vi.fn(),
      signInWithPopup: vi.fn(),
    }));
    vi.doMock("../../src/firebase/firebaseApp", () => ({ firebaseApp: {} }));
    vi.doMock("../../src/firebase/firestore", () => ({ firestoreDb: {} }));

    // Fresh import: cachedAuth starts as null; getAuthInstanceSync populates it via getAuth().
    const { getCurrentUser } = await import("../../src/firebase/auth");

    let result: unknown;
    expect(() => {
      result = getCurrentUser();
    }).not.toThrow();
    expect(result).toBeNull();
  });
});

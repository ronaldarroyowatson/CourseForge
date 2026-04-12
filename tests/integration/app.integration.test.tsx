import React, { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/webapp/App";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

type SyncNowMockResult = {
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
};

const authMocks = vi.hoisted(() => {
  const mockUser = {
    uid: "teacher-1",
    email: "teacher@example.com",
    displayName: "Teacher One",
    getIdToken: vi.fn(async (_forceRefresh?: boolean) => "fresh-token"),
  };

  const state = {
    currentUser: null as typeof mockUser | null,
    authCallback: null as ((user: typeof mockUser | null) => void) | null,
  };

  const initializePersistentAuth = vi.fn(async () => ({ currentUser: state.currentUser }));
  const subscribeToAuthTokenChanges = vi.fn(async (callback: (user: typeof mockUser | null) => void) => {
    state.authCallback = callback;
    callback(state.currentUser);
    return vi.fn();
  });
  const signInWithGoogle = vi.fn(async () => mockUser);
  const signOutCurrentUser = vi.fn(async () => undefined);
  const getAdminClaim = vi.fn(async () => false);
  const saveUserProfileToFirestore = vi.fn(async () => undefined);

  return {
    mockUser,
    state,
    initializePersistentAuth,
    subscribeToAuthTokenChanges,
    signInWithGoogle,
    signOutCurrentUser,
    getAdminClaim,
    saveUserProfileToFirestore,
  };
});

const syncMocks = vi.hoisted(() => ({
  syncUserData: vi.fn(async () => undefined),
  syncNow: vi.fn(async (): Promise<SyncNowMockResult> => ({
    success: true,
    message: "Sync completed successfully.",
    retryable: false,
    permissionDenied: false,
    throttled: false,
    writeLoopTriggered: false,
    writeBudgetExceeded: false,
    writeCount: 0,
    writeBudgetLimit: 500,
    readCount: 0,
    readBudgetLimit: 5000,
    readBudgetExceeded: false,
    retryLimit: 3,
    errorCode: null,
    pendingCount: 0,
  })),
  getPendingSyncDiagnostics: vi.fn(async () => ({ pendingCount: 0, byStore: {} })),
}));

const { mockUser } = authMocks;

vi.mock("../../src/firebase/auth", () => ({
  initializePersistentAuth: authMocks.initializePersistentAuth,
  subscribeToAuthTokenChanges: authMocks.subscribeToAuthTokenChanges,
  signInWithGoogle: authMocks.signInWithGoogle,
  signOutCurrentUser: authMocks.signOutCurrentUser,
  getAdminClaim: authMocks.getAdminClaim,
  saveUserProfileToFirestore: authMocks.saveUserProfileToFirestore,
  getCurrentUser: () => null,
}));

vi.mock("../../src/core/services/syncService", () => ({
  syncUserData: syncMocks.syncUserData,
  syncNow: syncMocks.syncNow,
  getPendingSyncDiagnostics: syncMocks.getPendingSyncDiagnostics,
}));

vi.mock("../../src/webapp/components/app/TextbookWorkspace", () => ({
  TextbookWorkspace: ({ showAdminPage = false }: { showAdminPage?: boolean }) => (
    <div>{showAdminPage ? "ADMIN_PAGE" : "WORKSPACE_PAGE"}</div>
  ),
}));

function resetStores(): void {
  useAuthStore.setState({
    authStatus: "loading",
    userId: null,
    userEmail: null,
    userDisplayName: null,
    isAdmin: false,
    authError: null,
  });
  useUIStore.setState({
    isSyncing: false,
    syncStatus: "idle",
    syncMessage: null,
    lastSyncError: null,
    lastSyncErrorCode: null,
    pendingSyncCount: 0,
    pendingChangesCount: 0,
    retryCount: 0,
    writeCount: 0,
    readCount: 0,
    writeBudgetLimit: 500,
    readBudgetLimit: 5000,
    retryLimit: 3,
    writeBudgetExceeded: false,
    readBudgetExceeded: false,
    automaticRetriesEnabled: false,
    permissionDeniedSyncBlocked: false,
    writeLoopBlocked: false,
    localChangeVersion: 0,
    syncDebugEvents: [],
    selectedTextbookId: null,
    selectedTextbook: null,
  });
}

function renderAt(pathname: string): void {
  window.history.pushState({}, "", pathname);
  render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

describe("App admin/auth integration", () => {
  beforeEach(() => {
    authMocks.state.currentUser = null;
    authMocks.state.authCallback = null;
    authMocks.initializePersistentAuth.mockClear();
    authMocks.subscribeToAuthTokenChanges.mockClear();
    authMocks.signInWithGoogle.mockClear();
    authMocks.signOutCurrentUser.mockClear();
    authMocks.getAdminClaim.mockReset();
    authMocks.getAdminClaim.mockResolvedValue(false);
    authMocks.mockUser.getIdToken.mockClear();
    authMocks.saveUserProfileToFirestore.mockClear();
    syncMocks.syncUserData.mockClear();
    syncMocks.syncNow.mockClear();
    syncMocks.getPendingSyncDiagnostics.mockClear();
    resetStores();
  });

  it("redirects unauthenticated users away from /admin to the login screen", async () => {
    renderAt("/admin");

    await waitFor(() => {
      expect(screen.getByText("Sign in to CourseForge")).toBeInTheDocument();
    });
    expect(screen.queryByText("ADMIN_PAGE")).not.toBeInTheDocument();
  });

  it("allows admin users to access /admin", async () => {
    authMocks.state.currentUser = mockUser;
    authMocks.getAdminClaim.mockResolvedValue(true);

    renderAt("/admin");

    await waitFor(() => {
      expect(screen.getByText("ADMIN_PAGE")).toBeInTheDocument();
    });
  });

  it("grants admin route access after the next token refresh", async () => {
    authMocks.state.currentUser = mockUser;
    authMocks.getAdminClaim.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    renderAt("/admin");

    await waitFor(() => {
      expect(screen.getByText("WORKSPACE_PAGE")).toBeInTheDocument();
    });

    await act(async () => {
      authMocks.state.authCallback?.(mockUser);
    });

    await act(async () => {
      window.history.pushState({}, "", "/admin");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => {
      expect(screen.getByText("ADMIN_PAGE")).toBeInTheDocument();
    });
  });

  it("restores a persistent login across reload-style remounts", async () => {
    authMocks.state.currentUser = mockUser;
    authMocks.getAdminClaim.mockResolvedValue(true);
    window.history.pushState({}, "", "/textbooks");

    const firstRender = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("WORKSPACE_PAGE")).toBeInTheDocument();
    });

    firstRender.unmount();
    resetStores();

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("WORKSPACE_PAGE")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(syncMocks.syncNow.mock.calls.length + syncMocks.syncUserData.mock.calls.length).toBeGreaterThan(0);
    });
  });

  it("runs sync automatically after login", async () => {
    renderAt("/login");

    await waitFor(() => {
      expect(screen.getByText("Sign in to CourseForge")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    await act(async () => {
      authMocks.state.currentUser = mockUser;
      authMocks.getAdminClaim.mockResolvedValue(true);
      authMocks.state.authCallback?.(mockUser);
    });

    await waitFor(() => {
      expect(syncMocks.syncNow.mock.calls.length + syncMocks.syncUserData.mock.calls.length).toBeGreaterThan(0);
      expect(authMocks.saveUserProfileToFirestore).toHaveBeenCalled();
    });
  });

  it("preserves permission-denied startup state without duplicate bootstrap sync errors", async () => {
    authMocks.state.currentUser = mockUser;
    authMocks.getAdminClaim.mockResolvedValue(true);
    const permissionDeniedMessage = "Signed in successfully, but cloud sync is blocked by Firestore rules (permission denied). Local data remains available.";
    syncMocks.syncNow
      .mockResolvedValueOnce({
        success: false,
        message: permissionDeniedMessage,
        retryable: false,
        permissionDenied: true,
        throttled: false,
        writeLoopTriggered: false,
        writeBudgetExceeded: false,
        writeCount: 0,
        writeBudgetLimit: 500,
        readCount: 0,
        readBudgetLimit: 5000,
        readBudgetExceeded: false,
        retryLimit: 3,
        errorCode: "permission-denied",
        pendingCount: 0,
      })
      .mockResolvedValueOnce({
        success: false,
        message: permissionDeniedMessage,
        retryable: false,
        permissionDenied: true,
        throttled: false,
        writeLoopTriggered: false,
        writeBudgetExceeded: false,
        writeCount: 0,
        writeBudgetLimit: 500,
        readCount: 0,
        readBudgetLimit: 5000,
        readBudgetExceeded: false,
        retryLimit: 3,
        errorCode: "permission-denied",
        pendingCount: 0,
      });

    renderAt("/textbooks");

    await waitFor(() => {
      expect(useAuthStore.getState().authStatus).toBe("authenticated");
    });

    await waitFor(() => {
      expect(useUIStore.getState().syncStatus).toBe("error");
    });

    await act(async () => {
      authMocks.state.authCallback?.(mockUser);
    });

    const state = useUIStore.getState();
    expect(state.syncMessage).toBe(permissionDeniedMessage);
    expect(state.lastSyncError).toBe(permissionDeniedMessage);
    expect(state.lastSyncErrorCode).toBe("permission-denied");
    expect(state.permissionDeniedSyncBlocked).toBe(true);
    expect(state.syncDebugEvents.filter((event) => event.includes("sync:error")).length).toBe(2);
    expect(syncMocks.syncNow).toHaveBeenCalledTimes(2);
    expect(authMocks.mockUser.getIdToken).toHaveBeenCalledWith(true);
    expect(authMocks.mockUser.getIdToken.mock.invocationCallOrder[0]).toBeLessThan(syncMocks.syncNow.mock.invocationCallOrder[0]);
  });

  it("retries admin bootstrap sync after token refresh and clears startup errors on success", async () => {
    authMocks.state.currentUser = mockUser;
    authMocks.getAdminClaim.mockResolvedValue(true);

    syncMocks.syncNow
      .mockResolvedValueOnce({
        success: false,
        message: "Signed in successfully, but cloud sync is blocked by Firestore rules (permission denied). Local data remains available.",
        retryable: false,
        permissionDenied: true,
        throttled: false,
        writeLoopTriggered: false,
        writeBudgetExceeded: false,
        writeCount: 0,
        writeBudgetLimit: 500,
        readCount: 0,
        readBudgetLimit: 5000,
        readBudgetExceeded: false,
        retryLimit: 3,
        errorCode: "permission-denied",
        pendingCount: 0,
      })
      .mockResolvedValueOnce({
        success: true,
        message: "Sync completed successfully.",
        retryable: false,
        permissionDenied: false,
        throttled: false,
        writeLoopTriggered: false,
        writeBudgetExceeded: false,
        writeCount: 0,
        writeBudgetLimit: 500,
        readCount: 0,
        readBudgetLimit: 5000,
        readBudgetExceeded: false,
        retryLimit: 3,
        errorCode: null,
        pendingCount: 0,
      });

    renderAt("/textbooks");

    await waitFor(() => {
      expect(useUIStore.getState().syncStatus).toBe("error");
    });

    await act(async () => {
      authMocks.state.authCallback?.(mockUser);
    });

    await waitFor(() => {
      expect(useUIStore.getState().syncStatus).toBe("synced");
    });

    const state = useUIStore.getState();
    expect(state.syncMessage).toBe("Your data is synced.");
    expect(state.lastSyncError).toBeNull();
    expect(state.lastSyncErrorCode).toBeNull();
    expect(state.permissionDeniedSyncBlocked).toBe(false);
    expect(syncMocks.syncNow).toHaveBeenCalledTimes(2);
  });
});

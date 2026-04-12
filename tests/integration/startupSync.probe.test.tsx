import React, { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/webapp/App";
import { Header } from "../../src/webapp/components/layout/Header";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

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
  const getAdminClaim = vi.fn(async () => true);
  const saveUserProfileToFirestore = vi.fn(async () => undefined);
  const signInWithGoogle = vi.fn(async () => mockUser);
  const signOutCurrentUser = vi.fn(async () => undefined);

  return {
    mockUser,
    state,
    initializePersistentAuth,
    subscribeToAuthTokenChanges,
    getAdminClaim,
    saveUserProfileToFirestore,
    signInWithGoogle,
    signOutCurrentUser,
  };
});

const syncMocks = vi.hoisted(() => ({
  syncNow: vi.fn(async () => ({
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
  })),
  getPendingSyncDiagnostics: vi.fn(async () => ({ pendingCount: 0, byStore: {} })),
}));

vi.mock("../../src/firebase/auth", () => ({
  initializePersistentAuth: authMocks.initializePersistentAuth,
  subscribeToAuthTokenChanges: authMocks.subscribeToAuthTokenChanges,
  getAdminClaim: authMocks.getAdminClaim,
  saveUserProfileToFirestore: authMocks.saveUserProfileToFirestore,
  signInWithGoogle: authMocks.signInWithGoogle,
  signOutCurrentUser: authMocks.signOutCurrentUser,
  getCurrentUser: () => null,
}));

vi.mock("../../src/core/services/syncService", () => ({
  syncNow: syncMocks.syncNow,
  getPendingSyncDiagnostics: syncMocks.getPendingSyncDiagnostics,
}));

vi.mock("../../src/webapp/components/app/TextbookWorkspace", () => ({
  TextbookWorkspace: ({ showAdminPage = false }: { showAdminPage?: boolean }) => (
    <>
      <Header />
      <div>{showAdminPage ? "ADMIN_PAGE" : "WORKSPACE_PAGE"}</div>
    </>
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
    lastSyncTime: null,
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

describe("startup sync probe", () => {
  beforeEach(() => {
    authMocks.state.currentUser = authMocks.mockUser;
    authMocks.state.authCallback = null;
    authMocks.initializePersistentAuth.mockClear();
    authMocks.subscribeToAuthTokenChanges.mockClear();
    authMocks.getAdminClaim.mockClear();
    authMocks.saveUserProfileToFirestore.mockClear();
    authMocks.mockUser.getIdToken.mockClear();
    syncMocks.syncNow.mockClear();
    syncMocks.getPendingSyncDiagnostics.mockClear();
    resetStores();
  });

  it("prints startup sync state after duplicate auth callback re-entry", async () => {
    window.history.pushState({}, "", "/textbooks");

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(useAuthStore.getState().authStatus).toBe("authenticated");
    });

    await waitFor(() => {
      expect(useUIStore.getState().syncStatus).toBe("error");
    });

    await act(async () => {
      authMocks.state.authCallback?.(authMocks.mockUser);
    });

    fireEvent.click(screen.getByRole("button", { name: "Show Debug Panel" }));

    const state = useUIStore.getState();
    const summary = {
      syncStatus: state.syncStatus,
      lastSyncError: state.lastSyncError,
      lastSyncErrorCode: state.lastSyncErrorCode,
      permissionDeniedSyncBlocked: state.permissionDeniedSyncBlocked,
      recentDebugEvents: state.syncDebugEvents.slice(0, 5),
      syncNowCallCount: syncMocks.syncNow.mock.calls.length,
    };

    console.log("STARTUP_SYNC_PROBE", JSON.stringify(summary, null, 2));

    expect(screen.getByText(/Sync Status:/)).toBeInTheDocument();
    expect(screen.getByText(/Last Sync Error Code:/)).toBeInTheDocument();
    expect(screen.getByText(/Permission Denied Sync Blocked:/)).toBeInTheDocument();
    expect(summary).toEqual({
      syncStatus: "error",
      lastSyncError: "Signed in successfully, but cloud sync is blocked by Firestore rules (permission denied). Local data remains available.",
      lastSyncErrorCode: "permission-denied",
      permissionDeniedSyncBlocked: true,
      recentDebugEvents: expect.arrayContaining([
        expect.stringContaining("sync:error - Signed in successfully, but cloud sync is blocked by Firestore rules (permission denied). Local data remains available."),
      ]),
      syncNowCallCount: 2,
    });
  });
});
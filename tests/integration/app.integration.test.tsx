import React, { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/webapp/App";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

const authMocks = vi.hoisted(() => {
  const mockUser = {
    uid: "teacher-1",
    email: "teacher@example.com",
    displayName: "Teacher One",
  } as const;

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
}));

const { mockUser } = authMocks;

vi.mock("../../src/firebase/auth", () => ({
  initializePersistentAuth: authMocks.initializePersistentAuth,
  subscribeToAuthTokenChanges: authMocks.subscribeToAuthTokenChanges,
  signInWithGoogle: authMocks.signInWithGoogle,
  signOutCurrentUser: authMocks.signOutCurrentUser,
  getAdminClaim: authMocks.getAdminClaim,
  saveUserProfileToFirestore: authMocks.saveUserProfileToFirestore,
}));

vi.mock("../../src/core/services/syncService", () => ({
  syncUserData: syncMocks.syncUserData,
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
    authMocks.saveUserProfileToFirestore.mockClear();
    syncMocks.syncUserData.mockClear();
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

    expect(syncMocks.syncUserData).toHaveBeenCalledTimes(2);
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
      expect(syncMocks.syncUserData).toHaveBeenCalledWith("teacher-1");
      expect(authMocks.saveUserProfileToFirestore).toHaveBeenCalled();
    });
  });
});

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../src/webapp/store/uiStore";
import type { AutoTextbookUploadSnapshot, AutoTextbookUploadStatus } from "../../src/core/services/autoTextbookUploadService";
import { Header } from "../../src/webapp/components/layout/Header";  // vi.mock is hoisted; this static import is fine

// ── Firebase / Auth / Sync mocks ─────────────────────────────────────────────
vi.mock("../../src/firebase/auth", () => ({
  getCurrentUser: vi.fn(() => null),
  initializePersistentAuth: vi.fn(async () => ({ currentUser: null })),
  subscribeToAuthTokenChanges: vi.fn(async (cb: (u: null) => void) => { cb(null); return vi.fn(); }),
  signInWithGoogle: vi.fn(async () => null),
  signOutCurrentUser: vi.fn(async () => undefined),
  getAdminClaim: vi.fn(async () => false),
  saveUserProfileToFirestore: vi.fn(async () => undefined),
}));

vi.mock("../../src/firebase/firestore", () => ({
  firestoreDb: {},
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: unknown, ..._path: string[]) => ({})),
  setDoc: vi.fn(async () => undefined),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  collection: vi.fn(() => ({})),
}));

const uploadServiceMocks = vi.hoisted(() => ({
  clearPersistedAutoTextbookUpload: vi.fn<() => void>(() => undefined),
  hydratePersistedAutoTextbookUpload: vi.fn<() => null>(() => null),
  resumePersistedAutoTextbookUpload: vi.fn<() => Promise<null>>(async () => null),
}));

const syncServiceMocks = vi.hoisted(() => ({
  syncNow: vi.fn(async () => ({
    success: true,
    message: "",
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
}));

vi.mock("../../src/core/services/autoTextbookUploadService", () => ({
  clearPersistedAutoTextbookUpload: () => uploadServiceMocks.clearPersistedAutoTextbookUpload(),
  hydratePersistedAutoTextbookUpload: () => uploadServiceMocks.hydratePersistedAutoTextbookUpload(),
  resumePersistedAutoTextbookUpload: () => uploadServiceMocks.resumePersistedAutoTextbookUpload(),
  initAutoTextbookUploadTracking: vi.fn(() => undefined),
}));

vi.mock("../../src/core/services/syncService", () => ({
  syncNow: syncServiceMocks.syncNow,
  syncUserData: vi.fn(async () => undefined),
  getPendingSyncDiagnostics: vi.fn(async () => ({ pendingCount: 0, byStore: {} })),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────
function makeUploadSnapshot(status: AutoTextbookUploadStatus, canResume = true): AutoTextbookUploadSnapshot {
  const now = new Date().toISOString();
  return {
    sessionId: "s:tb1",
    textbookId: "tb1",
    title: "Oceans Deep",
    isbnRaw: "9781234000001",
    status,
    phase: status === "completed" ? "completed" : status === "uploading" ? "uploading" : "failed",
    message: "Test message",
    totalItems: 50,
    completedItems: status === "completed" ? 50 : 20,
    pendingItems: status === "completed" ? 0 : 30,
    percentComplete: status === "completed" ? 100 : 40,
    writeCount: 5,
    readCount: 10,
    integrityState: "verified",
    canResume,
    startedAt: now,
    updatedAt: now,
  };
}

function renderHeader(): void {
  render(
    <BrowserRouter>
      <Header />
    </BrowserRouter>
  );
}

describe("Header – upload telemetry card Dismiss button (v1.4.51 regression suite)", () => {
  beforeEach(() => {
    syncServiceMocks.syncNow.mockClear();
    uploadServiceMocks.clearPersistedAutoTextbookUpload.mockClear();
    uploadServiceMocks.hydratePersistedAutoTextbookUpload.mockClear();
    uploadServiceMocks.resumePersistedAutoTextbookUpload.mockClear();
    useUIStore.setState({ activeAutoTextbookUpload: null });
  });

  it("shows Dismiss button when status is 'completed'", () => {
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("completed") });
    renderHeader();

    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("shows Dismiss button when status is 'paused'", () => {
    // Bug 6 regression: Dismiss was previously hidden for non-completed states.
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("paused") });
    renderHeader();

    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("shows Dismiss button when status is 'failed'", () => {
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("failed") });
    renderHeader();

    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("shows Dismiss button when status is 'preparing'", () => {
    // Key regression: 'preparing' is the stuck state the user sees; Dismiss must be available.
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("preparing") });
    renderHeader();

    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("does NOT show Dismiss button while status is 'uploading'", () => {
    // Guard: must not allow premature dismissal during an active upload.
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("uploading") });
    renderHeader();

    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });

  it("clicking Dismiss calls clearPersistedAutoTextbookUpload", () => {
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("paused") });
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(uploadServiceMocks.clearPersistedAutoTextbookUpload).toHaveBeenCalledTimes(1);
  });

  it("does not show upload card when activeAutoTextbookUpload is null", () => {
    useUIStore.setState({ activeAutoTextbookUpload: null });
    renderHeader();

    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume Upload" })).not.toBeInTheDocument();
  });

  it("shows Resume Upload button when status is paused and canResume is true", () => {
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("paused", true) });
    renderHeader();

    expect(screen.getByRole("button", { name: "Resume Upload" })).toBeInTheDocument();
  });

  it("hides Resume Upload button while status is preparing even if canResume is true", () => {
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("preparing", true) });
    renderHeader();

    expect(screen.queryByRole("button", { name: "Resume Upload" })).not.toBeInTheDocument();
  });

  it("hides Resume Upload button while status is completed even if canResume is true", () => {
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("completed", true) });
    renderHeader();

    expect(screen.queryByRole("button", { name: "Resume Upload" })).not.toBeInTheDocument();
  });

  it("hides Resume Upload button when canResume is false", () => {
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("failed", false) });
    renderHeader();

    expect(screen.queryByRole("button", { name: "Resume Upload" })).not.toBeInTheDocument();
  });

  it("hides Resume Upload button while status is uploading", () => {
    useUIStore.setState({ activeAutoTextbookUpload: makeUploadSnapshot("uploading", true) });
    renderHeader();

    expect(screen.queryByRole("button", { name: "Resume Upload" })).not.toBeInTheDocument();
  });

  it("disables Sync Now button while syncing and shows loading label", () => {
    useUIStore.setState({ isSyncing: true, syncStatus: "syncing" });
    renderHeader();

    expect(screen.getByRole("button", { name: "Syncing..." })).toBeDisabled();
  });

  it("runs manual sync when Sync Now is clicked", async () => {
    useUIStore.setState({ isSyncing: false, syncStatus: "idle" });
    renderHeader();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sync Now" }));
    });

    await waitFor(() => {
      expect(syncServiceMocks.syncNow).toHaveBeenCalledTimes(1);
    });
  });

  it("renders theme toggle with accessible label", () => {
    renderHeader();

    const themeToggle = screen.getByRole("button", { name: "Toggle theme" });
    themeToggle.focus();

    expect(themeToggle).toBeInTheDocument();
    expect(themeToggle).toHaveFocus();
  });
});

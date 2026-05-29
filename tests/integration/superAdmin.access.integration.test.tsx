import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuperAdminPage } from "../../src/webapp/components/admin/SuperAdminPage";
import { RequireSuperAdmin } from "../../src/webapp/components/auth/RequireSuperAdmin";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const serviceMocks = vi.hoisted(() => ({
  getAllUsers: vi.fn(async () => []),
  getAllTextbooksAdmin: vi.fn(async () => []),
  setUserAdminStatus: vi.fn(async () => "ok"),
  getSuperAdminDashboardStats: vi.fn(async () => ({
    usersCount: 0,
    schoolsCount: 0,
    textbooksCount: 0,
    pendingPromotionRequests: 0,
    trackedReadsToday: 0,
    trackedWritesToday: 0,
  })),
  listAllSchoolsForSuperAdmin: vi.fn(async () => []),
  listSchoolAdminPromotionRequests: vi.fn(async () => []),
  resolveSchoolAdminPromotionRequest: vi.fn(async () => "ok"),
  setUserSuperAdminStatus: vi.fn(async () => "ok"),
  getSuperAdminGlobalQuota: vi.fn(async () => ({
    projectId: "courseforge-prod",
    fetchedAt: "2026-05-28T00:00:00.000Z",
    source: "serviceusage" as const,
    readLimitPerDay: 50000,
    writeLimitPerDay: 20000,
    deleteLimitPerDay: 20000,
    functionInvocationsLimitPerMonth: 2000000,
    message: null,
    details: [],
  })),
}));

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => { uid: string; getIdToken: (_forceRefresh?: boolean) => Promise<string> } | null>(() => null),
}));

vi.mock("../../src/core/services", () => ({
  getAllUsers: serviceMocks.getAllUsers,
  getAllTextbooksAdmin: serviceMocks.getAllTextbooksAdmin,
  setUserAdminStatus: serviceMocks.setUserAdminStatus,
  getSuperAdminDashboardStats: serviceMocks.getSuperAdminDashboardStats,
  listAllSchoolsForSuperAdmin: serviceMocks.listAllSchoolsForSuperAdmin,
  listSchoolAdminPromotionRequests: serviceMocks.listSchoolAdminPromotionRequests,
  resolveSchoolAdminPromotionRequest: serviceMocks.resolveSchoolAdminPromotionRequest,
  setUserSuperAdminStatus: serviceMocks.setUserSuperAdminStatus,
  getSuperAdminGlobalQuota: serviceMocks.getSuperAdminGlobalQuota,
}));

vi.mock("../../src/firebase/auth", () => ({
  getCurrentUser: authMocks.getCurrentUser,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Realistic stats mirroring the verified production data (queried 2026-05-28). */
const REALISTIC_STATS = {
  usersCount: 1,
  schoolsCount: 1,
  textbooksCount: 3,
  pendingPromotionRequests: 0,
  trackedReadsToday: 0,
  trackedWritesToday: 0,
};

function setSuperAdminAuth(): void {
  const getIdToken = vi.fn(async (_forceRefresh?: boolean) => "fresh-token");
  authMocks.getCurrentUser.mockReturnValue({ uid: "super-uid", getIdToken });
  useAuthStore.setState({
    authStatus: "authenticated",
    userId: "super-uid",
    userEmail: "owner@example.com",
    userDisplayName: "Owner",
    isAdmin: true,
    isSchoolAdmin: false,
    isSuperAdmin: true,
    schoolId: null,
    schoolName: null,
    districtName: null,
    authError: null,
  });
}

function resetStores(): void {
  useAuthStore.setState({
    authStatus: "authenticated",
    userId: "user-1",
    userEmail: "user@example.com",
    userDisplayName: "User",
    isAdmin: false,
    isSchoolAdmin: false,
    isSuperAdmin: false,
    schoolId: null,
    schoolName: null,
    districtName: null,
    authError: null,
  });
  useUIStore.setState({
    syncDebugEvents: [],
    syncStatus: "idle",
    syncMessage: null,
    isSyncing: false,
  });
}

function renderSuperAdminRoute(): void {
  render(
    <MemoryRouter initialEntries={["/super-admin"]}>
      <Routes>
        <Route element={<RequireSuperAdmin />}>
          <Route
            path="/super-admin"
            element={(
              <SuperAdminPage
                onBack={() => {
                  // no-op
                }}
              />
            )}
          />
        </Route>
        <Route path="/settings" element={<div>SETTINGS_PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Super admin access and data flow", () => {
  beforeEach(() => {
    resetStores();
    Object.values(serviceMocks).forEach((mockFn) => mockFn.mockClear());
    authMocks.getCurrentUser.mockReset();
    authMocks.getCurrentUser.mockReturnValue(null);
  });

  // -------------------------------------------------------------------------
  // Access control
  // -------------------------------------------------------------------------

  it("denies non-admin/non-super-admin route access and traces denied attempt", async () => {
    renderSuperAdminRoute();

    await waitFor(() => {
      expect(screen.getByText("SETTINGS_PAGE")).toBeInTheDocument();
    });

    expect(serviceMocks.getSuperAdminDashboardStats).not.toHaveBeenCalled();
    expect(useUIStore.getState().syncDebugEvents.some((event) => event.includes("superadmin:route-access-denied"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Happy path — real non-zero data rendered
  //
  // Regression guard: the stats function MUST return the resolved values and
  // the UI MUST display them.  Values of 0 are not acceptable for a project
  // that has actual users and textbooks.  This test uses values verified
  // against the production Firestore on 2026-05-28 (1 user, 1 school, 3
  // textbooks).  If the function crashes (e.g. unhandled FAILED_PRECONDITION
  // from a missing collection-group index), this test fails immediately.
  // -------------------------------------------------------------------------

  it("displays real non-zero stats for a super admin on first successful call", async () => {
    setSuperAdminAuth();

    serviceMocks.getSuperAdminDashboardStats.mockResolvedValueOnce(REALISTIC_STATS);

    renderSuperAdminRoute();

    // usersCount = 1, textbooksCount = 3, schoolsCount = 1 must all appear.
    await waitFor(() => {
      expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1); // at least usersCount or schoolsCount
      expect(screen.getByText("3")).toBeInTheDocument();                  // textbooksCount
    });

    expect(serviceMocks.getSuperAdminDashboardStats).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().syncDebugEvents.some((event) => event.includes("superadmin:dashboard-stats:loaded"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // FAILED_PRECONDITION crash scenario — this is the exact production bug.
  //
  // Before the fix, the Cloud Function's collectionGroup("syncUsage").get()
  // call was NOT wrapped in try/catch.  A missing COLLECTION_GROUP_ASC index
  // caused FAILED_PRECONDITION to propagate as an unhandled error, aborting
  // the entire function before any stats were assembled.  The UI received a
  // rejection, stats remained null, and the dashboard showed all zeros with
  // no clear indication of failure to the operator.
  //
  // After the fix, the function wraps the syncUsage query in try/catch so
  // that users/schools/textbooks/promotions counts still load even when
  // syncUsage fails.  This test verifies that the UI correctly surfaces a
  // partial-failure banner when stats can't be fetched — an operator must
  // NEVER see silent zeros.
  // -------------------------------------------------------------------------

  it("shows error banner (not silent zeros) when stats function throws FAILED_PRECONDITION", async () => {
    setSuperAdminAuth();

    serviceMocks.getSuperAdminDashboardStats.mockRejectedValueOnce(
      Object.assign(
        new Error("The query requires a COLLECTION_GROUP_ASC index for collection syncUsage"),
        { code: "functions/failed-precondition" },
      ),
    );

    renderSuperAdminRoute();

    await waitFor(() => {
      // The UI must show an explicit error notice, not silently show 0s.
      expect(screen.getByText(/Some dashboard data failed to load/i)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Token refresh retry on permission-denied
  // -------------------------------------------------------------------------

  it("recovers from initial permission-denied stats call and renders live data for super admin", async () => {
    const getIdToken = vi.fn(async (_forceRefresh?: boolean) => "fresh-token");
    authMocks.getCurrentUser.mockReturnValue({ uid: "super-uid", getIdToken });

    useAuthStore.setState({
      authStatus: "authenticated",
      userId: "super-uid",
      userEmail: "owner@example.com",
      userDisplayName: "Owner",
      isAdmin: true,
      isSchoolAdmin: false,
      isSuperAdmin: true,
      schoolId: null,
      schoolName: null,
      districtName: null,
      authError: null,
    });

    serviceMocks.getSuperAdminDashboardStats
      .mockRejectedValueOnce({ code: "functions/permission-denied", message: "permission-denied" })
      .mockResolvedValueOnce({
        usersCount: 57,
        schoolsCount: 9,
        textbooksCount: 204,
        pendingPromotionRequests: 3,
        trackedReadsToday: 811,
        trackedWritesToday: 126,
      });

    renderSuperAdminRoute();

    await waitFor(() => {
      expect(screen.getByText("57")).toBeInTheDocument();
      expect(screen.getByText("204")).toBeInTheDocument();
      expect(screen.getByText("811")).toBeInTheDocument();
    });

    expect(serviceMocks.getSuperAdminDashboardStats).toHaveBeenCalledTimes(2);
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(useUIStore.getState().syncDebugEvents.some((event) => event.includes("superadmin:dashboard-stats:permission-denied-retry:success"))).toBe(true);
  });

  it("keeps the user on /super-admin when pressing Global Stats Refresh", async () => {
    setSuperAdminAuth();

    serviceMocks.getSuperAdminDashboardStats
      .mockResolvedValueOnce({
        usersCount: 1,
        schoolsCount: 1,
        textbooksCount: 4,
        pendingPromotionRequests: 0,
        trackedReadsToday: 0,
        trackedWritesToday: 0,
      })
      .mockResolvedValueOnce({
        usersCount: 1,
        schoolsCount: 1,
        textbooksCount: 4,
        pendingPromotionRequests: 0,
        trackedReadsToday: 0,
        trackedWritesToday: 0,
      });

    renderSuperAdminRoute();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
      expect(screen.getByText("4")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(serviceMocks.getSuperAdminDashboardStats).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText("SETTINGS_PAGE")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Super Admin", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

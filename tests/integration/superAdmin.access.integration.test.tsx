import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuperAdminPage } from "../../src/webapp/components/admin/SuperAdminPage";
import { RequireSuperAdmin } from "../../src/webapp/components/auth/RequireSuperAdmin";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

const serviceMocks = vi.hoisted(() => ({
  getAllUsers: vi.fn(async () => []),
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

describe("Super admin access and data flow", () => {
  beforeEach(() => {
    resetStores();
    Object.values(serviceMocks).forEach((mockFn) => mockFn.mockClear());
    authMocks.getCurrentUser.mockReset();
    authMocks.getCurrentUser.mockReturnValue(null);
  });

  it("denies non-admin/non-super-admin route access and traces denied attempt", async () => {
    renderSuperAdminRoute();

    await waitFor(() => {
      expect(screen.getByText("SETTINGS_PAGE")).toBeInTheDocument();
    });

    expect(serviceMocks.getSuperAdminDashboardStats).not.toHaveBeenCalled();
    expect(useUIStore.getState().syncDebugEvents.some((event) => event.includes("superadmin:route-access-denied"))).toBe(true);
  });

  it("recovers from initial permission-denied stats call and renders live data for super admin", async () => {
    const getIdToken = vi.fn(async (_forceRefresh?: boolean) => "fresh-token");
    authMocks.getCurrentUser.mockReturnValue({
      uid: "super-uid",
      getIdToken,
    });

    useAuthStore.setState({
      isAdmin: true,
      isSuperAdmin: true,
      userEmail: "owner@example.com",
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
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Header } from "../../src/webapp/components/layout/Header";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

const syncMocks = vi.hoisted(() => ({
  clearWriteBudgetForManualRetry: vi.fn(),
  clearReadBudgetForManualRetry: vi.fn(),
  syncNow: vi.fn(async () => ({
    success: true,
    message: "Sync completed successfully.",
    retryable: false,
    permissionDenied: false,
    throttled: false,
    writeLoopTriggered: false,
    writeBudgetExceeded: false,
    writeCount: 0,
    writeBudgetLimit: 500,
    syncRunWriteCount: 0,
    writeBatchLimit: 120,
    writeBatchLimitReached: false,
    readCount: 0,
    readBudgetLimit: 5000,
    readBudgetExceeded: false,
    retryLimit: 3,
    errorCode: null,
    pendingCount: 0,
  })),
}));

const roleClaimMocks = vi.hoisted(() => ({
  getRoleClaims: vi.fn(),
}));

const schoolAdminMocks = vi.hoisted(() => ({
  setUserSuperAdminStatus: vi.fn(async () => "Granted super admin access."),
}));

vi.mock("../../src/core/services/syncService", () => ({
  clearWriteBudgetForManualRetry: syncMocks.clearWriteBudgetForManualRetry,
  clearReadBudgetForManualRetry: syncMocks.clearReadBudgetForManualRetry,
  syncNow: syncMocks.syncNow,
}));

vi.mock("../../src/firebase/auth", () => ({
  getRoleClaims: roleClaimMocks.getRoleClaims,
}));

vi.mock("../../src/core/services/schoolAdminService", () => ({
  setUserSuperAdminStatus: schoolAdminMocks.setUserSuperAdminStatus,
}));

function resetStores(): void {
  useAuthStore.setState({
    authStatus: "authenticated",
    userId: "owner-uid",
    userEmail: "owner@example.com",
    userDisplayName: "Owner",
    isAdmin: true,
    isSchoolAdmin: false,
    isSuperAdmin: false,
    schoolId: null,
    schoolName: null,
    districtName: null,
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
    writeCount: 0,
    readCount: 0,
    retryCount: 0,
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

describe("Header super-admin self-repair flow", () => {
  beforeEach(() => {
    resetStores();
    syncMocks.clearWriteBudgetForManualRetry.mockClear();
    syncMocks.clearReadBudgetForManualRetry.mockClear();
    syncMocks.syncNow.mockClear();
    roleClaimMocks.getRoleClaims.mockReset();
    schoolAdminMocks.setUserSuperAdminStatus.mockClear();
  });

  it("promotes owner account to super admin and navigates on button click", async () => {
    roleClaimMocks.getRoleClaims
      .mockResolvedValueOnce({ isAdmin: true, isSchoolAdmin: false, isSuperAdmin: false, schoolId: null })
      .mockResolvedValueOnce({ isAdmin: true, isSchoolAdmin: false, isSuperAdmin: true, schoolId: null });

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<Header isSettingsView />} />
          <Route path="/super-admin" element={<div>SUPER_ADMIN_PAGE</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Show Details" }));
    fireEvent.click(screen.getByRole("button", { name: "Super Admin" }));

    await waitFor(() => {
      expect(schoolAdminMocks.setUserSuperAdminStatus).toHaveBeenCalledWith("owner-uid", true);
    });

    await waitFor(() => {
      expect(screen.getByText("SUPER_ADMIN_PAGE")).toBeInTheDocument();
    });
  });

  it("does not show Super Admin button for non-admin users", () => {
    useAuthStore.setState({ isAdmin: false, isSchoolAdmin: false, isSuperAdmin: false });

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Header isSettingsView />
      </MemoryRouter>
    );

    // Non-admin users must not see the Super Admin button at all — hiding it is
    // stronger protection than showing it and relying solely on the click handler.
    expect(screen.queryByRole("button", { name: "Super Admin" })).toBeNull();

    // The setUserSuperAdminStatus callable must never have been invoked.
    expect(schoolAdminMocks.setUserSuperAdminStatus).not.toHaveBeenCalled();
  });
});

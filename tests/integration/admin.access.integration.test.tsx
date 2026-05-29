/**
 * admin.access.integration.test.tsx
 *
 * Regression suite for the RequireAdmin route guard.
 *
 * Verified behaviours:
 *  1. Unauthenticated users are redirected to /login (not the admin page).
 *  2. Authenticated but non-admin, non-super-admin users are redirected to
 *     /textbooks (not the admin page).
 *  3. Authenticated admin users can reach the admin page.
 *  4. Super-admin users can also reach the admin page (super admin ⊇ admin).
 *  5. While auth is still resolving (loading state) a placeholder is shown
 *     instead of redirecting or rendering the page.
 *
 * Security contract:
 *  The RequireAdmin guard MUST reject any attempt by a regular user or an
 *  unauthenticated session to load the /admin route.  If this test suite fails
 *  it means the gate has been bypassed and admin-only UI would be visible to
 *  unauthorized users.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { RequireAdmin } from "../../src/webapp/components/auth/RequireAdmin";
import { useAuthStore } from "../../src/webapp/store/authStore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetToAuthenticatedNonAdmin(): void {
  useAuthStore.setState({
    authStatus: "authenticated",
    userId: "regular-user-uid",
    userEmail: "user@example.com",
    userDisplayName: "Regular User",
    isAdmin: false,
    isSchoolAdmin: false,
    isSuperAdmin: false,
    schoolId: null,
    schoolName: null,
    districtName: null,
    authError: null,
  });
}

/**
 * Render a minimal route tree that exercises the RequireAdmin guard.
 * Stub pages are simple text markers so tests can use getByText assertions.
 */
function renderAdminGuardedRoute(): void {
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN_PAGE</div>} />
        <Route path="/textbooks" element={<div>TEXTBOOKS_PAGE</div>} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<div>ADMIN_PAGE</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RequireAdmin route guard", () => {
  beforeEach(() => {
    resetToAuthenticatedNonAdmin();
  });

  // -------------------------------------------------------------------------
  // 1 — Unauthenticated → /login
  // -------------------------------------------------------------------------

  it("redirects unauthenticated users to /login and never renders the admin page", async () => {
    useAuthStore.setState({ authStatus: "unauthenticated" });

    renderAdminGuardedRoute();

    await waitFor(() => {
      expect(screen.getByText("LOGIN_PAGE")).toBeInTheDocument();
    });

    expect(screen.queryByText("ADMIN_PAGE")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2 — Non-admin authenticated user → /textbooks
  // -------------------------------------------------------------------------

  it("redirects an authenticated non-admin user to /textbooks and never renders the admin page", async () => {
    // authStore is already set to a regular user from resetToAuthenticatedNonAdmin().
    renderAdminGuardedRoute();

    await waitFor(() => {
      expect(screen.getByText("TEXTBOOKS_PAGE")).toBeInTheDocument();
    });

    expect(screen.queryByText("ADMIN_PAGE")).not.toBeInTheDocument();
  });

  it("redirects a school-admin (but not admin/super-admin) user to /textbooks", async () => {
    useAuthStore.setState({ isSchoolAdmin: true, isAdmin: false, isSuperAdmin: false });

    renderAdminGuardedRoute();

    await waitFor(() => {
      expect(screen.getByText("TEXTBOOKS_PAGE")).toBeInTheDocument();
    });

    expect(screen.queryByText("ADMIN_PAGE")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 3 — Admin user → access granted
  // -------------------------------------------------------------------------

  it("allows an authenticated admin user to reach the admin page", async () => {
    useAuthStore.setState({ isAdmin: true, isSuperAdmin: false });

    renderAdminGuardedRoute();

    await waitFor(() => {
      expect(screen.getByText("ADMIN_PAGE")).toBeInTheDocument();
    });

    expect(screen.queryByText("TEXTBOOKS_PAGE")).not.toBeInTheDocument();
    expect(screen.queryByText("LOGIN_PAGE")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 4 — Super admin → access granted (super admin privileges ⊇ admin)
  // -------------------------------------------------------------------------

  it("allows a super-admin user to reach the admin page even without the admin flag", async () => {
    useAuthStore.setState({ isAdmin: false, isSuperAdmin: true });

    renderAdminGuardedRoute();

    await waitFor(() => {
      expect(screen.getByText("ADMIN_PAGE")).toBeInTheDocument();
    });

    expect(screen.queryByText("TEXTBOOKS_PAGE")).not.toBeInTheDocument();
    expect(screen.queryByText("LOGIN_PAGE")).not.toBeInTheDocument();
  });

  it("allows a user who holds both admin and super-admin flags to reach the admin page", async () => {
    useAuthStore.setState({ isAdmin: true, isSuperAdmin: true });

    renderAdminGuardedRoute();

    await waitFor(() => {
      expect(screen.getByText("ADMIN_PAGE")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 5 — Loading state — placeholder shown, not a redirect
  // -------------------------------------------------------------------------

  it("shows a loading placeholder while the auth state is being resolved", () => {
    useAuthStore.setState({ authStatus: "loading" });

    renderAdminGuardedRoute();

    // The placeholder text must be shown.
    expect(screen.getByText(/checking admin access/i)).toBeInTheDocument();
    // The page must NOT redirect or render the content.
    expect(screen.queryByText("ADMIN_PAGE")).not.toBeInTheDocument();
    expect(screen.queryByText("LOGIN_PAGE")).not.toBeInTheDocument();
    expect(screen.queryByText("TEXTBOOKS_PAGE")).not.toBeInTheDocument();
  });
});

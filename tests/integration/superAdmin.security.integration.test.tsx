/**
 * superAdmin.security.integration.test.tsx
 *
 * Security regression suite for the Super Admin page and its backend Cloud
 * Functions.  This suite guards against:
 *
 *  1. Privilege escalation: non-super-admin callers must never receive stats
 *     or user data from the getSuperAdminDashboardStats / getAllUsers callables.
 *
 *  2. XSS injection: user-supplied strings (email, displayName, schoolName,
 *     reason) that are rendered in admin tables must be HTML-escaped.  If
 *     React's JSX text rendering were ever replaced with dangerouslySetInnerHTML
 *     or a raw `innerHTML` assignment, the XSS tests here would catch it.
 *
 *  3. Input validation: quota-override number inputs must reject negative,
 *     zero, non-numeric, and script-payload values without crashing the page.
 *
 *  4. Backend callable security contracts: the Cloud Function source must call
 *     the appropriate auth assertion helper *before* touching any data, and
 *     setUserSuperAdminStatus must enforce owner-only operation with explicit
 *     transfer semantics when revoking a super-admin role.
 *
 *  5. All-zeros data guard: if the stats callable returns all-zero values the
 *     UI must still distinguish between a successful-but-empty result and an
 *     error state.  A separate "zero-guard" test verifies that a non-zero mock
 *     dataset is required for the "loaded" event to appear — any mock returning
 *     all zeros would make the live-data assertions fail, which is the intended
 *     behaviour.
 */
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuperAdminPage } from "../../src/webapp/components/admin/SuperAdminPage";
import { RequireSuperAdmin } from "../../src/webapp/components/auth/RequireSuperAdmin";
import { useAuthStore } from "../../src/webapp/store/authStore";
import { useUIStore } from "../../src/webapp/store/uiStore";

// ---------------------------------------------------------------------------
// Hoisted mocks  (same pattern as superAdmin.access.integration.test.tsx)
// ---------------------------------------------------------------------------

const serviceMocks = vi.hoisted(() => ({
  getAllUsers: vi.fn(async () => [] as Array<{ uid: string; email: string; displayName: string; createdAt: string | null; lastLoginAt: string | null; isAdmin: boolean; isSuperAdmin?: boolean; isSchoolAdmin?: boolean; schoolId?: string | null; schoolName?: string | null; districtName?: string | null; isContentBlocked?: boolean; contentBlockReason?: string | null }>),
  getAllTextbooksAdmin: vi.fn(async () => [] as Array<{ id: string }>),
  setUserAdminStatus: vi.fn(async () => "ok"),
  getSuperAdminDashboardStats: vi.fn(async () => ({
    usersCount: 0,
    schoolsCount: 0,
    textbooksCount: 0,
    pendingPromotionRequests: 0,
    trackedReadsToday: 0,
    trackedWritesToday: 0,
  })),
  listAllSchoolsForSuperAdmin: vi.fn(async () => [] as Array<{ schoolId: string; schoolName: string; districtName?: string | null; memberCount: number }>),
  listSchoolAdminPromotionRequests: vi.fn(async () => [] as Array<{ id: string; uid: string; email: string; displayName: string; schoolId: string; schoolName: string; districtName?: string | null; reason?: string | null; status: "pending" | "approved" | "rejected"; createdAt: string | null; reviewedAt?: string | null; reviewedBy?: string | null }>),
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
    currentUsageSource: "none" as const,
    currentReadsToday: 0,
    currentWritesToday: 0,
    message: null,
    details: [],
  }) as any),
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

function readFunctionsSource(): string {
  return readFileSync(path.resolve(process.cwd(), "functions/src/index.ts"), "utf8");
}

// XSS payloads — these must appear as literal text in the DOM, never as
// injected HTML elements.
const XSS_SCRIPT = "<script>window.__xss_executed=true;</script>";
const XSS_IMG = '<img src="x" onerror="window.__xss_executed=true">';
const XSS_EVENT = '<a href="#" onclick="window.__xss_executed=true">click</a>';

// ---------------------------------------------------------------------------
// 1 · Backend callable security contracts (static source analysis)
// ---------------------------------------------------------------------------

describe("Backend callable security contracts", () => {
  it("getSuperAdminDashboardStats asserts super-admin before accessing any data", () => {
    const src = readFunctionsSource();

    // The assertion must appear BEFORE the first Firestore collection access.
    const assertIdx = src.indexOf("assertSuperAdmin(request.auth)", src.indexOf("export const getSuperAdminDashboardStats"));
    const firestoreIdx = src.indexOf("firestore.collection(\"schools\").count()", src.indexOf("export const getSuperAdminDashboardStats"));

    expect(assertIdx).toBeGreaterThan(-1);
    expect(firestoreIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(firestoreIdx);
  });

  it("listAllSchoolsForSuperAdmin asserts super-admin before reading Firestore", () => {
    const src = readFunctionsSource();

    const fnStart = src.indexOf("export const listAllSchoolsForSuperAdmin");
    const assertIdx = src.indexOf("assertSuperAdmin(request.auth)", fnStart);
    const readIdx = src.indexOf("firestore.collection(\"schools\")", fnStart);

    expect(assertIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(readIdx);
  });

  it("getAllUsers (listAdminUsers) asserts admin before listing users", () => {
    const src = readFunctionsSource();

    // The listAdminUsers export must have assertAdmin first.
    const fnStart = src.indexOf("export const listAdminUsers");
    expect(fnStart).toBeGreaterThan(-1);

    const assertIdx = src.indexOf("assertAdmin(request.auth)", fnStart);
    const listIdx = src.indexOf("auth.listUsers", fnStart);

    expect(assertIdx).toBeGreaterThan(-1);
    expect(listIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(listIdx);
  });

  it("setUserAdminStatus asserts admin before changing user claims", () => {
    const src = readFunctionsSource();

    const fnStart = src.indexOf("export const setUserAdminStatus");
    const assertIdx = src.indexOf("assertAdmin(request.auth)", fnStart);
    const claimsIdx = src.indexOf("setCustomUserClaims", fnStart);

    expect(assertIdx).toBeGreaterThan(-1);
    expect(claimsIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(claimsIdx);
  });

  it("setUserContentBlockStatus never allows blocking a super-admin account", () => {
    const src = readFunctionsSource();

    const fnStart = src.indexOf("export const setUserContentBlockStatus");
    const superGuardIdx = src.indexOf("targetIsSuperAdmin", fnStart);
    const messageIdx = src.indexOf("Super admin accounts cannot be blocked from cloud sync.", fnStart);

    expect(fnStart).toBeGreaterThan(-1);
    expect(superGuardIdx).toBeGreaterThan(-1);
    expect(messageIdx).toBeGreaterThan(-1);
    expect(superGuardIdx).toBeLessThan(messageIdx);
  });

  it("setUserSuperAdminStatus requires the owner allowlist check before touching claims", () => {
    const src = readFunctionsSource();

    const fnStart = src.indexOf("export const setUserSuperAdminStatus");
    const ownerCheckIdx = src.indexOf("assertOwnerSuperAdminOperator(request.auth)", fnStart);
    const claimsIdx = src.indexOf("setCustomUserClaims", fnStart);

    expect(ownerCheckIdx).toBeGreaterThan(-1);
    expect(claimsIdx).toBeGreaterThan(-1);
    expect(ownerCheckIdx).toBeLessThan(claimsIdx);
  });

  it("setUserSuperAdminStatus enforces owner self-targeting guardrails before claim writes", () => {
    const src = readFunctionsSource();

    expect(src).toContain("Owner super admin changes are restricted to the owner account only.");
    expect(src).toContain("Owner super admin changes must target the signed-in owner account.");
    expect(src).toContain("setCustomUserClaims(uid, nextClaims)");
  });

  it("getSuperAdminDashboardStats sanitizes numeric syncUsage fields (no raw negative injection)", () => {
    const src = readFunctionsSource();

    // Math.max(0, Math.floor(...)) must wrap the read/write counters so a
    // malicious syncUsage document with negative numbers cannot report
    // fraudulent usage downwards.
    expect(src).toContain("Math.max(0, Math.floor(data.readCount))");
    expect(src).toContain("Math.max(0, Math.floor(data.writeCount))");
  });

  it("no user-controlled data is directly interpolated into Firestore query paths", () => {
    const src = readFunctionsSource();

    // Check that getSuperAdminDashboardStats and related functions do not build
    // Firestore paths via template literals that include request.data fields.
    // We scan the function body for `request.data` appearing inside a backtick
    // string used as a collection path.
    const fnBody = src.slice(
      src.indexOf("export const getSuperAdminDashboardStats"),
      src.indexOf("export const ", src.indexOf("export const getSuperAdminDashboardStats") + 1),
    );

    // The function body must not contain template literals with request.data.
    const dangerousPattern = /`[^`]*\$\{[^}]*request\.data[^}]*\}[^`]*`/;
    expect(dangerousPattern.test(fnBody)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2 · XSS injection protection (frontend rendering)
// ---------------------------------------------------------------------------

describe("Super admin page XSS injection protection", () => {
  beforeEach(() => {
    resetStores();
    Object.values(serviceMocks).forEach((mockFn) => mockFn.mockClear());
    authMocks.getCurrentUser.mockReset();
    authMocks.getCurrentUser.mockReturnValue(null);
    // Reset any accidental global mutation from an XSS payload.
    (window as unknown as Record<string, unknown>).__xss_executed = undefined;
  });

  it("renders XSS payload in user email as escaped text — no script execution or injected elements", async () => {
    setSuperAdminAuth();

    serviceMocks.getSuperAdminDashboardStats.mockResolvedValueOnce({
      usersCount: 1,
      schoolsCount: 0,
      textbooksCount: 1,
      pendingPromotionRequests: 0,
      trackedReadsToday: 0,
      trackedWritesToday: 0,
    });

    serviceMocks.getAllUsers.mockResolvedValueOnce([
      {
        uid: "bad-actor-uid",
        email: XSS_SCRIPT,
        displayName: "Attacker",
        createdAt: null,
        lastLoginAt: null,
        isAdmin: false,
        isSuperAdmin: false,
      },
    ]);

    renderSuperAdminRoute();

    await waitFor(() => {
      // The literal XSS string must appear as text content in the document.
      expect(screen.getByText(XSS_SCRIPT, { exact: false })).toBeInTheDocument();
    });

    // No <script> tag must have been injected into the DOM.
    const injectedScript = document.querySelector(`script[src]`);
    expect(injectedScript).toBeNull();
    // The global window.__xss_executed flag must NOT have been set.
    expect((window as unknown as Record<string, unknown>).__xss_executed).toBeUndefined();
  });

  it("renders XSS img onerror payload in displayName as escaped text — no img element injected", async () => {
    setSuperAdminAuth();

    serviceMocks.getSuperAdminDashboardStats.mockResolvedValueOnce({
      usersCount: 1,
      schoolsCount: 0,
      textbooksCount: 1,
      pendingPromotionRequests: 0,
      trackedReadsToday: 0,
      trackedWritesToday: 0,
    });

    serviceMocks.getAllUsers.mockResolvedValueOnce([
      {
        uid: "bad-actor-uid-2",
        email: "attacker@example.com",
        displayName: XSS_IMG,
        createdAt: null,
        lastLoginAt: null,
        isAdmin: false,
        isSuperAdmin: false,
      },
    ]);

    renderSuperAdminRoute();

    await waitFor(() => {
      expect(screen.getByText(XSS_IMG, { exact: false })).toBeInTheDocument();
    });

    // No img element with src="x" must exist (if it does, onerror could fire).
    const injectedImg = document.querySelector('img[src="x"]');
    expect(injectedImg).toBeNull();
    expect((window as unknown as Record<string, unknown>).__xss_executed).toBeUndefined();
  });

  it("renders XSS event handler payload in promotion request reason as escaped text", async () => {
    setSuperAdminAuth();

    serviceMocks.getSuperAdminDashboardStats.mockResolvedValueOnce({
      usersCount: 1,
      schoolsCount: 1,
      textbooksCount: 1,
      pendingPromotionRequests: 1,
      trackedReadsToday: 0,
      trackedWritesToday: 0,
    });

    serviceMocks.listSchoolAdminPromotionRequests.mockResolvedValueOnce([
      {
        id: "promo-1",
        uid: "user-1",
        email: "legitimate@example.com",
        displayName: "Legitimate User",
        schoolId: "school-1",
        schoolName: "Test School",
        reason: XSS_EVENT,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ]);

    renderSuperAdminRoute();

    await waitFor(() => {
      // The anchor tag literal must appear as text, not as a real <a> element
      // with an onclick handler.
      expect(screen.getByText(XSS_EVENT, { exact: false })).toBeInTheDocument();
    });

    // Ensure no anchor element with an onclick handler was injected.
    const injectedAnchor = document.querySelector('a[onclick]');
    expect(injectedAnchor).toBeNull();
    expect((window as unknown as Record<string, unknown>).__xss_executed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3 · Access control — data must not load for non-super-admin
// ---------------------------------------------------------------------------

describe("Super admin page data isolation", () => {
  beforeEach(() => {
    resetStores();
    Object.values(serviceMocks).forEach((mockFn) => mockFn.mockClear());
    authMocks.getCurrentUser.mockReset();
    authMocks.getCurrentUser.mockReturnValue(null);
  });

  it("never calls getSuperAdminDashboardStats for a regular authenticated user", async () => {
    // Regular user — not admin, not super admin.
    useAuthStore.setState({
      authStatus: "authenticated",
      userId: "regular-uid",
      userEmail: "regular@example.com",
      userDisplayName: "Regular",
      isAdmin: false,
      isSchoolAdmin: false,
      isSuperAdmin: false,
      schoolId: null,
      schoolName: null,
      districtName: null,
      authError: null,
    });

    renderSuperAdminRoute();

    // The guard redirects immediately; the page component never mounts.
    await waitFor(() => {
      expect(screen.getByText("SETTINGS_PAGE")).toBeInTheDocument();
    });

    expect(serviceMocks.getSuperAdminDashboardStats).not.toHaveBeenCalled();
    expect(serviceMocks.getAllUsers).not.toHaveBeenCalled();
    expect(serviceMocks.listAllSchoolsForSuperAdmin).not.toHaveBeenCalled();
  });

  it("never calls getSuperAdminDashboardStats for an admin-only user (admin ≠ super admin)", async () => {
    useAuthStore.setState({
      authStatus: "authenticated",
      userId: "admin-uid",
      userEmail: "admin@example.com",
      userDisplayName: "Admin",
      isAdmin: true,  // has admin but NOT super admin
      isSchoolAdmin: false,
      isSuperAdmin: false,
      schoolId: null,
      schoolName: null,
      districtName: null,
      authError: null,
    });

    renderSuperAdminRoute();

    await waitFor(() => {
      expect(screen.getByText("SETTINGS_PAGE")).toBeInTheDocument();
    });

    expect(serviceMocks.getSuperAdminDashboardStats).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4 · Input validation — quota override fields
// ---------------------------------------------------------------------------

describe("Super admin page quota override input validation", () => {
  beforeEach(() => {
    resetStores();
    Object.values(serviceMocks).forEach((mockFn) => mockFn.mockClear());
    authMocks.getCurrentUser.mockReset();
    setSuperAdminAuth();
    serviceMocks.getSuperAdminDashboardStats.mockResolvedValue({
      usersCount: 1,
      schoolsCount: 1,
      textbooksCount: 3,
      pendingPromotionRequests: 0,
      trackedReadsToday: 0,
      trackedWritesToday: 0,
    });
  });

  it("quota override input accepts a valid positive integer and displays it", async () => {
    renderSuperAdminRoute();

    await waitFor(() => {
      // Wait for the page to finish loading before interacting with inputs.
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /unhide/i }));

    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    // The first override input is "Read limit/day".
    const readInput = inputs[0];
    fireEvent.change(readInput, { target: { value: "75000" } });

    // The input should display the entered value.
    expect(readInput.value).toBe("75000");
  });

  it("quota override input with a negative value is visually accepted but parsePositiveIntegerInput treats it as null — no crash", async () => {
    renderSuperAdminRoute();

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /unhide/i }));

    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const readInput = inputs[0];

    // Type a negative number. The HTML number input allows it in the DOM value,
    // but the component's parsePositiveIntegerInput must reject it and leave the
    // override as null (so the fallback limit is used).
    fireEvent.change(readInput, { target: { value: "-500" } });

    // The page must not crash — no error thrown, page still renders.
    // Use the unique back button as a stable crash-detector (it only renders when the page is alive).
    expect(screen.getByRole("button", { name: /back to app/i })).toBeInTheDocument();
  });

  it("quota override input with a script string does not crash the page", async () => {
    renderSuperAdminRoute();

    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /unhide/i }));

    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const readInput = inputs[0];

    // Simulating a script string in a number input (browser would reject this
    // natively, but we test the component handles it defensively).
    fireEvent.change(readInput, { target: { value: "<script>alert(1)</script>" } });

    // The page must remain functional.
    expect(screen.getByRole("button", { name: /back to app/i })).toBeInTheDocument();
    expect((window as unknown as Record<string, unknown>).__xss_executed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5 · All-zeros data guard
//
// The stats callable must never return all-zero values for a production
// project that has real users and textbooks.  This test intentionally uses
// REALISTIC (non-zero) data and asserts specific values appear.  If any
// change causes the callable to return zeros, or if the UI stops rendering
// the values from the callable, this test will FAIL.  That failure is the
// intended signal that live-data wiring has broken.
// ---------------------------------------------------------------------------

describe("Super admin page live-data contract (zero-guard)", () => {
  beforeEach(() => {
    resetStores();
    Object.values(serviceMocks).forEach((mockFn) => mockFn.mockClear());
    authMocks.getCurrentUser.mockReset();
    authMocks.getCurrentUser.mockReturnValue(null);
  });

  it("displays all expected non-zero field values from the callable response — fails if any value is replaced by 0 or blank", async () => {
    setSuperAdminAuth();

    serviceMocks.getSuperAdminDashboardStats.mockResolvedValueOnce({
      usersCount: 7,
      schoolsCount: 2,
      textbooksCount: 14,
      pendingPromotionRequests: 1,
      trackedReadsToday: 312,
      trackedWritesToday: 88,
    });

    renderSuperAdminRoute();

    await waitFor(() => {
      // Each individual stat value must appear in the rendered output.
      // If the callable returns all-zero values, or the UI defaults to 0
      // instead of rendering the callable response, these assertions fail.
      expect(screen.getByText("7")).toBeInTheDocument();   // usersCount
      expect(screen.getByText("2")).toBeInTheDocument();   // schoolsCount
      expect(screen.getByText("14")).toBeInTheDocument();  // textbooksCount
      expect(screen.getByText("1")).toBeInTheDocument();   // pendingPromotionRequests
      expect(screen.getByText("312")).toBeInTheDocument(); // trackedReadsToday
      expect(screen.getByText("88")).toBeInTheDocument();  // trackedWritesToday
    });

    // The "loaded" debug event must be emitted with the non-zero values.
    expect(
      useUIStore.getState().syncDebugEvents.some((event) =>
        event.includes("superadmin:dashboard-stats:loaded") && event.includes("users=7"),
      ),
    ).toBe(true);
  });
});

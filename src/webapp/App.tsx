import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuthBootstrap } from "./hooks/useAuthBootstrap";
import { LoginPage } from "./components/auth/LoginPage";
import { RequireAdmin } from "./components/auth/RequireAdmin";
import { RequireAuth } from "./components/auth/RequireAuth";
import { TextbookWorkspace } from "./components/app/TextbookWorkspace";
import { useAuthStore } from "./store/authStore";

/**
 * Root web app router.
 *
 * Real path-based routes now support direct navigation to /admin, /textbooks,
 * and /textbooks/:id. Route guards defer to the auth bootstrap hook, which
 * restores persistent login state and refreshed custom claims before routing.
 */
export function App(): React.JSX.Element {
  useAuthBootstrap();

  const authStatus = useAuthStore((state) => state.authStatus);

  if (authStatus === "loading") {
    return (
      <div className="app-shell app-shell--login">
        <main className="app-main app-main--login">
          <section className="placeholder-panel login-panel">
            <h2>Loading CourseForge</h2>
            <p>Restoring your persistent session and syncing your workspace.</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/" element={<Navigate to="/textbooks" replace />} />
        <Route path="/textbooks" element={<TextbookWorkspace />} />
        <Route path="/textbooks/:id" element={<TextbookWorkspace />} />

        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<TextbookWorkspace showAdminPage />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={<Navigate to={authStatus === "authenticated" ? "/textbooks" : "/login"} replace />}
      />
    </Routes>
  );
}

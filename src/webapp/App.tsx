import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuthBootstrap } from "./hooks/useAuthBootstrap";
import { useAutoSync } from "./hooks/useAutoSync";
import { LoginPage } from "./components/auth/LoginPage";
import { RequireAdmin } from "./components/auth/RequireAdmin";
import { RequireAuth } from "./components/auth/RequireAuth";
import { TextbookWorkspace } from "./components/app/TextbookWorkspace";
import { SkeletonPageLayout } from "./components/skeleton/Skeleton";
import { useAuthStore } from "./store/authStore";

/**
 * Root web app router.
 *
 * Real path-based routes now support direct navigation to /admin, /textbooks,
 * and /textbooks/:id. Route guards defer to the auth bootstrap hook, which
 * restores persistent login state and refreshed custom claims before routing.
 */
export function App(): React.JSX.Element | null {
  useAuthBootstrap();
  useAutoSync();

  React.useEffect(() => {
    if (typeof window === "undefined" || window.location.protocol === "file:") {
      return;
    }

    const heartbeat = async () => {
      try {
        await fetch("/api/session-heartbeat", {
          method: "GET",
          cache: "no-store",
        });
      } catch {
        // Heartbeat is best-effort and only available in packaged local-server mode.
      }
    };

    void heartbeat();
    const intervalId = window.setInterval(() => {
      void heartbeat();
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const authStatus = useAuthStore((state) => state.authStatus);

  if (authStatus === "loading") {
    return <SkeletonPageLayout cardCount={2} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/" element={<Navigate to="/textbooks" replace />} />
        <Route path="/textbooks" element={<TextbookWorkspace />} />
        <Route path="/textbooks/:id" element={<TextbookWorkspace />} />
        <Route path="/textbooks/:id/chapters/:chapterId" element={<TextbookWorkspace />} />
        <Route path="/textbooks/:id/chapters/:chapterId/sections/:sectionId" element={<TextbookWorkspace />} />
        <Route path="/textbooks/:id/chapters/:chapterId/sections/:sectionId/:contentTab" element={<TextbookWorkspace />} />
        <Route path="/settings" element={<TextbookWorkspace showSettingsPage />} />

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

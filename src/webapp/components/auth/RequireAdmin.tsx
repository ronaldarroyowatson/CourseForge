import React from "react";
import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "../../store/authStore";

/**
 * Admin route guard.
 * Custom claims are refreshed through the auth bootstrap listener, so this guard
 * reacts automatically after token refreshes.
 */
export function RequireAdmin(): React.JSX.Element {
  const authStatus = useAuthStore((state) => state.authStatus);
  const isAdmin = useAuthStore((state) => state.isAdmin);

  if (authStatus === "loading") {
    return <section className="placeholder-panel"><p>Checking admin access...</p></section>;
  }

  if (authStatus !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/textbooks" replace />;
  }

  return <Outlet />;
}

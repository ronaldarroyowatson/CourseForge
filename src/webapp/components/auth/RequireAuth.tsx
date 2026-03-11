import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuthStore } from "../../store/authStore";

/**
 * Route guard for authenticated pages.
 * Users without a restored Firebase session are redirected to the login screen.
 */
export function RequireAuth(): React.JSX.Element {
  const location = useLocation();
  const authStatus = useAuthStore((state) => state.authStatus);

  if (authStatus === "loading") {
    return <section className="placeholder-panel"><p>Restoring your session...</p></section>;
  }

  if (authStatus !== "authenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

import React from "react";
import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "../../store/authStore";

export function RequireSchoolAdmin(): React.JSX.Element {
  const authStatus = useAuthStore((state) => state.authStatus);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const isSchoolAdmin = useAuthStore((state) => state.isSchoolAdmin);

  if (authStatus === "loading") {
    return <section className="placeholder-panel"><p>Checking school admin access...</p></section>;
  }

  if (authStatus !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin && !isSchoolAdmin) {
    return <Navigate to="/settings" replace />;
  }

  return <Outlet />;
}

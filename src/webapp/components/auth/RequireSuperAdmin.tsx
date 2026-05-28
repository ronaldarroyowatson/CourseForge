import React from "react";
import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "../../store/authStore";

export function RequireSuperAdmin(): React.JSX.Element {
  const authStatus = useAuthStore((state) => state.authStatus);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);

  if (authStatus === "loading") {
    return <section className="placeholder-panel"><p>Checking super admin access...</p></section>;
  }

  if (authStatus !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin && !isAdmin) {
    return <Navigate to="/settings" replace />;
  }

  return <Outlet />;
}

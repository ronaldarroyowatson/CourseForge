import React from "react";
import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";

export function RequireSuperAdmin(): React.JSX.Element {
  const authStatus = useAuthStore((state) => state.authStatus);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const addSyncDebugEvent = useUIStore((state) => state.addSyncDebugEvent);

  React.useEffect(() => {
    if (authStatus === "loading") {
      return;
    }

    if (authStatus !== "authenticated") {
      addSyncDebugEvent("superadmin:route-access-denied - unauthenticated");
      return;
    }

    if (!isSuperAdmin) {
      addSyncDebugEvent("superadmin:route-access-denied - missing-super-admin-claim");
      return;
    }

    addSyncDebugEvent("superadmin:route-access-allowed");
  }, [addSyncDebugEvent, authStatus, isSuperAdmin]);

  if (authStatus === "loading") {
    return <section className="placeholder-panel"><p>Checking super admin access...</p></section>;
  }

  if (authStatus !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin) {
    return <Navigate to="/settings" replace />;
  }

  return <Outlet />;
}

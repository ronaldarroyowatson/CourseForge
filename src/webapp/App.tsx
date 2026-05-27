import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuthBootstrap } from "./hooks/useAuthBootstrap";
import { useAutoSync } from "./hooks/useAutoSync";
import { LoginPage } from "./components/auth/LoginPage";
import { RequireAdmin } from "./components/auth/RequireAdmin";
import { RequireAuth } from "./components/auth/RequireAuth";
import { TextbookWorkspace } from "./components/app/TextbookWorkspace";
import { useAuthStore } from "./store/authStore";

type StartupTelemetry = {
  bootStep: string;
  bootMessage: string;
  bootProgressPercent: number | null;
  updaterState: string;
  updaterMessage: string;
  currentVersion: string | null;
  latestVersion: string | null;
};

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("application/json");
}

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

  const splashEnabled = import.meta.env.MODE !== "test";

  const [showStartupSplash, setShowStartupSplash] = React.useState(splashEnabled);
  const [startupTelemetry, setStartupTelemetry] = React.useState<StartupTelemetry>({
    bootStep: "starting",
    bootMessage: "Starting CourseForge...",
    bootProgressPercent: null,
    updaterState: "idle",
    updaterMessage: "Checking updater status...",
    currentVersion: null,
    latestVersion: null,
  });

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

  React.useEffect(() => {
    if (!splashEnabled) {
      setShowStartupSplash(false);
      return;
    }

    if (typeof window === "undefined") {
      setShowStartupSplash(false);
      return;
    }

    let disposed = false;
    const startedAt = Date.now();
    const minSplashMs = 1200;

    const readStartupTelemetry = async () => {
      const [bootResult, updaterResult] = await Promise.allSettled([
        fetch("/api/boot-status", { method: "GET", cache: "no-store" }),
        fetch("/api/updater-progress", { method: "GET", cache: "no-store" }),
      ]);

      let bootStep = "running";
      let bootMessage = "CourseForge server is running.";
      let bootProgressPercent: number | null = null;
      if (bootResult.status === "fulfilled" && bootResult.value.ok && isJsonResponse(bootResult.value)) {
        const payload = await bootResult.value.json() as {
          step?: string;
          message?: string;
          progressPercent?: number;
        };
        bootStep = payload.step || bootStep;
        bootMessage = payload.message || bootMessage;
        bootProgressPercent = typeof payload.progressPercent === "number" ? payload.progressPercent : null;
      }

      let updaterState = "idle";
      let updaterMessage = "Updater idle.";
      let currentVersion: string | null = null;
      let latestVersion: string | null = null;
      if (updaterResult.status === "fulfilled" && updaterResult.value.ok && isJsonResponse(updaterResult.value)) {
        const payload = await updaterResult.value.json() as {
          state?: string;
          message?: string;
          currentVersion?: string | null;
          latestVersion?: string | null;
        };
        updaterState = payload.state || updaterState;
        updaterMessage = payload.message || updaterMessage;
        currentVersion = payload.currentVersion ?? null;
        latestVersion = payload.latestVersion ?? null;
      }

      if (!disposed) {
        setStartupTelemetry({
          bootStep,
          bootMessage,
          bootProgressPercent,
          updaterState,
          updaterMessage,
          currentVersion,
          latestVersion,
        });
      }
    };

    void readStartupTelemetry().finally(() => {
      if (disposed) {
        return;
      }
      const elapsed = Date.now() - startedAt;
      const delay = Math.max(0, minSplashMs - elapsed);
      window.setTimeout(() => {
        if (!disposed) {
          setShowStartupSplash(false);
        }
      }, delay);
    });

    return () => {
      disposed = true;
    };
  }, [splashEnabled]);

  const authStatus = useAuthStore((state) => state.authStatus);

  if (splashEnabled && (showStartupSplash || authStatus === "loading")) {
    return (
      <section
        role="status"
        aria-live="polite"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "radial-gradient(circle at 20% 20%, #14395f 0%, #0a1f36 50%, #071224 100%)",
          color: "#e8f0ff",
          padding: "2rem",
        }}
      >
        <div style={{ width: "min(720px, 100%)", border: "1px solid rgba(130, 174, 235, 0.35)", borderRadius: "14px", background: "rgba(8, 21, 38, 0.82)", padding: "1.25rem 1.5rem" }}>
          <h1 style={{ margin: "0 0 0.5rem 0", fontSize: "1.35rem" }}>CourseForge</h1>
          <p style={{ margin: "0 0 0.8rem 0", opacity: 0.95 }}>Loading startup telemetry...</p>
          <p style={{ margin: "0.35rem 0" }}><strong>Boot:</strong> {startupTelemetry.bootStep} - {startupTelemetry.bootMessage}</p>
          <p style={{ margin: "0.35rem 0" }}><strong>Updater:</strong> {startupTelemetry.updaterState} - {startupTelemetry.updaterMessage}</p>
          <p style={{ margin: "0.35rem 0" }}>
            <strong>Version:</strong> {startupTelemetry.currentVersion ?? "unknown"}
            {startupTelemetry.latestVersion ? ` | latest ${startupTelemetry.latestVersion}` : ""}
          </p>
          {typeof startupTelemetry.bootProgressPercent === "number" ? (
            <progress style={{ width: "100%", marginTop: "0.75rem" }} max={100} value={Math.max(0, Math.min(100, startupTelemetry.bootProgressPercent))} />
          ) : null}
        </div>
      </section>
    );
  }

  if (authStatus === "loading") {
    return null;
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

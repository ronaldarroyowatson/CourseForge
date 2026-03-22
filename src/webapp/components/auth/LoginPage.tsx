import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { signInWithGoogle } from "../../../firebase/auth";
import { useAuthStore } from "../../store/authStore";

/**
 * Login screen for users without an active Firebase session.
 * Persistent auth means most returning users never see this page after first sign-in.
 */
export function LoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const authStatus = useAuthStore((state) => state.authStatus);
  const authError = useAuthStore((state) => state.authError);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (authStatus === "authenticated") {
      const redirectTarget = (location.state as { from?: string } | null)?.from ?? "/textbooks";
      navigate(redirectTarget, { replace: true });
    }
  }, [authStatus, location.state, navigate]);

  async function handleGoogleSignIn(): Promise<void> {
    setIsSigningIn(true);
    setSignInError(null);

    try {
      await signInWithGoogle();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in with Google.";
      setSignInError(message);
    } finally {
      setIsSigningIn(false);
    }
  }

  return (
    <div className="app-shell app-shell--login">
      <main className="app-main app-main--login">
        <section className="placeholder-panel login-panel">
          <img
            src="/placeholder-icons/coderabbit-placeholder.svg"
            alt="CourseForge placeholder icon"
            className="placeholder-brand-icon"
          />
          <h2>Sign in to CourseForge</h2>
          <p>CourseForge remembers your session and restores your local-first workspace automatically.</p>
          <button type="button" onClick={() => { void handleGoogleSignIn(); }} disabled={isSigningIn}>
            {isSigningIn ? "Signing in..." : "Sign in with Google"}
          </button>
          {signInError ? <p className="error-text">Sign-in failed: {signInError}</p> : null}
          {authError ? <p className="error-text">Auth error: {authError}</p> : null}
        </section>
      </main>
    </div>
  );
}

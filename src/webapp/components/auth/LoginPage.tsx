import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AUTH_PROVIDER_OPTIONS, getCurrentUser, getLinkedAuthProviderIds, getPendingAuthRedirect, linkCurrentUserWithAuthProvider, shouldUseRedirectFlow, signInWithAuthProvider, signInWithLocalOnlyAccount, startLinkCurrentUserWithAuthProviderRedirect, startSignInWithAuthProviderRedirect, type AuthProviderKey } from "../../../firebase/auth";
import { useAuthStore } from "../../store/authStore";
import courseForgeIcon from "../../../assets/CourseForge.ico";

const PROVIDER_ID_MAP: Record<AuthProviderKey, string> = {
  google: "google.com",
  github: "github.com",
  microsoft: "microsoft.com",
  apple: "apple.com",
};

function ProviderIcon({ providerId }: { providerId: AuthProviderKey }): React.JSX.Element {
  switch (providerId) {
    case "google":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="#EA4335" d="M12 10.2v4h5.6c-.2 1.3-.9 2.4-2 3.1l3.2 2.5c1.9-1.8 3-4.4 3-7.6 0-.7-.1-1.4-.2-2H12z" />
          <path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6C4.8 19.9 8.1 22 12 22z" />
          <path fill="#FBBC05" d="M6.4 13.9c-.2-.6-.3-1.2-.3-1.9s.1-1.3.3-1.9V7.5H3.1C2.4 8.9 2 10.4 2 12s.4 3.1 1.1 4.5l3.3-2.6z" />
          <path fill="#4285F4" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3.1 14.7 2 12 2 8.1 2 4.8 4.1 3.1 7.5l3.3 2.6C7.2 7.7 9.4 6 12 6z" />
        </svg>
      );
    case "github":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M12 .5a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2.16c-3.34.73-4.04-1.41-4.04-1.41-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.24 1.85 1.24 1.08 1.85 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.24-.12-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.24A11.41 11.41 0 0 1 12 6.3c1.02 0 2.05.14 3.01.42 2.29-1.56 3.3-1.24 3.3-1.24.66 1.65.24 2.88.12 3.18.77.85 1.24 1.92 1.24 3.24 0 4.64-2.8 5.66-5.48 5.96.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.58A12 12 0 0 0 12 .5z" />
        </svg>
      );
    case "microsoft":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect x="2" y="2" width="9" height="9" fill="#F25022" />
          <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
          <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
          <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
        </svg>
      );
    case "apple":
      return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M16.7 12.8c0-2 1.6-3 1.7-3.1-1-.9-2.5-1-3-.9-1.3.2-2.4.8-3 .8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.6 2.2-1.6 2.8-.4 6.9 1.1 9 .7 1 1.6 2.1 2.7 2 .9 0 1.3-.6 2.4-.6s1.4.6 2.4.6c1.2 0 1.9-1 2.6-2 .8-1.2 1.1-2.3 1.1-2.4-.1 0-2.5-1-2.5-3.8z" />
          <path fill="currentColor" d="M14.8 6.9c.6-.8 1-1.9.9-2.9-.9 0-2 .6-2.6 1.4-.6.7-1.1 1.8-.9 2.8 1 0 2-.5 2.6-1.3z" />
        </svg>
      );
  }
}

/**
 * Login screen for users without an active Firebase session.
 * Persistent auth means most returning users never see this page after first sign-in.
 */
export function LoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const authStatus = useAuthStore((state) => state.authStatus);
  const authError = useAuthStore((state) => state.authError);
  const pendingRedirect = React.useMemo(() => getPendingAuthRedirect(), []);
  const linkState = (location.state as { from?: string; linkProviderId?: AuthProviderKey; linkMode?: boolean } | null);
  const queryParams = React.useMemo(() => new URLSearchParams(location.search), [location.search]);
  const linkModeFromQuery = queryParams.get("linkMode");
  const hasQueryLinkMode = linkModeFromQuery === "true" || linkModeFromQuery === "1";
  const queryFrom = queryParams.get("from");
  const canUsePendingLinkRedirect = authStatus === "authenticated";
  const linkProviderId = linkState?.linkProviderId ?? (canUsePendingLinkRedirect && pendingRedirect?.mode === "link" ? pendingRedirect.providerId : null);
  const isLinkMode = Boolean(linkState?.linkMode || hasQueryLinkMode || linkProviderId || (canUsePendingLinkRedirect && pendingRedirect?.mode === "link"));
  const [isSigningIn, setIsSigningIn] = React.useState<AuthProviderKey | "local" | null>(null);
  const [localUsername, setLocalUsername] = React.useState("");
  const [signInError, setSignInError] = React.useState<string | null>(null);
  const [localCardExpanded, setLocalCardExpanded] = React.useState(false);
  const [hasChosenCloudProvider, setHasChosenCloudProvider] = React.useState(isLinkMode);
  const localCardRef = React.useRef<HTMLDivElement | null>(null);

  const showOnlyLocalCard = localCardExpanded && !hasChosenCloudProvider && !isLinkMode;
  const localOptionDisabled = hasChosenCloudProvider || isLinkMode;
  const linkedProviderIds = React.useMemo(() => {
    if (!isLinkMode) {
      return new Set<string>();
    }

    return new Set(getLinkedAuthProviderIds(getCurrentUser()));
  }, [isLinkMode, authStatus]);

  React.useEffect(() => {
    if (authStatus === "authenticated" && !isLinkMode) {
      const redirectTarget = linkState?.from ?? queryFrom ?? "/textbooks";
      navigate(redirectTarget, { replace: true });
    }
  }, [authStatus, isLinkMode, linkState?.from, queryFrom, navigate]);

  React.useEffect(() => {
    if (!showOnlyLocalCard) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!localCardRef.current || !target) {
        return;
      }

      if (!localCardRef.current.contains(target)) {
        setLocalCardExpanded(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showOnlyLocalCard]);

  async function handleProviderSignIn(providerId: AuthProviderKey): Promise<void> {
    setIsSigningIn(providerId);
    setSignInError(null);
    setHasChosenCloudProvider(true);
    setLocalCardExpanded(false);

    try {
      if (isLinkMode) {
        if (shouldUseRedirectFlow(providerId)) {
          await startLinkCurrentUserWithAuthProviderRedirect(providerId);
          return;
        }

        await linkCurrentUserWithAuthProvider(providerId);
        const returnTo = linkState?.from ?? queryFrom ?? "/settings";
        navigate(returnTo, { replace: true, state: { linkedProvider: providerId } });
        return;
      }

      if (shouldUseRedirectFlow(providerId)) {
        await startSignInWithAuthProviderRedirect(providerId);
        return;
      }

      await signInWithAuthProvider(providerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to sign in with ${providerId}.`;
      setSignInError(message);
    } finally {
      setIsSigningIn(null);
    }
  }

  async function handleLocalOnlySignIn(): Promise<void> {
    setIsSigningIn("local");
    setSignInError(null);

    try {
      await signInWithLocalOnlyAccount(localUsername);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start a local-only session.";
      setSignInError(message);
    } finally {
      setIsSigningIn(null);
    }
  }

  function handleLocalCardActivate(): void {
    if (localOptionDisabled || isSigningIn !== null) {
      return;
    }

    setSignInError(null);
    setLocalCardExpanded(true);
  }

  function handleLocalCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleLocalCardActivate();
  }

  const localInputWidthCh = Math.max(14, localUsername.trim().length + 2);

  return (
    <div className="app-shell app-shell--login">
      <main className="app-main app-main--login">
        <section className="placeholder-panel login-panel">
          <div className="login-panel__header">
            <img
              src={courseForgeIcon}
              alt="CourseForge icon"
              className="placeholder-brand-icon"
            />
            <h2>Sign in to CourseForge</h2>
            <p>Choose a cloud provider to sync across devices, or create a local-only account for manual mode.</p>
          </div>
          {isLinkMode ? <p className="manual-entry-banner">You were sent here to continue linking your account. Google, GitHub, Microsoft, and Apple are all available below.</p> : null}
          <div className="login-auth-grid">
            <div
              ref={localCardRef}
              role="button"
              tabIndex={localOptionDisabled ? -1 : 0}
              aria-disabled={localOptionDisabled}
              className={`login-auth-card login-auth-card--local ${showOnlyLocalCard ? "login-auth-card--expanded" : ""} ${localOptionDisabled ? "login-auth-card--disabled" : ""}`}
              onClick={() => { handleLocalCardActivate(); }}
              onKeyDown={handleLocalCardKeyDown}
            >
              <div className="login-auth-card__head">
                <span className="login-auth-card__icon" aria-hidden="true">L</span>
                <strong>Local Only</strong>
              </div>
              {!localOptionDisabled && showOnlyLocalCard ? <p className="login-auth-card__desc">Keep data on this device only and use manual mode.</p> : null}

              {showOnlyLocalCard ? (
                <div className="login-auth-card__local-fields" onClick={(event) => { event.stopPropagation(); }}>
                  <label className="login-local-account">
                    <span>Local-only username</span>
                    <input
                      type="text"
                      value={localUsername}
                      onChange={(event) => setLocalUsername(event.target.value)}
                      placeholder="Enter a display name"
                      autoComplete="nickname"
                      style={{ width: `${localInputWidthCh}ch` }}
                    />
                  </label>
                  <button type="button" onClick={() => { void handleLocalOnlySignIn(); }} disabled={isSigningIn !== null || !localUsername.trim()}>
                    {isSigningIn === "local" ? "Starting local account..." : "Start local-only account"}
                  </button>
                </div>
              ) : null}
            </div>

            {!showOnlyLocalCard ? AUTH_PROVIDER_OPTIONS.map((provider) => {
              const isProviderAlreadyLinked = linkedProviderIds.has(PROVIDER_ID_MAP[provider.id]);
              const isDisabled = isSigningIn !== null || isProviderAlreadyLinked;

              return (
                <button
                  key={provider.id}
                  type="button"
                  aria-label={isLinkMode ? `Link with ${provider.label}` : `Sign in with ${provider.label}`}
                  className={`login-auth-card login-auth-card--cloud ${isProviderAlreadyLinked ? "login-auth-card--disabled login-auth-card--linked" : ""}`}
                  onClick={() => { void handleProviderSignIn(provider.id); }}
                  disabled={isDisabled}
                  aria-disabled={isDisabled}
                  title={provider.description}
                >
                  <span className="login-auth-card__head">
                    <span className="login-auth-card__icon" aria-hidden="true"><ProviderIcon providerId={provider.id} /></span>
                    <strong>{provider.label}</strong>
                  </span>
                  {isProviderAlreadyLinked ? <span className="login-auth-card__connected">Connected</span> : null}
                  {isSigningIn === provider.id ? <span className="login-auth-card__busy">Working...</span> : null}
                </button>
              );
            }) : null}
          </div>
          {isLinkMode ? (
            <button type="button" className="btn-secondary login-back-button" onClick={() => { navigate("/settings"); }}>
              Back to Settings
            </button>
          ) : null}
          {signInError ? <p className="error-text">Sign-in failed: {signInError}</p> : null}
          {authError ? <p className="error-text">Auth error: {authError}</p> : null}
        </section>
      </main>
    </div>
  );
}

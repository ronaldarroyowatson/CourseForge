import {
  type Auth,
  browserLocalPersistence,
  getRedirectResult,
  GoogleAuthProvider,
  linkWithPopup,
  linkWithRedirect,
  getAuth,
  initializeAuth,
  OAuthProvider,
  onIdTokenChanged,
  signInWithRedirect,
  signInWithPopup,
  setPersistence,
  signOut,
  type Unsubscribe,
  type User,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { firebaseApp } from "./firebaseApp";
import { getFirebaseConfigError } from "./firebaseConfig";
import { firestoreDb } from "./firestore";

type ViteEnvLike = {
  DEV?: boolean;
};

export type AuthProviderKey = "google" | "github" | "microsoft" | "apple";
export type AuthMode = "cloud" | "local";

export const AUTH_PROVIDER_OPTIONS: Array<{
  id: AuthProviderKey;
  label: string;
  description: string;
}> = [
  {
    id: "google",
    label: "Google",
    description: "Use your Google account to sign in or link this login method.",
  },
  {
    id: "github",
    label: "GitHub",
    description: "Use GitHub as an alternate sign-in path for the same account.",
  },
  {
    id: "microsoft",
    label: "Microsoft",
    description: "Use Microsoft as a second sign-in path for the same account.",
  },
  {
    id: "apple",
    label: "Apple",
    description: "Use Apple as a fallback sign-in path for the same account.",
  },
];

const REDIRECT_AUTH_PROVIDER_IDS = new Set<AuthProviderKey>(["microsoft", "apple"]);

interface LocalAuthSession {
  userId: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

interface StagedLocalToCloudMigration {
  sourceLocalUserId: string;
  sourceDisplayName: string;
  localCreatedAt: string;
  localUpdatedAt: string;
  stagedAt: string;
}

type AuthRedirectMode = "sign-in" | "link";

interface PendingAuthRedirect {
  mode: AuthRedirectMode;
  providerId: AuthProviderKey;
  fromPath: string | null;
  startedAt: string;
}

interface AuthRedirectDebugEntry {
  timestamp: string;
  event: string;
  mode?: AuthRedirectMode;
  providerId?: AuthProviderKey;
  detail?: string;
}

function getProviderLabel(providerId: AuthProviderKey): string {
  return AUTH_PROVIDER_OPTIONS.find((provider) => provider.id === providerId)?.label ?? providerId;
}

function buildProviderStartError(providerId: AuthProviderKey, error: unknown): Error {
  const code = (error as { code?: string })?.code ?? "unknown";
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalizedMessage = rawMessage.toLowerCase();
  const providerLabel = getProviderLabel(providerId);

  if (
    code === "auth/operation-not-allowed"
    || normalizedMessage.includes("operation_not_allowed")
    || normalizedMessage.includes("identity provider configuration is not found")
  ) {
    return new Error(
      `${providerLabel} sign-in is not configured for this Firebase project. Enable the ${providerLabel} provider in Firebase Authentication settings before trying again.`
    );
  }

  if (code === "auth/unauthorized-domain" || normalizedMessage.includes("unauthorized-domain")) {
    return new Error(
      `This app domain is not authorized for ${providerLabel} sign-in. Add the current host to Firebase Authentication authorized domains and try again.`
    );
  }

  return new Error(rawMessage || `Unable to start ${providerLabel} sign-in.`);
}

function getFirebaseProviderId(providerId: AuthProviderKey): string {
  switch (providerId) {
    case "google":
      return "google.com";
    case "github":
      return "github.com";
    case "microsoft":
      return "microsoft.com";
    case "apple":
      return "apple.com";
  }
}

async function assertProviderRedirectConfig(providerId: AuthProviderKey): Promise<void> {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return;
  }

  const apiKey = (firebaseApp as { options?: { apiKey?: unknown } }).options?.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    return;
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/createAuthUri?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          continueUri: `${window.location.origin}/login`,
          providerId: getFirebaseProviderId(providerId),
        }),
      }
    );

    if (response.ok) {
      return;
    }

    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    const message = payload?.error?.message ?? `HTTP_${response.status}`;
    throw {
      code: response.status === 400 ? "auth/operation-not-allowed" : "auth/unknown",
      message,
    };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const message = String((error as { message?: string })?.message ?? "").toLowerCase();
    const hasProviderConfigSignal =
      code === "auth/operation-not-allowed"
      || message.includes("operation_not_allowed")
      || message.includes("identity provider configuration is not found")
      || message.includes("unauthorized_domain");

    if (hasProviderConfigSignal) {
      throw buildProviderStartError(providerId, error);
    }
  }
}

const viteEnv = (import.meta as ImportMeta & { env?: ViteEnvLike } | undefined)?.env;
const isDevRuntime = Boolean(viteEnv?.DEV);
const LOCAL_AUTH_STORAGE_KEY = "courseforge.localAuthSession";
const LOCAL_TO_CLOUD_MIGRATION_STORAGE_KEY = "courseforge.localToCloudMigration";
const PENDING_AUTH_REDIRECT_STORAGE_KEY = "courseforge.pendingAuthRedirect";
const AUTH_REDIRECT_DEBUG_STORAGE_KEY = "courseforge.authRedirectDebug";
const MAX_AUTH_REDIRECT_DEBUG_ENTRIES = 120;

function logAuthSyncEvent(type: string, path: string, payload: unknown, error?: unknown): void {
  if (!isDevRuntime) {
    return;
  }

  if (!error) {
    console.info("[CourseForge auth-sync]", { type, path, payload, timestamp: new Date().toISOString() });
    return;
  }

  const code = (error as { code?: string })?.code ?? "unknown";
  console.error("[CourseForge auth-sync]", {
    type,
    path,
    payload,
    code,
    error,
    timestamp: new Date().toISOString(),
  });
}

function isExtensionRuntime(): boolean {
  const runtimeId = (globalThis as { chrome?: { runtime?: { id?: unknown } } }).chrome?.runtime?.id;
  return typeof runtimeId === "string";
}

function detectBrowserLanguageTag(): string {
  if (typeof navigator === "undefined") {
    return "en";
  }

  const first = navigator.languages?.[0] ?? navigator.language ?? "en";
  return first.split(/[-_]/)[0]?.toLowerCase() || "en";
}

let cachedAuth: Auth | null = null;
let persistenceReady = false;
const AUTH_PERSISTENCE_TIMEOUT_MS = 4500;
let redirectResolutionInFlight: Promise<void> | null = null;

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  return window.localStorage;
}

function readLocalAuthSession(): LocalAuthSession | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(LOCAL_AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<LocalAuthSession>;
    if (typeof parsed.userId !== "string" || typeof parsed.displayName !== "string") {
      return null;
    }

    return {
      userId: parsed.userId,
      displayName: parsed.displayName,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function persistLocalAuthSession(displayName: string): LocalAuthSession {
  const storage = getLocalStorage();
  const trimmedDisplayName = displayName.trim();
  const now = new Date().toISOString();
  const existing = readLocalAuthSession();
  const session: LocalAuthSession = existing ?? {
    userId: `local-${trimmedDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user"}-${Math.random().toString(36).slice(2, 8)}`,
    displayName: trimmedDisplayName,
    createdAt: now,
    updatedAt: now,
  };

  session.displayName = trimmedDisplayName;
  session.updatedAt = now;

  if (storage) {
    storage.setItem(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(session));
  }

  return session;
}

function clearLocalAuthSession(): void {
  const storage = getLocalStorage();
  storage?.removeItem(LOCAL_AUTH_STORAGE_KEY);
}

function readStagedLocalToCloudMigration(): StagedLocalToCloudMigration | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(LOCAL_TO_CLOUD_MIGRATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StagedLocalToCloudMigration>;
    if (
      typeof parsed.sourceLocalUserId !== "string"
      || typeof parsed.sourceDisplayName !== "string"
      || typeof parsed.localCreatedAt !== "string"
      || typeof parsed.localUpdatedAt !== "string"
      || typeof parsed.stagedAt !== "string"
    ) {
      return null;
    }

    return {
      sourceLocalUserId: parsed.sourceLocalUserId,
      sourceDisplayName: parsed.sourceDisplayName,
      localCreatedAt: parsed.localCreatedAt,
      localUpdatedAt: parsed.localUpdatedAt,
      stagedAt: parsed.stagedAt,
    };
  } catch {
    return null;
  }
}

function clearStagedLocalToCloudMigration(): void {
  const storage = getLocalStorage();
  storage?.removeItem(LOCAL_TO_CLOUD_MIGRATION_STORAGE_KEY);
}

function appendAuthRedirectDebug(entry: Omit<AuthRedirectDebugEntry, "timestamp">): void {
  const storage = getLocalStorage();
  const nextEntry: AuthRedirectDebugEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  if (isDevRuntime) {
    console.info("[CourseForge auth-redirect]", nextEntry);
  }

  if (!storage) {
    return;
  }

  try {
    const existingRaw = storage.getItem(AUTH_REDIRECT_DEBUG_STORAGE_KEY);
    const existing = existingRaw ? JSON.parse(existingRaw) as AuthRedirectDebugEntry[] : [];
    const normalized = Array.isArray(existing) ? existing : [];
    normalized.push(nextEntry);
    storage.setItem(
      AUTH_REDIRECT_DEBUG_STORAGE_KEY,
      JSON.stringify(normalized.slice(-MAX_AUTH_REDIRECT_DEBUG_ENTRIES))
    );
  } catch {
    // Debug tracing must never break auth flows.
  }
}

function readPendingAuthRedirect(): PendingAuthRedirect | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(PENDING_AUTH_REDIRECT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PendingAuthRedirect>;
    if (
      (parsed.mode !== "sign-in" && parsed.mode !== "link")
      || !parsed.providerId
      || !AUTH_PROVIDER_OPTIONS.some((provider) => provider.id === parsed.providerId)
      || typeof parsed.startedAt !== "string"
    ) {
      return null;
    }

    return {
      mode: parsed.mode,
      providerId: parsed.providerId,
      fromPath: typeof parsed.fromPath === "string" ? parsed.fromPath : null,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function writePendingAuthRedirect(next: PendingAuthRedirect): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  storage.setItem(PENDING_AUTH_REDIRECT_STORAGE_KEY, JSON.stringify(next));
}

export function clearPendingAuthRedirect(): void {
  const storage = getLocalStorage();
  storage?.removeItem(PENDING_AUTH_REDIRECT_STORAGE_KEY);
}

export function getPendingAuthRedirect(): PendingAuthRedirect | null {
  return readPendingAuthRedirect();
}

export function getAuthRedirectDebugEntries(): AuthRedirectDebugEntry[] {
  const storage = getLocalStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(AUTH_REDIRECT_DEBUG_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as AuthRedirectDebugEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stagePendingAuthRedirect(mode: AuthRedirectMode, providerId: AuthProviderKey): void {
  const pending: PendingAuthRedirect = {
    mode,
    providerId,
    fromPath: typeof window !== "undefined" ? window.location.pathname : null,
    startedAt: new Date().toISOString(),
  };

  writePendingAuthRedirect(pending);
  appendAuthRedirectDebug({
    event: "redirect-staged",
    mode,
    providerId,
    detail: pending.fromPath ?? undefined,
  });
}

export function stageLocalToCloudMigrationCandidate(): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  const localSession = readLocalAuthSession();
  if (!localSession) {
    return;
  }

  const staged: StagedLocalToCloudMigration = {
    sourceLocalUserId: localSession.userId,
    sourceDisplayName: localSession.displayName,
    localCreatedAt: localSession.createdAt,
    localUpdatedAt: localSession.updatedAt,
    stagedAt: new Date().toISOString(),
  };

  storage.setItem(LOCAL_TO_CLOUD_MIGRATION_STORAGE_KEY, JSON.stringify(staged));
}

export async function flushStagedLocalToCloudMigration(user: User): Promise<void> {
  const staged = readStagedLocalToCloudMigration();
  if (!staged) {
    return;
  }

  await setDoc(
    doc(firestoreDb, "users", user.uid),
    {
      localToCloudMigration: {
        sourceLocalUserId: staged.sourceLocalUserId,
        sourceDisplayName: staged.sourceDisplayName,
        localCreatedAt: staged.localCreatedAt,
        localUpdatedAt: staged.localUpdatedAt,
        stagedAt: staged.stagedAt,
        committedAt: serverTimestamp(),
      },
      displayName: user.displayName ?? staged.sourceDisplayName,
    },
    { merge: true }
  );

  clearStagedLocalToCloudMigration();
}

export function getStoredLocalAuthSession(): LocalAuthSession | null {
  return readLocalAuthSession();
}

export async function signInWithLocalOnlyAccount(displayName: string): Promise<LocalAuthSession> {
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName) {
    throw new Error("Enter a username before continuing in local-only mode.");
  }

  const session = persistLocalAuthSession(trimmedDisplayName);

  try {
    const auth = await initializePersistentAuth();
    await signOut(auth);
  } catch {
    // Local-only mode must keep working even if Firebase sign-out is unavailable.
  }

  return session;
}

function getOAuthProvider(providerId: AuthProviderKey): GoogleAuthProvider | OAuthProvider {
  switch (providerId) {
    case "google": {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      return provider;
    }
    case "github": {
      const provider = new OAuthProvider("github.com");
      provider.addScope("read:user");
      provider.addScope("user:email");
      provider.setCustomParameters({ prompt: "select_account" });
      return provider;
    }
    case "microsoft": {
      const provider = new OAuthProvider("microsoft.com");
      provider.setCustomParameters({ prompt: "select_account" });
      return provider;
    }
    case "apple": {
      const provider = new OAuthProvider("apple.com");
      provider.setCustomParameters({ prompt: "select_account" });
      return provider;
    }
  }
}

export function shouldUseRedirectFlow(providerId: AuthProviderKey): boolean {
  return REDIRECT_AUTH_PROVIDER_IDS.has(providerId);
}

export function getLinkedAuthProviderIds(user: User | null | undefined): string[] {
  return user?.providerData
    .map((provider) => provider.providerId)
    .filter((providerId): providerId is string => Boolean(providerId))
    .filter((providerId, index, providerIds) => providerIds.indexOf(providerId) === index) ?? [];
}

export async function signInWithAuthProvider(providerId: AuthProviderKey): Promise<User> {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const auth = await initializePersistentAuth();

  stageLocalToCloudMigrationCandidate();
  try {
    const result = await signInWithPopup(auth, getOAuthProvider(providerId));
    clearLocalAuthSession();
    return result.user;
  } catch (error) {
    throw buildProviderStartError(providerId, error);
  }
}

export async function startSignInWithAuthProviderRedirect(providerId: AuthProviderKey): Promise<void> {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const auth = await initializePersistentAuth();
  await assertProviderRedirectConfig(providerId);
  stagePendingAuthRedirect("sign-in", providerId);
  stageLocalToCloudMigrationCandidate();
  try {
    await signInWithRedirect(auth, getOAuthProvider(providerId));
    clearLocalAuthSession();
  } catch (error) {
    clearPendingAuthRedirect();
    const code = (error as { code?: string })?.code ?? "unknown";
    const message = error instanceof Error ? error.message : String(error);
    appendAuthRedirectDebug({
      event: "redirect-start-error",
      mode: "sign-in",
      providerId,
      detail: `${code}: ${message}`,
    });
    throw buildProviderStartError(providerId, error);
  }
}

export async function linkCurrentUserWithAuthProvider(providerId: AuthProviderKey): Promise<User> {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const auth = await initializePersistentAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Sign in before linking another sign-in method.");
  }

  try {
    const result = await linkWithPopup(currentUser, getOAuthProvider(providerId));
    clearLocalAuthSession();
    return result.user;
  } catch (error) {
    throw buildProviderStartError(providerId, error);
  }
}

export async function startLinkCurrentUserWithAuthProviderRedirect(providerId: AuthProviderKey): Promise<void> {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const auth = await initializePersistentAuth();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Sign in before linking another sign-in method.");
  }

  await assertProviderRedirectConfig(providerId);
  stagePendingAuthRedirect("link", providerId);
  try {
    await linkWithRedirect(currentUser, getOAuthProvider(providerId));
    clearLocalAuthSession();
  } catch (error) {
    clearPendingAuthRedirect();
    const code = (error as { code?: string })?.code ?? "unknown";
    const message = error instanceof Error ? error.message : String(error);
    appendAuthRedirectDebug({
      event: "redirect-start-error",
      mode: "link",
      providerId,
      detail: `${code}: ${message}`,
    });
    throw buildProviderStartError(providerId, error);
  }
}

export async function resolvePendingAuthRedirectResult(): Promise<void> {
  if (redirectResolutionInFlight) {
    return redirectResolutionInFlight;
  }

  redirectResolutionInFlight = (async () => {
  const pending = readPendingAuthRedirect();
  if (!pending) {
    return;
  }

  appendAuthRedirectDebug({
    event: "redirect-resolve-start",
    mode: pending.mode,
    providerId: pending.providerId,
  });

  try {
    const auth = await initializePersistentAuth();
    let result: Awaited<ReturnType<typeof getRedirectResult>> | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      result = await getRedirectResult(auth);
      if (result?.user) {
        break;
      }

      if (attempt < 3) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 250 * (attempt + 1));
        });
      }
    }

    if (result?.user) {
      clearLocalAuthSession();
      appendAuthRedirectDebug({
        event: "redirect-resolve-success",
        mode: pending.mode,
        providerId: pending.providerId,
        detail: result.user.uid,
      });

      if (pending.mode === "link" && typeof window !== "undefined" && window.location.pathname === "/login") {
        window.history.replaceState(window.history.state, "", "/settings");
      }
      clearPendingAuthRedirect();
    } else {
      appendAuthRedirectDebug({
        event: "redirect-resolve-empty-after-retry",
        mode: pending.mode,
        providerId: pending.providerId,
      });

      if (pending.mode === "link" && typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.history.replaceState(window.history.state, "", "/login");
      }
    }
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "unknown";
    const message = error instanceof Error ? error.message : String(error);
    appendAuthRedirectDebug({
      event: "redirect-resolve-error",
      mode: pending.mode,
      providerId: pending.providerId,
      detail: `${code}: ${message}`,
    });
    clearPendingAuthRedirect();
  } finally {
    redirectResolutionInFlight = null;
  }
  })();

  return redirectResolutionInFlight;
}

async function getAuthInstance(): Promise<Auth> {
  if (cachedAuth) {
    return cachedAuth;
  }

  if (!isExtensionRuntime()) {
    cachedAuth = getAuth(firebaseApp);
    return cachedAuth;
  }

  try {
    const { browserPopupRedirectResolver } = await import("firebase/auth/web-extension");
    cachedAuth = initializeAuth(firebaseApp, {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
    return cachedAuth;
  } catch {
    cachedAuth = getAuth(firebaseApp);
    return cachedAuth;
  }
}

/**
 * Ensures browser-local persistence before the app starts listening to auth state.
 * This is what keeps users logged in across refreshes and browser restarts.
 */
async function ensureBrowserPersistence(auth: Auth): Promise<Auth> {
  if (!persistenceReady) {
    try {
      await Promise.race([
        setPersistence(auth, browserLocalPersistence),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Timed out while configuring auth persistence."));
          }, AUTH_PERSISTENCE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      // Fail-open: redirect auth can recover only if bootstrap continues past persistence setup.
      console.warn("[CourseForge auth] Browser persistence setup failed; continuing without blocking auth bootstrap.", error);
    } finally {
      persistenceReady = true;
    }
  }

  return auth;
}

function getAuthInstanceSync(): Auth | null {
  if (!cachedAuth && !isExtensionRuntime()) {
    cachedAuth = getAuth(firebaseApp);
  }

  return cachedAuth;
}

export async function initializePersistentAuth(): Promise<Auth> {
  const auth = await getAuthInstance();
  return ensureBrowserPersistence(auth);
}

export async function signInWithGoogle(): Promise<User> {
  return signInWithAuthProvider("google");
}

export async function signOutCurrentUser(): Promise<void> {
  const localSession = readLocalAuthSession();
  if (localSession) {
    clearLocalAuthSession();
  }

  const auth = await initializePersistentAuth();
  await signOut(auth);
}

export function getCurrentUser(): User | null {
  return getAuthInstanceSync()?.currentUser ?? null;
}

export function onAuthStateChangedListener(onChange: (user: User | null) => void): Unsubscribe {
  let disposed = false;
  let unsubscribe: Unsubscribe = () => {};

  void initializePersistentAuth()
    .then((auth) => {
      if (disposed) {
        return;
      }
      unsubscribe = onIdTokenChanged(auth, onChange);
      onChange(auth.currentUser);
    })
    .catch(() => {
      if (disposed) {
        return;
      }
      const fallbackAuth = getAuth(firebaseApp);
      unsubscribe = onIdTokenChanged(fallbackAuth, onChange);
      onChange(fallbackAuth.currentUser);
    });

  return () => {
    disposed = true;
    unsubscribe();
  };
}

export async function subscribeToAuthTokenChanges(
  onChange: (user: User | null) => void
): Promise<Unsubscribe> {
  const auth = await initializePersistentAuth();
  return onIdTokenChanged(auth, onChange);
}

export async function waitForAuthStateChange(timeoutMs = 12000): Promise<User | null> {
  const auth = await initializePersistentAuth();

  return new Promise<User | null>((resolve) => {
    let resolved = false;
    let unsubscribe: Unsubscribe = () => {};
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    unsubscribe = onIdTokenChanged(auth, (user) => {
      if (resolved) {
        return;
      }

      resolved = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(user);
    });

    timeoutId = setTimeout(() => {
      if (resolved) {
        return;
      }

      resolved = true;
      unsubscribe();
      resolve(auth.currentUser);
    }, timeoutMs);
  });
}

/**
 * Reads the `admin` custom claim from the current user's ID token.
 * Returns false if the user is not signed in or the claim is absent.
 * NOTE: Custom claims are set server-side via a Cloud Function or the Admin SDK.
 *       The `setAdmin.cjs` script in the project root can do this locally.
 */
export async function getAdminClaim(): Promise<boolean> {
  const auth = await initializePersistentAuth();
  const user = auth.currentUser;
  if (!user) return false;

  try {
    // Force-refresh so we always read the latest claims after a promotion.
    const tokenResult = await user.getIdTokenResult(/* forceRefresh */ true);
    return tokenResult.claims["admin"] === true;
  } catch {
    return false;
  }
}

export interface RoleClaims {
  isAdmin: boolean;
  isSchoolAdmin: boolean;
  isSuperAdmin: boolean;
  schoolId: string | null;
}

export async function getRoleClaims(): Promise<RoleClaims> {
  const auth = await initializePersistentAuth();
  const user = auth.currentUser;
  if (!user) {
    return {
      isAdmin: false,
      isSchoolAdmin: false,
      isSuperAdmin: false,
      schoolId: null,
    };
  }

  try {
    const tokenResult = await user.getIdTokenResult(true);
    const schoolIdClaim = tokenResult.claims["schoolId"];
    return {
      isAdmin: tokenResult.claims["admin"] === true,
      isSchoolAdmin: tokenResult.claims["schoolAdmin"] === true,
      isSuperAdmin: tokenResult.claims["superAdmin"] === true,
      schoolId: typeof schoolIdClaim === "string" && schoolIdClaim.trim() ? schoolIdClaim.trim() : null,
    };
  } catch {
    return {
      isAdmin: false,
      isSchoolAdmin: false,
      isSuperAdmin: false,
      schoolId: null,
    };
  }
}

/**
 * Convenience wrapper around getAdminClaim.
 */
export async function isAdminUser(): Promise<boolean> {
  return getAdminClaim();
}

export async function refreshCurrentUserClaims(): Promise<boolean> {
  return getAdminClaim();
}

/**
 * Upserts the user's profile document in the top-level `users` Firestore collection.
 * Called on every successful sign-in so the admin panel always has current user records.
 * The `isAdmin` field mirrors the custom claim but is NOT used for access control —
 * Firestore security rules and backend functions must enforce admin status via the token claim.
 */
export async function saveUserProfileToFirestore(user: User): Promise<void> {
  const userRef = doc(firestoreDb, "users", user.uid);

  let isAdmin = false;
  let isSchoolAdmin = false;
  let isSuperAdmin = false;
  let claimedSchoolId: string | null = null;
  let claimedDistrictId: string | null = null;
  try {
    const tokenResult = await user.getIdTokenResult();
    isAdmin = tokenResult.claims["admin"] === true;
    isSchoolAdmin = tokenResult.claims["schoolAdmin"] === true;
    isSuperAdmin = tokenResult.claims["superAdmin"] === true;
    const schoolIdClaim = tokenResult.claims["schoolId"];
    const districtIdClaim = tokenResult.claims["districtId"];
    claimedSchoolId = typeof schoolIdClaim === "string" && schoolIdClaim.trim() ? schoolIdClaim.trim() : null;
    claimedDistrictId = typeof districtIdClaim === "string" && districtIdClaim.trim() ? districtIdClaim.trim() : null;
  } catch {
    // Non-critical — proceed without claim info.
  }

  const payload = {
    uid: user.uid,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    isAdmin,
    isSchoolAdmin,
    isSuperAdmin,
    ...(claimedSchoolId ? { schoolId: claimedSchoolId } : {}),
    ...(claimedDistrictId ? { districtId: claimedDistrictId } : {}),
    preferences: {
      language: detectBrowserLanguageTag(),
      accessibility: {
        colorBlindMode: "none",
        dyslexiaMode: false,
        dyscalculiaMode: false,
        highContrastMode: false,
        fontScale: 1,
        uiScale: 1,
      },
    },
  };

  logAuthSyncEvent("write:start", `users/${user.uid}`, payload);
  try {
    await setDoc(
      userRef,
      {
        ...payload,
        lastLoginAt: serverTimestamp(),
      },
      { merge: true }
    );
    logAuthSyncEvent("write:success", `users/${user.uid}`, payload);
  } catch (error) {
    logAuthSyncEvent("write:error", `users/${user.uid}`, payload, error);
    throw error;
  }
}
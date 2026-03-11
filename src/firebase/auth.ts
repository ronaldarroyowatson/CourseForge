import {
  type Auth,
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  onIdTokenChanged,
  setPersistence,
  signOut,
  signInWithPopup,
  type Unsubscribe,
  type User,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { firebaseApp } from "./firebaseApp";
import { getFirebaseConfigError } from "./firebaseConfig";
import { firestoreDb } from "./firestore";

function logAuthSyncEvent(type: string, path: string, payload: unknown, error?: unknown): void {
  if (!import.meta.env.DEV) {
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

let cachedAuth: Auth | null = null;
let persistenceReady = false;

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
    await setPersistence(auth, browserLocalPersistence);
    persistenceReady = true;
  }

  return auth;
}

function getAuthInstanceSync(): Auth {
  if (!cachedAuth) {
    cachedAuth = getAuth(firebaseApp);
  }

  return cachedAuth;
}

const provider = new GoogleAuthProvider();

export async function initializePersistentAuth(): Promise<Auth> {
  const auth = await getAuthInstance();
  return ensureBrowserPersistence(auth);
}

export async function signInWithGoogle(): Promise<User> {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const auth = await initializePersistentAuth();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutCurrentUser(): Promise<void> {
  const auth = await initializePersistentAuth();
  await signOut(auth);
}

export function getCurrentUser(): User | null {
  return getAuthInstanceSync().currentUser;
}

export function onAuthStateChangedListener(onChange: (user: User | null) => void): Unsubscribe {
  return onIdTokenChanged(getAuthInstanceSync(), onChange);
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
  try {
    const tokenResult = await user.getIdTokenResult();
    isAdmin = tokenResult.claims["admin"] === true;
  } catch {
    // Non-critical — proceed without claim info.
  }

  const payload = {
    uid: user.uid,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    isAdmin,
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
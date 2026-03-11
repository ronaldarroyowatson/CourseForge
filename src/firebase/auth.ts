import {
  type Auth,
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  type Unsubscribe,
  type User,
} from "firebase/auth";
import { firebaseApp } from "./firebaseApp";
import { getFirebaseConfigError } from "./firebaseConfig";

function isExtensionRuntime(): boolean {
  const runtimeId = (globalThis as { chrome?: { runtime?: { id?: unknown } } }).chrome?.runtime?.id;
  return typeof runtimeId === "string";
}

let cachedAuth: Auth | null = null;

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

function getAuthInstanceSync(): Auth {
  if (!cachedAuth) {
    cachedAuth = getAuth(firebaseApp);
  }

  return cachedAuth;
}

const provider = new GoogleAuthProvider();

export async function signInWithGoogle(): Promise<User> {
  const configError = getFirebaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const auth = await getAuthInstance();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export function getCurrentUser(): User | null {
  return getAuthInstanceSync().currentUser;
}

export function onAuthStateChangedListener(onChange: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(getAuthInstanceSync(), onChange);
}
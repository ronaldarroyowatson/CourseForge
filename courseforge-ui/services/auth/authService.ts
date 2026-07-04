import { initializeApp, type FirebaseApp, getApps } from 'firebase/app';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  getAuth,
  signInWithEmailAndPassword,
  signInWithPopup,
  type UserCredential
} from 'firebase/auth';

export interface AuthIdentity {
  uid: string;
  email: string;
  displayName: string;
}

export interface AuthService {
  signInWithGoogle(): Promise<AuthIdentity>;
  signInWithEmail(): Promise<AuthIdentity>;
}

interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export class FirebaseAuthService implements AuthService {
  private readonly app: FirebaseApp;

  constructor() {
    this.app = getOrCreateFirebaseApp(loadFirebaseConfig());
  }

  async signInWithGoogle(): Promise<AuthIdentity> {
    const auth = getAuth(this.app);
    const provider = new GoogleAuthProvider();
    const credential = await signInWithPopup(auth, provider);
    return toIdentity(credential);
  }

  async signInWithEmail(): Promise<AuthIdentity> {
    const email = globalThis.prompt?.('Email');
    const password = globalThis.prompt?.('Password');

    if (!email || !password) {
      throw new Error('Email sign-in canceled.');
    }

    // Build a Firebase EmailAuthProvider credential to ensure email/password semantics.
    EmailAuthProvider.credential(email, password);

    const auth = getAuth(this.app);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return toIdentity(credential);
  }
}

function toIdentity(credential: UserCredential): AuthIdentity {
  const user = credential.user;

  if (!user.uid || !user.email) {
    throw new Error('Firebase Auth did not return a valid user identity.');
  }

  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName ?? user.email
  };
}

function loadFirebaseConfig(): FirebaseClientConfig {
  const env = getEnv();

  const apiKey = env.COURSEFORGE_FIREBASE_API_KEY;
  const authDomain = env.COURSEFORGE_FIREBASE_AUTH_DOMAIN;
  const projectId = env.COURSEFORGE_FIREBASE_PROJECT_ID;
  const appId = env.COURSEFORGE_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !appId) {
    throw new Error('Missing Firebase auth configuration for CourseForge Cloud.');
  }

  return {
    apiKey,
    authDomain,
    projectId,
    appId
  };
}

function getOrCreateFirebaseApp(config: FirebaseClientConfig): FirebaseApp {
  const [existing] = getApps();
  if (existing) {
    return existing;
  }

  return initializeApp(config);
}

function getEnv(): Record<string, string | undefined> {
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  const globalEnv = (globalThis as { COURSEFORGE_ENV?: Record<string, string | undefined> }).COURSEFORGE_ENV;

  return {
    ...globalEnv,
    ...processEnv
  };
}

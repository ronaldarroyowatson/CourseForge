import { initializeApp, type FirebaseApp, getApps } from 'firebase/app';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  getAuth,
  signInWithEmailAndPassword,
  signInWithPopup,
  type UserCredential
} from 'firebase/auth';
import { loadCourseForgeCloudConfig } from '../cloud-config.js';

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
  const config = loadCourseForgeCloudConfig().firebase;

  const apiKey = config.apiKey;
  const authDomain = config.authDomain;
  const projectId = config.projectId;
  const appId = config.appId;

  if (
    !apiKey ||
    !authDomain ||
    !projectId ||
    !appId ||
    apiKey.includes('REQUIRED') ||
    appId.includes('REQUIRED')
  ) {
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

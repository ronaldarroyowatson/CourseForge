import { create } from "zustand";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthSession {
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  isAdmin: boolean;
  isSchoolAdmin: boolean;
  isSuperAdmin: boolean;
  schoolId: string | null;
  schoolName: string | null;
  districtName: string | null;
}

interface AuthStore {
  authStatus: AuthStatus;
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  isAdmin: boolean;
  isSchoolAdmin: boolean;
  isSuperAdmin: boolean;
  schoolId: string | null;
  schoolName: string | null;
  districtName: string | null;
  authError: string | null;
  setLoading: () => void;
  setAuthenticated: (session: AuthSession) => void;
  setUnauthenticated: (error?: string | null) => void;
  setAdminFlag: (isAdmin: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  authStatus: "loading",
  userId: null,
  userEmail: null,
  userDisplayName: null,
  isAdmin: false,
  isSchoolAdmin: false,
  isSuperAdmin: false,
  schoolId: null,
  schoolName: null,
  districtName: null,
  authError: null,
  setLoading: () => set((state) => ({ authStatus: "loading", authError: state.authError })),
  setAuthenticated: (session) =>
    set({
      authStatus: "authenticated",
      userId: session.userId,
      userEmail: session.userEmail,
      userDisplayName: session.userDisplayName,
      isAdmin: session.isAdmin,
      isSchoolAdmin: session.isSchoolAdmin,
      isSuperAdmin: session.isSuperAdmin,
      schoolId: session.schoolId,
      schoolName: session.schoolName,
      districtName: session.districtName,
      authError: null,
    }),
  setUnauthenticated: (error = null) =>
    set({
      authStatus: "unauthenticated",
      userId: null,
      userEmail: null,
      userDisplayName: null,
      isAdmin: false,
      isSchoolAdmin: false,
      isSuperAdmin: false,
      schoolId: null,
      schoolName: null,
      districtName: null,
      authError: error,
    }),
  setAdminFlag: (isAdmin) => set({ isAdmin }),
}));

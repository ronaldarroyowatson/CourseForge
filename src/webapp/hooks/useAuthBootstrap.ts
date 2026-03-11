import React from "react";
import type { User, Unsubscribe } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { getPendingSyncDiagnostics, syncNow, syncUserData } from "../../core/services/syncService";
import {
  getAdminClaim,
  initializePersistentAuth,
  saveUserProfileToFirestore,
  subscribeToAuthTokenChanges,
} from "../../firebase/auth";
import { firestoreDb } from "../../firebase/firestore";
import { useAuthStore } from "../store/authStore";
import { useUIStore } from "../store/uiStore";

function getSyncMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to sync your data right now. Local data is still available.";
}

/**
 * Bootstraps Firebase Auth once for the web app.
 *
 * Persistent login behavior:
 * - Firebase stores the session in browser-local persistence.
 * - The token listener restores the user automatically after refresh/restart.
 * - Initial authenticated sessions trigger a local-first sync before the main UI continues.
 */
export function useAuthBootstrap(): void {
  React.useEffect(() => {
    let isActive = true;
    let unsubscribe: Unsubscribe | null = null;
    let lastSyncedUserId: string | null = null;

    useAuthStore.getState().setLoading();

    async function syncAuthenticatedUser(user: User): Promise<void> {
      try {
        const profileSnapshot = await getDoc(doc(firestoreDb, "users", user.uid));
        const theme = profileSnapshot.get("theme");
        if (theme === "dark" || theme === "light") {
          useUIStore.getState().setTheme(theme);
        }
      } catch {
        // Theme loading is non-blocking and should not break auth bootstrap.
      }

      try {
        await saveUserProfileToFirestore(user);
      } catch (error) {
        console.warn("saveUserProfileToFirestore failed (non-critical):", error);
      }

      if (lastSyncedUserId === user.uid) {
        return;
      }

      const uiStore = useUIStore.getState();
      uiStore.setSyncStatus("syncing", "Syncing your local and cloud data.");

      try {
        await syncUserData(user.uid);
        if (!isActive) {
          return;
        }
        lastSyncedUserId = user.uid;
        const pending = await getPendingSyncDiagnostics();
        uiStore.setPendingSyncCount(pending.pendingCount);
        uiStore.setRetryCount(0);
        uiStore.setLastSyncErrorCode(null);
        uiStore.setSyncStatus("synced", "Your data is synced.");
      } catch (error) {
        if (!isActive) {
          return;
        }
        uiStore.setSyncStatus("error", getSyncMessage(error));
      }
    }

    async function handleUser(user: User | null): Promise<void> {
      if (!isActive) {
        return;
      }

      if (!user) {
        lastSyncedUserId = null;
        useAuthStore.getState().setUnauthenticated();
        useUIStore.getState().clearSync();
        return;
      }

      let isAdmin = false;
      try {
        isAdmin = await getAdminClaim();
      } catch {
        isAdmin = false;
      }

      if (!isActive) {
        return;
      }

      useAuthStore.getState().setAuthenticated({
        userId: user.uid,
        userEmail: user.email ?? null,
        userDisplayName: user.displayName ?? null,
        isAdmin,
      });

      await syncAuthenticatedUser(user);

      // Refresh pending counters after token/bootstrap events.
      const quickSync = await syncNow();
      const ui = useUIStore.getState();
      ui.setPendingSyncCount(quickSync.pendingCount);
      ui.setWriteBudget(quickSync.writeCount, quickSync.writeBudgetLimit, quickSync.writeBudgetExceeded);
      ui.setRetryLimit(quickSync.retryLimit);
      ui.setLastSyncErrorCode(quickSync.errorCode);
    }

    void initializePersistentAuth()
      .then(() => subscribeToAuthTokenChanges((user) => {
        void handleUser(user);
      }))
      .then((nextUnsubscribe) => {
        unsubscribe = nextUnsubscribe;
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        const message = error instanceof Error
          ? error.message
          : "Unable to initialize authentication.";
        useAuthStore.getState().setUnauthenticated(message);
      });

    return () => {
      isActive = false;
      unsubscribe?.();
    };
  }, []);
}

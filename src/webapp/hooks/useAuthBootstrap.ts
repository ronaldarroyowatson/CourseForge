import React from "react";
import type { User, Unsubscribe } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { syncNow } from "../../core/services/syncService";
import {
  getAdminClaim,
  initializePersistentAuth,
  saveUserProfileToFirestore,
  subscribeToAuthTokenChanges,
} from "../../firebase/auth";
import { firestoreDb } from "../../firebase/firestore";
import { useAuthStore } from "../store/authStore";
import { useUIStore } from "../store/uiStore";

function toSupportedLanguage(value: string): "en" | "es" | "pt" | "zm" | "fr" | "de" {
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  switch (primary) {
    case "es":
    case "pt":
    case "zm":
    case "fr":
    case "de":
    case "en":
      return primary;
    default:
      return "en";
  }
}

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
    let bootstrapSyncAttemptedUserId: string | null = null;
    let bootstrapSyncInFlightUserId: string | null = null;
    let bootstrapSyncPromise: Promise<void> | null = null;
    let bootstrapAdminRetryUserId: string | null = null;

    useAuthStore.getState().setLoading();

    async function syncAuthenticatedUser(user: User, options?: { allowAdminRetry?: boolean }): Promise<void> {
      const uiState = useUIStore.getState();
      const shouldRetryAdminBootstrap =
        options?.allowAdminRetry === true &&
        bootstrapAdminRetryUserId !== user.uid &&
        uiState.lastSyncErrorCode === "permission-denied" &&
        uiState.permissionDeniedSyncBlocked;

      if (bootstrapSyncAttemptedUserId === user.uid) {
        if (shouldRetryAdminBootstrap) {
          bootstrapAdminRetryUserId = user.uid;
        } else {
          if (bootstrapSyncInFlightUserId === user.uid && bootstrapSyncPromise) {
            await bootstrapSyncPromise;
          }
          return;
        }
      }

      bootstrapSyncAttemptedUserId = user.uid;

      const runBootstrapSync = async (): Promise<void> => {
        // Theme lookup should never delay startup sync.
        void (async () => {
          try {
            const profileSnapshot = await getDoc(doc(firestoreDb, "users", user.uid));
            const theme = profileSnapshot.get("theme");
            const language = profileSnapshot.get("preferences.language") ?? profileSnapshot.get("language");
            const accessibility = profileSnapshot.get("preferences.accessibility") ?? profileSnapshot.get("accessibility");
            if (theme === "dark" || theme === "light") {
              useUIStore.getState().setTheme(theme);
            }
            if (typeof language === "string") {
              useUIStore.getState().setLanguage(toSupportedLanguage(language));
            }
            if (accessibility && typeof accessibility === "object") {
              useUIStore.getState().setAccessibility(accessibility as {
                colorBlindMode?: "protanopia" | "deuteranopia" | "tritanopia" | "none";
                dyslexiaMode?: boolean;
                dyscalculiaMode?: boolean;
                highContrastMode?: boolean;
                fontScale?: number;
                uiScale?: number;
              });
            }
          } catch {
            // Theme loading is non-blocking and should not break auth bootstrap.
          }
        })();

        try {
          await saveUserProfileToFirestore(user);
        } catch (error) {
          console.warn("saveUserProfileToFirestore failed (non-critical):", error);
        }

        const uiStore = useUIStore.getState();
        uiStore.setSyncStatus("syncing", "Syncing your local and cloud data.");

        try {
          const syncResult = await syncNow({
            getCurrentUserFn: () => user,
          });

          if (!isActive) {
            return;
          }

          uiStore.setPendingSyncCount(syncResult.pendingCount);
          uiStore.setWriteBudget(syncResult.writeCount, syncResult.writeBudgetLimit, syncResult.writeBudgetExceeded);
          uiStore.setReadBudget(syncResult.readCount, syncResult.readBudgetLimit, syncResult.readBudgetExceeded);
          uiStore.setRetryLimit(syncResult.retryLimit);

          if (syncResult.throttled) {
            const state = useUIStore.getState();
            if (state.lastSyncErrorCode === "permission-denied" || state.permissionDeniedSyncBlocked) {
              uiStore.setSyncStatus(
                "error",
                state.lastSyncError ?? state.syncMessage ?? "Signed in successfully, but cloud sync is blocked by Firestore rules (permission denied). Local data remains available."
              );
              return;
            }

            uiStore.setSyncStatus("idle", syncResult.message);
            return;
          }

          if (syncResult.success) {
            uiStore.setPermissionDeniedSyncBlocked(false);
            uiStore.setRetryCount(0);
            uiStore.setLastSyncErrorCode(null);
            uiStore.setSyncStatus("synced", "Your data is synced.");
            return;
          }

          if (syncResult.errorCode) {
            uiStore.setLastSyncErrorCode(syncResult.errorCode);
          }

          if (syncResult.permissionDenied) {
            uiStore.setPermissionDeniedSyncBlocked(true);
          }

          uiStore.setSyncStatus("error", syncResult.message);
        } catch (error) {
          if (!isActive) {
            return;
          }
          uiStore.setSyncStatus("error", getSyncMessage(error));
        }
      };

      bootstrapSyncInFlightUserId = user.uid;
      const pendingBootstrapSync = runBootstrapSync().finally(() => {
        if (bootstrapSyncPromise === pendingBootstrapSync) {
          bootstrapSyncPromise = null;
        }

        if (bootstrapSyncInFlightUserId === user.uid) {
          bootstrapSyncInFlightUserId = null;
        }
      });

      bootstrapSyncPromise = pendingBootstrapSync;
      await pendingBootstrapSync;
    }

    async function handleUser(user: User | null): Promise<void> {
      if (!isActive) {
        return;
      }

      if (!user) {
        bootstrapSyncAttemptedUserId = null;
        bootstrapSyncInFlightUserId = null;
        bootstrapSyncPromise = null;
        bootstrapAdminRetryUserId = null;
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

      if (isAdmin) {
        try {
          await user.getIdToken(true);
        } catch {
          // Claim refresh is best-effort; the sync path still reports real failures.
        }
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

      await syncAuthenticatedUser(user, { allowAdminRetry: isAdmin });
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

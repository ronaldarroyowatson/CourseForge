import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";

import type { CourseForgeEntityMap } from "../models";
import { getAll, save, STORE_NAMES } from "./db";
import { normalizeISBN } from "./isbnService";
import { firestoreDb } from "../../firebase/firestore";

type SyncStoreName = "textbooks" | "chapters" | "sections" | "vocabTerms";
type SyncEntity = CourseForgeEntityMap[SyncStoreName];

const SYNC_STORES: SyncStoreName[] = [
  STORE_NAMES.textbooks,
  STORE_NAMES.chapters,
  STORE_NAMES.sections,
  STORE_NAMES.vocabTerms,
];

function getSyncErrorMessage(error: unknown): string {
  const err = error as { code?: string; message?: string };
  const code = err.code ?? "";

  if (code === "permission-denied") {
    return "Signed in successfully, but cloud sync is blocked by Firestore rules (permission denied). Local data remains available.";
  }

  if (code === "unauthenticated") {
    return "Signed in successfully, but cloud sync could not verify your session yet. Please retry sync in a moment.";
  }

  if (code === "unavailable") {
    return "Signed in successfully, but cloud sync is temporarily unavailable. Local data remains available.";
  }

  if (typeof err.message === "string" && err.message.trim().length > 0) {
    return `Signed in successfully, but cloud sync failed: ${err.message}`;
  }

  return "Signed in successfully, but cloud sync failed. Your local data is still safe, and you can retry shortly.";
}

function toTimestamp(value?: string): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toIsoNow(): string {
  return new Date().toISOString();
}

function withSyncDefaults<T extends SyncEntity>(
  item: T,
  source: "local" | "cloud",
  fallbackPendingSync: boolean
): T {
  const fallbackTimestamp = "updatedAt" in item && typeof item.updatedAt === "string"
    ? item.updatedAt
    : toIsoNow();

  return {
    ...item,
    lastModified: item.lastModified ?? fallbackTimestamp,
    pendingSync: item.pendingSync ?? fallbackPendingSync,
    source: item.source ?? source,
  };
}

function userCollection(storeName: SyncStoreName, userId: string) {
  return collection(firestoreDb, "users", userId, storeName);
}

async function fetchCloudStore<T extends SyncStoreName>(
  storeName: T,
  userId: string
): Promise<Array<CourseForgeEntityMap[T]>> {
  const snapshot = await getDocs(userCollection(storeName, userId));

  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data() as CourseForgeEntityMap[T];
    const withId = { ...data, id: docSnapshot.id, userId } as CourseForgeEntityMap[T];
    return withSyncDefaults(withId, "cloud", false) as CourseForgeEntityMap[T];
  });
}

async function fetchLocalStore<T extends SyncStoreName>(
  storeName: T
): Promise<Array<CourseForgeEntityMap[T]>> {
  const rows = await getAll(storeName);
  return rows.map((row) => withSyncDefaults(row, "local", true) as CourseForgeEntityMap[T]);
}

async function saveLocalStoreItem<T extends SyncStoreName>(
  storeName: T,
  item: CourseForgeEntityMap[T]
): Promise<void> {
  await save(storeName, item);
}

async function saveCloudStoreItem<T extends SyncStoreName>(
  storeName: T,
  userId: string,
  item: CourseForgeEntityMap[T]
): Promise<void> {
  const cloudRecord = {
    ...item,
    userId,
    pendingSync: false,
    source: "cloud",
    lastModified: item.lastModified ?? toIsoNow(),
  };

  await setDoc(doc(firestoreDb, "users", userId, storeName, item.id), cloudRecord, { merge: true });
}

export async function uploadLocalChanges(userId: string): Promise<void> {
  if (!userId.trim()) {
    throw new Error("Sync could not start because no user is signed in.");
  }

  try {
    await Promise.all(
      SYNC_STORES.map(async (storeName) => {
        const localItems = await fetchLocalStore(storeName);
        const changedItems = localItems.filter((item) => {
          return item.pendingSync || !item.userId || item.userId === userId;
        });

        await Promise.all(
          changedItems.map(async (item) => {
            const synced = {
              ...item,
              userId,
              pendingSync: false,
              source: "cloud" as const,
              lastModified: item.lastModified ?? toIsoNow(),
            } as CourseForgeEntityMap[typeof storeName];

            await saveCloudStoreItem(storeName, userId, synced);
            await saveLocalStoreItem(storeName, synced);
          })
        );
      })
    );
  } catch (error) {
    console.error("uploadLocalChanges failed", error);
    throw new Error(getSyncErrorMessage(error));
  }
}

export async function downloadCloudData(userId: string): Promise<void> {
  if (!userId.trim()) {
    throw new Error("Cloud download could not start because no user is signed in.");
  }

  try {
    await Promise.all(
      SYNC_STORES.map(async (storeName) => {
        const cloudItems = await fetchCloudStore(storeName, userId);

        await Promise.all(
          cloudItems.map(async (item) => {
            const normalized = withSyncDefaults(
              {
                ...item,
                userId,
                pendingSync: false,
                source: "cloud",
              } as CourseForgeEntityMap[typeof storeName],
              "cloud",
              false
            ) as CourseForgeEntityMap[typeof storeName];

            await saveLocalStoreItem(storeName, normalized);
          })
        );
      })
    );
  } catch (error) {
    console.error("downloadCloudData failed", error);
    throw new Error(getSyncErrorMessage(error));
  }
}

export async function syncUserData(userId: string): Promise<void> {
  if (!userId.trim()) {
    throw new Error("Sync could not start because no user is signed in.");
  }

  try {
    await Promise.all(
      SYNC_STORES.map(async (storeName) => {
        const [localRows, cloudRows] = await Promise.all([
          fetchLocalStore(storeName),
          fetchCloudStore(storeName, userId),
        ]);

        const localById = new Map(localRows.map((item) => [item.id, item]));
        const cloudById = new Map(cloudRows.map((item) => [item.id, item]));
        const allIds = new Set([...localById.keys(), ...cloudById.keys()]);

        await Promise.all(
          [...allIds].map(async (id) => {
            const localItem = localById.get(id);
            const cloudItem = cloudById.get(id);

            if (localItem && cloudItem) {
              const localTs = toTimestamp(localItem.lastModified);
              const cloudTs = toTimestamp(cloudItem.lastModified);

              if (cloudTs > localTs) {
                const cloudWinner = withSyncDefaults(
                  {
                    ...cloudItem,
                    userId,
                    pendingSync: false,
                    source: "cloud",
                  } as CourseForgeEntityMap[typeof storeName],
                  "cloud",
                  false
                ) as CourseForgeEntityMap[typeof storeName];

                await saveLocalStoreItem(storeName, cloudWinner);
                return;
              }

              const localWinner = withSyncDefaults(
                {
                  ...localItem,
                  userId,
                  pendingSync: false,
                  source: "cloud",
                } as CourseForgeEntityMap[typeof storeName],
                "cloud",
                false
              ) as CourseForgeEntityMap[typeof storeName];

              await saveCloudStoreItem(storeName, userId, localWinner);
              await saveLocalStoreItem(storeName, localWinner);
              return;
            }

            if (localItem) {
              const localOnly = withSyncDefaults(
                {
                  ...localItem,
                  userId,
                  pendingSync: false,
                  source: "cloud",
                } as CourseForgeEntityMap[typeof storeName],
                "cloud",
                false
              ) as CourseForgeEntityMap[typeof storeName];

              await saveCloudStoreItem(storeName, userId, localOnly);
              await saveLocalStoreItem(storeName, localOnly);
              return;
            }

            if (cloudItem) {
              const cloudOnly = withSyncDefaults(
                {
                  ...cloudItem,
                  userId,
                  pendingSync: false,
                  source: "cloud",
                } as CourseForgeEntityMap[typeof storeName],
                "cloud",
                false
              ) as CourseForgeEntityMap[typeof storeName];

              await saveLocalStoreItem(storeName, cloudOnly);
            }
          })
        );
      })
    );
  } catch (error) {
    console.error("syncUserData failed", error);
    throw new Error(getSyncErrorMessage(error));
  }
}

export async function findCloudTextbookByISBN(userId: string, isbnInput: string) {
  const raw = isbnInput.trim();
  const normalized = normalizeISBN(raw);

  if (!userId.trim() || !raw) {
    return null;
  }

  const textbooksRef = userCollection(STORE_NAMES.textbooks, userId);

  const [rawMatches, normalizedMatches] = await Promise.all([
    getDocs(query(textbooksRef, where("isbnRaw", "==", raw))),
    normalized
      ? getDocs(query(textbooksRef, where("isbnNormalized", "==", normalized)))
      : Promise.resolve(null),
  ]);

  const candidates = [
    ...rawMatches.docs,
    ...(normalizedMatches ? normalizedMatches.docs : []),
  ];

  const first = candidates[0];
  if (!first) {
    return null;
  }

  const textbook = first.data() as CourseForgeEntityMap["textbooks"];
  return withSyncDefaults(
    {
      ...textbook,
      id: first.id,
      userId,
      pendingSync: false,
      source: "cloud",
    },
    "cloud",
    false
  ) as CourseForgeEntityMap["textbooks"];
}

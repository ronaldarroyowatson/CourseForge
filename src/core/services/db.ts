import { openDB } from "idb";
import type { DBSchema, IDBPDatabase, IDBPObjectStore, IDBPTransaction } from "idb";

import type { CourseForgeEntityMap } from "../models";

const DB_NAME = "courseforge";
const DB_VERSION = 5;

// Store names follow the domain entities in docs/DB_SCHEMA.md.
export const STORE_NAMES = {
  textbooks: "textbooks",
  chapters: "chapters",
  sections: "sections",
  vocabTerms: "vocabTerms",
  equations: "equations",
  concepts: "concepts",
  keyIdeas: "keyIdeas",
  translationMemory: "translationMemory",
  gameText: "gameText",
  glossaries: "glossaries",
  ingestFingerprints: "ingestFingerprints",
  extractedPresentations: "extractedPresentations",
} as const;

export type CourseForgeStoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

interface CourseForgeDBSchema extends DBSchema {
  textbooks: { key: string; value: CourseForgeEntityMap["textbooks"] };
  chapters: { key: string; value: CourseForgeEntityMap["chapters"] };
  sections: { key: string; value: CourseForgeEntityMap["sections"] };
  vocabTerms: { key: string; value: CourseForgeEntityMap["vocabTerms"] };
  equations: { key: string; value: CourseForgeEntityMap["equations"] };
  concepts: { key: string; value: CourseForgeEntityMap["concepts"] };
  keyIdeas: { key: string; value: CourseForgeEntityMap["keyIdeas"] };
  translationMemory: { key: string; value: CourseForgeEntityMap["translationMemory"] };
  gameText: { key: string; value: CourseForgeEntityMap["gameText"] };
  glossaries: { key: string; value: CourseForgeEntityMap["glossaries"] };
  ingestFingerprints: { key: string; value: CourseForgeEntityMap["ingestFingerprints"] };
  extractedPresentations: { key: string; value: CourseForgeEntityMap["extractedPresentations"] };
}

let dbPromise: Promise<IDBPDatabase<CourseForgeDBSchema>> | null = null;

/**
 * Initializes and returns the shared IndexedDB connection for CourseForge.
 */
export async function initDB(): Promise<IDBPDatabase<CourseForgeDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<CourseForgeDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const storeName of Object.values(STORE_NAMES)) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "id" });
          }
        }
      },
    });
  }

  return dbPromise;
}

/**
 * Returns an object store plus its transaction for call sites that need lower-level access.
 */
export async function getStore<
  T extends CourseForgeStoreName,
  M extends IDBTransactionMode = "readonly"
>(
  storeName: T,
  mode: M = "readonly" as M
): Promise<{
  store: IDBPObjectStore<CourseForgeDBSchema, [T], T, M>;
  tx: IDBPTransaction<CourseForgeDBSchema, [T], M>;
}> {
  const db = await initDB();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);

  return { store, tx };
}

/**
 * Inserts or updates a record in the given store.
 */
export async function save<T extends CourseForgeStoreName>(
  storeName: T,
  value: CourseForgeEntityMap[T]
): Promise<string> {
  const { store, tx } = await getStore(storeName, "readwrite");
  await store.put(value as CourseForgeDBSchema[T]["value"]);
  await tx.done;
  return value.id;
}

/**
 * Reads one record by id from the given store.
 */
export async function getById<T extends CourseForgeStoreName>(
  storeName: T,
  id: string
): Promise<CourseForgeEntityMap[T] | undefined> {
  const db = await initDB();
  const item = await db.get(storeName, id);
  return item as CourseForgeEntityMap[T] | undefined;
}

/**
 * Reads all records from the given store.
 */
export async function getAll<T extends CourseForgeStoreName>(
  storeName: T
): Promise<Array<CourseForgeEntityMap[T]>> {
  const db = await initDB();
  const items = await db.getAll(storeName);
  return items as Array<CourseForgeEntityMap[T]>;
}

async function deleteRecord<T extends CourseForgeStoreName>(
  storeName: T,
  id: string
): Promise<void> {
  const { store, tx } = await getStore(storeName, "readwrite");
  await store.delete(id);
  await tx.done;
}

// Exported alias keeps the API name aligned with the requested contract.
export { deleteRecord as delete };

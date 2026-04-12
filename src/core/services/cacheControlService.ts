import { appendDebugLogEntry, clearDebugLogEntries } from "./debugLogService";
import { clearPersistedAutoTextbookUpload, forceRemoveAutoTextbookUpload } from "./autoTextbookUploadService";
import { clearSyncRuntimeCaches } from "./syncService";
import {
  detectCourseForgeCacheState,
  recordCacheClearAction,
  recordCacheDetection,
  resetCacheTelemetryMap,
} from "./cacheTelemetryService";

const KNOWN_IDB_NAMES = ["courseforge", "courseforge-debug"];

export interface CacheClearSummary {
  localStorageKeysRemoved: string[];
  sessionStorageKeysRemoved: string[];
  indexedDbDeleted: string[];
  serviceWorkerCachesDeleted: string[];
}

async function deleteIndexedDb(name: string): Promise<boolean> {
  if (typeof indexedDB === "undefined" || !name) {
    return false;
  }

  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });
}

function clearStorageWithPrefix(storage: Storage | undefined, prefix: string): string[] {
  if (!storage) {
    return [];
  }

  const removed: string[] = [];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    try {
      storage.removeItem(key);
      removed.push(key);
    } catch {
      // Ignore inaccessible storage keys.
    }
  }

  return removed;
}

export async function clearAllCourseForgeCaches(reason = "manual"): Promise<CacheClearSummary> {
  resetCacheTelemetryMap();
  await detectCourseForgeCacheState("cache-control:pre-clear");

  if (typeof window !== "undefined") {
    try {
      await forceRemoveAutoTextbookUpload(`Cache clear requested (${reason}).`);
      recordCacheClearAction({
        layer: "cached-upload-state",
        identifier: "courseforge.autoTextbookUpload.v1",
        component: "cache-control",
        success: true,
        reason: "Forced removal of stuck upload state before global cache clear.",
      });
    } catch {
      clearPersistedAutoTextbookUpload();
      recordCacheClearAction({
        layer: "cached-upload-state",
        identifier: "courseforge.autoTextbookUpload.v1",
        component: "cache-control",
        success: false,
        reason: "Force remove failed; fallback to persisted upload clear.",
      });
    }
  }

  clearSyncRuntimeCaches();

  const localStorageKeysRemoved = typeof window !== "undefined"
    ? clearStorageWithPrefix(window.localStorage, "courseforge")
    : [];
  for (const key of localStorageKeysRemoved) {
    recordCacheClearAction({
      layer: "localStorage",
      identifier: key,
      component: "cache-control",
      success: true,
      reason: `Cache key removed during ${reason} clear.`,
    });
  }

  const sessionStorageKeysRemoved = typeof window !== "undefined"
    ? clearStorageWithPrefix(window.sessionStorage, "courseforge")
    : [];
  for (const key of sessionStorageKeysRemoved) {
    recordCacheClearAction({
      layer: "sessionStorage",
      identifier: key,
      component: "cache-control",
      success: true,
      reason: `Session cache key removed during ${reason} clear.`,
    });
  }

  const indexedDbDeleted: string[] = [];
  for (const name of KNOWN_IDB_NAMES) {
    const deleted = await deleteIndexedDb(name);
    if (deleted) {
      indexedDbDeleted.push(name);
    }

    recordCacheClearAction({
      layer: "indexedDB",
      identifier: name,
      component: "cache-control",
      success: deleted,
      reason: deleted
        ? `IndexedDB '${name}' deleted during ${reason} clear.`
        : `IndexedDB '${name}' could not be deleted (locked/corrupted/inaccessible).`,
    });
  }

  const serviceWorkerCachesDeleted: string[] = [];
  if (typeof caches !== "undefined") {
    try {
      const cacheKeys = await caches.keys();
      for (const key of cacheKeys) {
        if (!key.toLowerCase().includes("courseforge")) {
          continue;
        }

        const deleted = await caches.delete(key);
        if (deleted) {
          serviceWorkerCachesDeleted.push(key);
        }

        recordCacheClearAction({
          layer: "temporary-file",
          identifier: key,
          component: "cache-control",
          success: deleted,
          reason: deleted
            ? `Service worker cache '${key}' deleted during ${reason} clear.`
            : `Service worker cache '${key}' could not be deleted.`,
        });
      }
    } catch {
      // CacheStorage may be unavailable for this runtime.
      recordCacheClearAction({
        layer: "temporary-file",
        identifier: "CacheStorage",
        component: "cache-control",
        success: false,
        reason: "CacheStorage inaccessible during cache clear.",
      });
    }
  }

  await clearDebugLogEntries();
  await appendDebugLogEntry({
    eventType: "info",
    message: "CourseForge cache clear completed.",
    autoModeStep: "manual",
    context: {
      reason,
      localStorageKeysRemoved,
      sessionStorageKeysRemoved,
      indexedDbDeleted,
      serviceWorkerCachesDeleted,
    },
  });

  recordCacheDetection({
    layer: "memory",
    identifier: "cache-clear-summary",
    component: "cache-control",
    details: {
      reason,
      localStorageRemoved: localStorageKeysRemoved.length,
      sessionStorageRemoved: sessionStorageKeysRemoved.length,
      indexedDbDeleted: indexedDbDeleted.length,
      serviceWorkerCachesDeleted: serviceWorkerCachesDeleted.length,
    },
  });

  return {
    localStorageKeysRemoved,
    sessionStorageKeysRemoved,
    indexedDbDeleted,
    serviceWorkerCachesDeleted,
  };
}

export async function clearAllCourseForgeCachesOnDevStartup(): Promise<CacheClearSummary | null> {
  const isDevRuntime = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  if (!isDevRuntime) {
    return null;
  }

  return clearAllCourseForgeCaches("dev-startup");
}

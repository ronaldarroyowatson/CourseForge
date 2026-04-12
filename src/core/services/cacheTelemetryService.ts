export type CacheLayerType =
  | "localStorage"
  | "sessionStorage"
  | "indexedDB"
  | "memory"
  | "temporary-file"
  | "persisted-metadata"
  | "cached-ocr"
  | "cached-second-agent"
  | "cached-toc"
  | "cached-upload-state"
  | "ui-state"
  | "token-session";

export interface CacheTelemetryItem {
  id: string;
  layer: CacheLayerType;
  identifier: string;
  timestamp: string;
  status: "detected" | "used" | "ignored" | "cleared" | "failed-clear" | "stale" | "regenerated";
  component: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface CacheRegressionRecord {
  id: string;
  timestamp: string;
  cause: string;
  source: string;
  effect: string;
  staleIdentifier?: string;
  details?: Record<string, unknown>;
}

export interface CacheMap {
  detected: CacheTelemetryItem[];
  used: CacheTelemetryItem[];
  cleared: CacheTelemetryItem[];
  ignored: CacheTelemetryItem[];
  issues: CacheTelemetryItem[];
  staleOrMismatched: CacheTelemetryItem[];
  regenerated: CacheTelemetryItem[];
  regressions: CacheRegressionRecord[];
}

const EMPTY_CACHE_MAP: CacheMap = {
  detected: [],
  used: [],
  cleared: [],
  ignored: [],
  issues: [],
  staleOrMismatched: [],
  regenerated: [],
  regressions: [],
};

let activeCacheMap: CacheMap = { ...EMPTY_CACHE_MAP };

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneMap(map: CacheMap): CacheMap {
  return {
    detected: [...map.detected],
    used: [...map.used],
    cleared: [...map.cleared],
    ignored: [...map.ignored],
    issues: [...map.issues],
    staleOrMismatched: [...map.staleOrMismatched],
    regenerated: [...map.regenerated],
    regressions: [...map.regressions],
  };
}

export function resetCacheTelemetryMap(): void {
  activeCacheMap = cloneMap(EMPTY_CACHE_MAP);
}

export function getCurrentCacheMapSnapshot(): CacheMap {
  return cloneMap(activeCacheMap);
}

function record(item: CacheTelemetryItem): void {
  switch (item.status) {
    case "detected":
      activeCacheMap.detected.push(item);
      break;
    case "used":
      activeCacheMap.used.push(item);
      break;
    case "ignored":
      activeCacheMap.ignored.push(item);
      break;
    case "cleared":
      activeCacheMap.cleared.push(item);
      break;
    case "failed-clear":
      activeCacheMap.issues.push(item);
      break;
    case "stale":
      activeCacheMap.staleOrMismatched.push(item);
      break;
    case "regenerated":
      activeCacheMap.regenerated.push(item);
      break;
    default:
      break;
  }
}

export function recordCacheDetection(input: {
  layer: CacheLayerType;
  identifier: string;
  component: string;
  timestamp?: string;
  reason?: string;
  details?: Record<string, unknown>;
}): void {
  record({
    id: makeId("cache-detected"),
    layer: input.layer,
    identifier: input.identifier,
    timestamp: input.timestamp ?? new Date().toISOString(),
    status: "detected",
    component: input.component,
    reason: input.reason,
    details: input.details,
  });
}

export function recordCacheUsage(input: {
  layer: CacheLayerType;
  identifier: string;
  component: string;
  status: "used" | "ignored" | "stale" | "regenerated";
  reason: string;
  details?: Record<string, unknown>;
}): void {
  record({
    id: makeId("cache-usage"),
    layer: input.layer,
    identifier: input.identifier,
    timestamp: new Date().toISOString(),
    status: input.status,
    component: input.component,
    reason: input.reason,
    details: input.details,
  });
}

export function recordCacheClearAction(input: {
  layer: CacheLayerType;
  identifier: string;
  component: string;
  success: boolean;
  reason: string;
  details?: Record<string, unknown>;
}): void {
  record({
    id: makeId("cache-clear"),
    layer: input.layer,
    identifier: input.identifier,
    timestamp: new Date().toISOString(),
    status: input.success ? "cleared" : "failed-clear",
    component: input.component,
    reason: input.reason,
    details: input.details,
  });
}

export function recordCacheRegression(input: {
  cause: string;
  source: string;
  effect: string;
  staleIdentifier?: string;
  details?: Record<string, unknown>;
}): void {
  activeCacheMap.regressions.push({
    id: makeId("cache-regression"),
    timestamp: new Date().toISOString(),
    cause: input.cause,
    source: input.source,
    effect: input.effect,
    staleIdentifier: input.staleIdentifier,
    details: input.details,
  });
}

export async function detectCourseForgeCacheState(component: string): Promise<CacheTelemetryItem[]> {
  const detections: CacheTelemetryItem[] = [];

  if (typeof window !== "undefined") {
    const localKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith("courseforge")) {
        localKeys.push(key);
      }
    }

    for (const key of localKeys) {
      const item: CacheTelemetryItem = {
        id: makeId("cache-detect-local"),
        layer: "localStorage",
        identifier: key,
        timestamp: new Date().toISOString(),
        status: "detected",
        component,
        details: {
          source: "localStorage",
        },
      };
      detections.push(item);
      activeCacheMap.detected.push(item);
    }

    const sessionKeys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key && key.startsWith("courseforge")) {
        sessionKeys.push(key);
      }
    }

    for (const key of sessionKeys) {
      const item: CacheTelemetryItem = {
        id: makeId("cache-detect-session"),
        layer: "sessionStorage",
        identifier: key,
        timestamp: new Date().toISOString(),
        status: "detected",
        component,
        details: {
          source: "sessionStorage",
        },
      };
      detections.push(item);
      activeCacheMap.detected.push(item);
    }
  }

  if (typeof indexedDB !== "undefined") {
    try {
      const dbApi = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
      const dbs = typeof dbApi.databases === "function" ? await dbApi.databases() : [];
      for (const db of dbs) {
        const name = db?.name;
        if (!name || !name.toLowerCase().includes("courseforge")) {
          continue;
        }

        const item: CacheTelemetryItem = {
          id: makeId("cache-detect-idb"),
          layer: "indexedDB",
          identifier: name,
          timestamp: new Date().toISOString(),
          status: "detected",
          component,
        };
        detections.push(item);
        activeCacheMap.detected.push(item);
      }
    } catch {
      recordCacheClearAction({
        layer: "indexedDB",
        identifier: "indexedDB.databases",
        component,
        success: false,
        reason: "Unable to enumerate IndexedDB databases.",
      });
    }
  }

  return detections;
}

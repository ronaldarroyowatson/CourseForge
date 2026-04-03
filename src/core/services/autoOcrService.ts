import { httpsCallable } from "firebase/functions";

import { getCurrentUser, waitForAuthStateChange } from "../../firebase/auth";
import { functionsClient } from "../../firebase/functions";
import { appendDebugLogEntry } from "./debugLogService";

export type AutoOcrProviderId = 
  | "local_tesseract" 
  | "cloud_openai_vision"
  | "cloud_github_models_vision";

type CloudAutoOcrProviderId = Exclude<AutoOcrProviderId, "local_tesseract">;

export interface AutoOcrProvider {
  id: AutoOcrProviderId;
  label: string;
  isAvailable: () => Promise<boolean>;
  extractText: (imageDataUrl: string) => Promise<string>;
}

export interface AutoOcrAttemptResult {
  providerId: AutoOcrProviderId;
  success: boolean;
  errorMessage?: string;
  reasonCode?: string;
  failureStage?: string;
  traceId?: string;
}

export interface AutoOcrExtractionResult {
  text: string;
  providerId: AutoOcrProviderId;
  attempts: AutoOcrAttemptResult[];
}

export interface AutoOcrProviderPolicy {
  providerOrder: AutoOcrProviderId[];
  updatedBy?: string;
  updatedAt?: string;
}

type ProviderAvailabilityState = "available" | "unavailable" | "unknown";

export interface AutoOcrProviderHealthRecord {
  id: AutoOcrProviderId;
  label: string;
  available: boolean;
  availabilityState: ProviderAvailabilityState;
  errorMessage?: string;
  reasonCode?: string;
  httpStatus?: number | null;
  checkedAt?: string;
}

const AUTO_OCR_PROVIDER_ORDER_KEY = "courseforge.autoOcr.providerOrder";
const AUTO_OCR_CIRCUIT_STATE_KEY = "courseforge.autoOcr.circuitState";
const AUTO_OCR_USER_PREFERENCE_SET_KEY = "courseforge.autoOcr.userPreferenceSet";
const AUTO_OCR_AVAILABILITY_CACHE_TTL_MS = 3 * 60 * 1000;
const AUTO_OCR_RATE_LIMIT_CACHE_TTL_MS = 15 * 60 * 1000;

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

const CLOUD_PROVIDER_ORDER: CloudAutoOcrProviderId[] = ["cloud_openai_vision", "cloud_github_models_vision"];
const DEFAULT_PROVIDER_ORDER: AutoOcrProviderId[] = [...CLOUD_PROVIDER_ORDER, "local_tesseract"];

interface CircuitStateEntry {
  consecutiveFailures: number;
  openUntil: number;
  lastError?: string;
}

type CircuitState = Record<AutoOcrProviderId, CircuitStateEntry>;

interface CallableErrorDetails {
  providerId?: AutoOcrProviderId;
  reasonCode?: string;
  reasonMessage?: string;
  httpStatus?: number | null;
  traceId?: string;
  failureStage?: string;
}

interface CloudProviderAvailabilityCacheEntry {
  state: ProviderAvailabilityState;
  expiresAt: number;
  errorMessage?: string;
  reasonCode?: string;
  httpStatus?: number | null;
  checkedAt?: string;
}

let autoOcrAvailabilityCache: Partial<Record<CloudAutoOcrProviderId, CloudProviderAvailabilityCacheEntry>> | null = null;
let cloudAvailabilityProbeInFlight: Promise<Partial<Record<CloudAutoOcrProviderId, CloudProviderAvailabilityCacheEntry>>> | null = null;

function createOcrTraceId(prefix = "ocr"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function emitOcrDiagnostic(
  event: string,
  options: {
    level?: "info" | "warning" | "error";
    traceId?: string;
    context?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const level = options.level ?? "info";
  const traceId = options.traceId;
  const context = {
    ...(options.context ?? {}),
    traceId: traceId ?? null,
  };

  const eventType = level === "error"
    ? "error"
    : level === "warning"
      ? "warning"
      : "info";

  void appendDebugLogEntry({
    eventType,
    message: `OCR ${event}`,
    context,
  }, getCurrentUser()?.uid ?? null).catch(() => {
    // Best effort diagnostics.
  });

  if (typeof fetch === "function") {
    void fetch("/api/ocr-debug-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event,
        level,
        traceId: traceId ?? null,
        context,
      }),
    }).catch(() => {
      // Best effort diagnostics.
    });
  }
}

function normalizeCallableError(error: unknown): { code: string; message: string; details?: CallableErrorDetails } {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "unknown";
    const details = record.details;
    const structuredDetails = typeof details === "object" && details !== null
      ? details as CallableErrorDetails
      : undefined;
    const detailsMessage = typeof details === "string"
      ? details
      : (typeof details === "object" && details !== null)
        ? JSON.stringify(details)
        : "";
    const rawMessage = typeof record.message === "string" ? record.message : "Unknown callable error.";
    const message = detailsMessage ? `${rawMessage} (${detailsMessage})` : rawMessage;
    return { code, message, details: structuredDetails };
  }

  if (error instanceof Error) {
    return { code: "unknown", message: error.message };
  }

  return { code: "unknown", message: String(error) };
}

function isUnauthenticatedCallableError(error: { code: string; message: string }): boolean {
  const loweredCode = error.code.toLowerCase();
  const loweredMessage = error.message.toLowerCase();
  return loweredCode.includes("unauthenticated")
    || loweredMessage.includes("unauthenticated")
    || loweredMessage.includes("not authenticated");
}

async function callWithAuthRefreshRetry<TPayload extends object, TResponse>(
  callableName: string,
  payload: TPayload
): Promise<TResponse> {
  const callable = httpsCallable(functionsClient, callableName);

  try {
    return await callable(payload) as TResponse;
  } catch (error) {
    const normalized = normalizeCallableError(error);
    if (!isUnauthenticatedCallableError(normalized)) {
      throw error;
    }

    const user = getCurrentUser() ?? await waitForAuthStateChange(3000);
    if (!user) {
      throw error;
    }

    try {
      await user.getIdToken(true);
    } catch {
      // Best effort token refresh before retrying callable.
    }

    return await callable(payload) as TResponse;
  }
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while decoding OCR image."));
    }, 2000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    };

    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Unable to decode OCR image."));
    };
    image.src = dataUrl;
  });
}

async function preprocessImageForOcr(imageDataUrl: string): Promise<string> {
  if (typeof document === "undefined") {
    return imageDataUrl;
  }

  try {
    const image = await loadImageFromDataUrl(imageDataUrl);
    const maxDimension = 2200;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return imageDataUrl;
    }

    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];

      const gray = Math.round((red * 0.299) + (green * 0.587) + (blue * 0.114));
      const boosted = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
      const binary = boosted > 168 ? 255 : Math.round(boosted * 0.65);

      pixels[index] = binary;
      pixels[index + 1] = binary;
      pixels[index + 2] = binary;
    }

    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.95);
  } catch {
    return imageDataUrl;
  }
}

function postprocessOcrText(rawText: string): string {
  return rawText
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[•·]/g, ".")
    .replace(/\b(Module|Lesson|Chapter)\s+l\b/gi, "$1 1")
    .replace(/\b(\d+)\s*[,;:]\s*(\d+)\b/g, "$1$2")
    .replace(/[—–]{2,}/g, "-")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function isCloudProviderId(providerId: AutoOcrProviderId): providerId is CloudAutoOcrProviderId {
  return providerId === "cloud_openai_vision" || providerId === "cloud_github_models_vision";
}

function getProviderLabel(providerId: AutoOcrProviderId): string {
  switch (providerId) {
    case "cloud_openai_vision":
      return "Cloud OCR (OpenAI Vision via Firebase Function)";
    case "cloud_github_models_vision":
      return "Cloud OCR (GitHub Models Vision via Firebase Function)";
    default:
      return "Local OCR (Tesseract)";
  }
}

function normalizeExecutionProviderOrder(order: AutoOcrProviderId[]): AutoOcrProviderId[] {
  const cleaned = order.filter((providerId): providerId is AutoOcrProviderId => (
    providerId === "local_tesseract"
    || providerId === "cloud_openai_vision"
    || providerId === "cloud_github_models_vision"
  ));
  const deduped = [...new Set(cleaned)];
  return deduped.length ? deduped : [...DEFAULT_PROVIDER_ORDER];
}

function normalizeStoredProviderOrder(order: AutoOcrProviderId[]): AutoOcrProviderId[] {
  const explicit = normalizeExecutionProviderOrder(order);
  const selectedCloudProviders = explicit.filter(isCloudProviderId);
  if (!selectedCloudProviders.length) {
    return [...DEFAULT_PROVIDER_ORDER];
  }

  const normalized: AutoOcrProviderId[] = [...selectedCloudProviders];
  CLOUD_PROVIDER_ORDER.forEach((providerId) => {
    if (!normalized.includes(providerId)) {
      normalized.push(providerId);
    }
  });
  normalized.push("local_tesseract");
  return normalized;
}

function getCircuitState(): CircuitState {
  const storage = getStorage();
  if (!storage) {
    return {
      local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
      cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
      cloud_github_models_vision: { consecutiveFailures: 0, openUntil: 0 },
    };
  }

  const raw = storage.getItem(AUTO_OCR_CIRCUIT_STATE_KEY);
  if (!raw) {
    return {
      local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
      cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
      cloud_github_models_vision: { consecutiveFailures: 0, openUntil: 0 },
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CircuitState>;
    return {
      local_tesseract: {
        consecutiveFailures: Number(parsed.local_tesseract?.consecutiveFailures ?? 0),
        openUntil: Number(parsed.local_tesseract?.openUntil ?? 0),
        lastError: parsed.local_tesseract?.lastError,
      },
      cloud_openai_vision: {
        consecutiveFailures: Number(parsed.cloud_openai_vision?.consecutiveFailures ?? 0),
        openUntil: Number(parsed.cloud_openai_vision?.openUntil ?? 0),
        lastError: parsed.cloud_openai_vision?.lastError,
      },
      cloud_github_models_vision: {
        consecutiveFailures: Number(parsed.cloud_github_models_vision?.consecutiveFailures ?? 0),
        openUntil: Number(parsed.cloud_github_models_vision?.openUntil ?? 0),
        lastError: parsed.cloud_github_models_vision?.lastError,
      },
    };
  } catch {
    return {
      local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
      cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
      cloud_github_models_vision: { consecutiveFailures: 0, openUntil: 0 },
    };
  }
}

function saveCircuitState(state: CircuitState): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(AUTO_OCR_CIRCUIT_STATE_KEY, JSON.stringify(state));
}

function isCircuitOpen(providerId: AutoOcrProviderId): boolean {
  const state = getCircuitState()[providerId];
  return state.openUntil > Date.now();
}

function recordProviderSuccess(providerId: AutoOcrProviderId): void {
  const state = getCircuitState();
  state[providerId] = {
    consecutiveFailures: 0,
    openUntil: 0,
  };
  saveCircuitState(state);
}

function recordProviderFailure(providerId: AutoOcrProviderId, errorMessage: string): void {
  const state = getCircuitState();
  const previous = state[providerId];
  const nextFailures = previous.consecutiveFailures + 1;
  const shouldOpen = nextFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD;

  state[providerId] = {
    consecutiveFailures: shouldOpen ? 0 : nextFailures,
    openUntil: shouldOpen ? Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS : previous.openUntil,
    lastError: errorMessage,
  };
  saveCircuitState(state);
}

export function getAutoOcrProviderOrder(): AutoOcrProviderId[] {
  const storage = getStorage();
  if (!storage) {
    return [...DEFAULT_PROVIDER_ORDER];
  }

  const raw = storage.getItem(AUTO_OCR_PROVIDER_ORDER_KEY);
  if (!raw) {
    return [...DEFAULT_PROVIDER_ORDER];
  }

  try {
    const parsed = JSON.parse(raw) as AutoOcrProviderId[];
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_PROVIDER_ORDER];
    }

    return normalizeStoredProviderOrder(parsed);
  } catch {
    return [...DEFAULT_PROVIDER_ORDER];
  }
}

export function setAutoOcrProviderOrder(order: AutoOcrProviderId[]): AutoOcrProviderId[] {
  const normalized = normalizeStoredProviderOrder(order);
  const storage = getStorage();
  if (storage) {
    storage.setItem(AUTO_OCR_PROVIDER_ORDER_KEY, JSON.stringify(normalized));
    storage.setItem(AUTO_OCR_USER_PREFERENCE_SET_KEY, "true");
  }

  return normalized;
}

export function resetAutoOcrCircuitStateForTests(): void {
  saveCircuitState({
    local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
    cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
    cloud_github_models_vision: { consecutiveFailures: 0, openUntil: 0 },
  });
}

export function clearAutoOcrAvailabilityCache(): void {
  autoOcrAvailabilityCache = null;
}

export async function getCloudAutoOcrProviderPolicy(): Promise<AutoOcrProviderPolicy | null> {
  try {
    const callable = httpsCallable(functionsClient, "getAiProviderPolicy");
    const response = await callable({});
    const payload = response.data as {
      success?: boolean;
      data?: {
        providerOrder?: AutoOcrProviderId[];
        updatedBy?: string;
        updatedAt?: string;
      };
    };

    if (payload?.success !== true || !Array.isArray(payload.data?.providerOrder)) {
      return null;
    }

    return {
      providerOrder: normalizeStoredProviderOrder(payload.data.providerOrder),
      updatedBy: payload.data.updatedBy,
      updatedAt: payload.data.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function setCloudAutoOcrProviderPolicy(order: AutoOcrProviderId[]): Promise<AutoOcrProviderPolicy | null> {
  try {
    const callable = httpsCallable(functionsClient, "setAiProviderPolicy");
    const response = await callable({
      providerOrder: normalizeStoredProviderOrder(order),
    });
    const payload = response.data as {
      success?: boolean;
      data?: {
        providerOrder?: AutoOcrProviderId[];
        updatedBy?: string;
        updatedAt?: string;
      };
    };

    if (payload?.success !== true || !Array.isArray(payload.data?.providerOrder)) {
      return null;
    }

    return {
      providerOrder: normalizeStoredProviderOrder(payload.data.providerOrder),
      updatedBy: payload.data.updatedBy,
      updatedAt: payload.data.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function getEffectiveAutoOcrProviderOrder(): Promise<AutoOcrProviderId[]> {
  // User/local preference is always authoritative for execution order.
  // Cloud policy is only applied explicitly via the settings "Load Shared Policy" action.
  return getAutoOcrProviderOrder();
}

async function extractWithLocalTesseract(imageDataUrl: string): Promise<string> {
  const tesseract = await import("tesseract.js");
  const result = await tesseract.recognize(imageDataUrl, "eng");
  return result.data.text.trim();
}

function getCachedCloudAvailability(providerId: CloudAutoOcrProviderId): CloudProviderAvailabilityCacheEntry | null {
  return autoOcrAvailabilityCache?.[providerId] ?? null;
}

function setCachedCloudAvailability(providerId: CloudAutoOcrProviderId, entry: CloudProviderAvailabilityCacheEntry): void {
  autoOcrAvailabilityCache = {
    ...(autoOcrAvailabilityCache ?? {}),
    [providerId]: entry,
  };
}

function createUniformCloudCacheEntry(
  state: ProviderAvailabilityState,
  errorMessage: string,
  reasonCode?: string
): Partial<Record<CloudAutoOcrProviderId, CloudProviderAvailabilityCacheEntry>> {
  const expiresAt = Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS;
  return {
    cloud_openai_vision: { state, expiresAt, errorMessage, reasonCode },
    cloud_github_models_vision: { state, expiresAt, errorMessage, reasonCode },
  };
}

function normalizeProbeProviderIds(providerIds?: CloudAutoOcrProviderId[]): CloudAutoOcrProviderId[] {
  if (!providerIds?.length) {
    return [...CLOUD_PROVIDER_ORDER];
  }

  const deduped = [...new Set(providerIds.filter((providerId) => CLOUD_PROVIDER_ORDER.includes(providerId)))];
  return deduped.length ? deduped : [...CLOUD_PROVIDER_ORDER];
}

function resolveCloudAvailabilityState(reasonCode: string, available?: boolean, availabilityState?: ProviderAvailabilityState): ProviderAvailabilityState {
  const transientReasonCodes = new Set([
    "probe_timeout",
    "probe_network_error",
    "provider_unreachable",
    "probe_failed",
    "request_timeout",
    "request_failed",
    "provider_error",
  ]);

  if (available === true) {
    return "available";
  }

  if (availabilityState === "unknown" || transientReasonCodes.has(reasonCode)) {
    return "unknown";
  }

  return "unavailable";
}

async function refreshCloudAvailabilityCache(
  options: { forceRefresh?: boolean; providerIds?: CloudAutoOcrProviderId[] } = {}
): Promise<Partial<Record<CloudAutoOcrProviderId, CloudProviderAvailabilityCacheEntry>>> {
  const targetProviders = normalizeProbeProviderIds(options.providerIds);
  const now = Date.now();
  const hasWarmCache = !options.forceRefresh
    && autoOcrAvailabilityCache
    && targetProviders.some((providerId) => {
      const entry = autoOcrAvailabilityCache?.[providerId];
      return Boolean(entry && entry.expiresAt > now);
    })
    && targetProviders.every((providerId) => {
      const entry = autoOcrAvailabilityCache?.[providerId];
      return !entry || entry.expiresAt > now;
    });

  if (hasWarmCache) {
    return autoOcrAvailabilityCache ?? {};
  }

  if (cloudAvailabilityProbeInFlight) {
    return cloudAvailabilityProbeInFlight;
  }

  const traceId = createOcrTraceId("ocr-health");
  void emitOcrDiagnostic("health_probe_started", {
    traceId,
    context: { forceRefresh: Boolean(options.forceRefresh), providerIds: targetProviders },
  });

  cloudAvailabilityProbeInFlight = (async () => {
    const user = getCurrentUser() ?? await waitForAuthStateChange(2500);
    if (!user) {
      autoOcrAvailabilityCache = createUniformCloudCacheEntry("unavailable", "Sign in is required for Cloud OCR.", "no_user");
      void emitOcrDiagnostic("health_probe_no_user", {
        level: "warning",
        traceId,
        context: { availabilityState: "unavailable" },
      });
      return autoOcrAvailabilityCache;
    }

    try {
      const response = await callWithAuthRefreshRetry<{ providerIds?: CloudAutoOcrProviderId[] }, { data: unknown }>(
        "getAiProviderStatus",
        { providerIds: targetProviders }
      );
      const payload = response.data as {
        success?: boolean;
        data?: {
          providers?: Array<{
            id?: AutoOcrProviderId;
            available?: boolean;
            availabilityState?: ProviderAvailabilityState;
            reasonCode?: string;
            reasonMessage?: string;
            httpStatus?: number | null;
            checkedAt?: string;
          }>;
        };
      };

      if (payload?.success !== true || !Array.isArray(payload.data?.providers)) {
        autoOcrAvailabilityCache = createUniformCloudCacheEntry("unknown", "Cloud OCR status probe returned an invalid payload.", "invalid_payload");
        void emitOcrDiagnostic("health_probe_invalid_payload", {
          level: "warning",
          traceId,
          context: { availabilityState: "unknown" },
        });
        return autoOcrAvailabilityCache;
      }

      const nextCache: Partial<Record<CloudAutoOcrProviderId, CloudProviderAvailabilityCacheEntry>> = {
        ...(autoOcrAvailabilityCache ?? {}),
      };
      targetProviders.forEach((providerId) => {
        const provider = payload.data?.providers?.find((entry) => entry.id === providerId);
        const reasonCode = typeof provider?.reasonCode === "string" ? provider.reasonCode : "missing_provider_status";
        const reasonMessage = typeof provider?.reasonMessage === "string" ? provider.reasonMessage.trim() : "Cloud OCR status probe did not include provider availability.";
        const ttlMs = reasonCode === "rate_limited"
          ? AUTO_OCR_RATE_LIMIT_CACHE_TTL_MS
          : AUTO_OCR_AVAILABILITY_CACHE_TTL_MS;
        nextCache[providerId] = {
          state: resolveCloudAvailabilityState(reasonCode, provider?.available, provider?.availabilityState),
          expiresAt: Date.now() + ttlMs,
          errorMessage: reasonMessage || undefined,
          reasonCode,
          httpStatus: provider?.httpStatus ?? null,
          checkedAt: typeof provider?.checkedAt === "string" ? provider.checkedAt : undefined,
        };
      });

      autoOcrAvailabilityCache = nextCache;
      void emitOcrDiagnostic("health_probe_completed", {
        traceId,
        context: {
          providers: CLOUD_PROVIDER_ORDER.map((providerId) => ({
            providerId,
            availabilityState: nextCache[providerId]?.state ?? "unknown",
            reasonCode: nextCache[providerId]?.reasonCode ?? null,
            reasonMessage: nextCache[providerId]?.errorMessage ?? null,
            httpStatus: nextCache[providerId]?.httpStatus ?? null,
          })),
        },
      });
      return nextCache;
    } catch (error) {
      const normalized = normalizeCallableError(error);
      if (isUnauthenticatedCallableError(normalized)) {
        autoOcrAvailabilityCache = createUniformCloudCacheEntry("unavailable", "Sign in is required for Cloud OCR.", "unauthenticated");
        void emitOcrDiagnostic("health_probe_unauthenticated", {
          level: "warning",
          traceId,
          context: {
            availabilityState: "unavailable",
            errorCode: normalized.code,
            errorMessage: normalized.message,
          },
        });
        return autoOcrAvailabilityCache;
      }

      autoOcrAvailabilityCache = createUniformCloudCacheEntry("unknown", normalized.message, normalized.details?.reasonCode ?? normalized.code);
      void emitOcrDiagnostic("health_probe_failed", {
        level: "warning",
        traceId,
        context: {
          availabilityState: "unknown",
          errorCode: normalized.code,
          errorMessage: normalized.message,
        },
      });
      return autoOcrAvailabilityCache;
    }
  })();

  try {
    return await cloudAvailabilityProbeInFlight;
  } finally {
    cloudAvailabilityProbeInFlight = null;
  }
}

async function isCloudVisionConfigured(providerId: CloudAutoOcrProviderId): Promise<boolean> {
  const cacheEntry = getCachedCloudAvailability(providerId);
  const status = cacheEntry && cacheEntry.expiresAt > Date.now()
    ? cacheEntry.state
    : "unknown";
  return status !== "unavailable";
}

function updateCloudAvailabilityFromCallableError(providerId: CloudAutoOcrProviderId, error: { code: string; message: string; details?: CallableErrorDetails }): void {
  const reasonCode = error.details?.reasonCode ?? error.code;
  const errorMessage = error.details?.reasonMessage ?? error.message;
  const lowerReasonCode = reasonCode.toLowerCase();
  let state: ProviderAvailabilityState = "unknown";

  if (lowerReasonCode.includes("auth") || lowerReasonCode.includes("missing_")) {
    state = "unavailable";
  } else if (lowerReasonCode === "rate_limited") {
    state = "unavailable";
  }

  const ttlMs = lowerReasonCode === "rate_limited"
    ? AUTO_OCR_RATE_LIMIT_CACHE_TTL_MS
    : AUTO_OCR_AVAILABILITY_CACHE_TTL_MS;

  setCachedCloudAvailability(providerId, {
    state,
    expiresAt: Date.now() + ttlMs,
    errorMessage,
    reasonCode,
    httpStatus: error.details?.httpStatus ?? null,
  });
}

function formatCloudCallableError(providerId: CloudAutoOcrProviderId, traceId: string, error: { code: string; message: string; details?: CallableErrorDetails }): string {
  const providerLabel = getProviderLabel(providerId);
  const reasonCode = error.details?.reasonCode ? ` reason=${error.details.reasonCode}` : "";
  const failureStage = error.details?.failureStage ? ` stage=${error.details.failureStage}` : "";
  const resolvedTraceId = error.details?.traceId ?? traceId;
  const message = error.details?.reasonMessage ?? error.message;
  return `${providerLabel} failed [${resolvedTraceId}]${failureStage}${reasonCode}: ${message}`;
}

async function extractWithCloudVision(providerId: CloudAutoOcrProviderId, imageDataUrl: string): Promise<string> {
  const traceId = createOcrTraceId(`ocr-${providerId}`);
  void emitOcrDiagnostic("cloud_extract_started", {
    traceId,
    context: {
      providerId,
      imageBytes: imageDataUrl.length,
    },
  });

  let response;
  try {
    response = await callWithAuthRefreshRetry<
      { imageDataUrl: string; debugTraceId?: string; providerId?: CloudAutoOcrProviderId },
      { data: unknown }
    >("extractScreenshotText", { imageDataUrl, debugTraceId: traceId, providerId });
  } catch (error) {
    const normalized = normalizeCallableError(error);
    updateCloudAvailabilityFromCallableError(providerId, normalized);
    void emitOcrDiagnostic("cloud_extract_callable_failed", {
      level: "error",
      traceId,
      context: {
        providerId,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        reasonCode: normalized.details?.reasonCode ?? null,
        failureStage: normalized.details?.failureStage ?? null,
      },
    });
    throw new Error(formatCloudCallableError(providerId, traceId, normalized));
  }

  const payload = response.data as {
    success?: boolean;
    data?: {
      text?: string;
      providerId?: CloudAutoOcrProviderId;
      diagnostics?: { traceId?: string };
    };
    message?: string;
  };

  if (payload?.success !== true || !payload.data?.text) {
    const message = payload?.message ?? "Cloud OCR provider returned an invalid payload.";
    void emitOcrDiagnostic("cloud_extract_invalid_payload", {
      level: "error",
      traceId,
      context: {
        providerId,
        message,
        hasTextField: Boolean(payload?.data?.text),
      },
    });
    throw new Error(`${getProviderLabel(providerId)} failed [${traceId}] stage=response_validate: ${message}`);
  }

  setCachedCloudAvailability(providerId, {
    state: "available",
    expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
    checkedAt: new Date().toISOString(),
  });

  const text = payload.data.text.trim();
  void emitOcrDiagnostic("cloud_extract_completed", {
    traceId,
    context: {
      providerId,
      textLength: text.length,
    },
  });
  return text;
}

function buildUnavailableProviderMessage(providerId: AutoOcrProviderId): string {
  if (isCloudProviderId(providerId)) {
    const cached = getCachedCloudAvailability(providerId);
    if (cached?.errorMessage) {
      return `${getProviderLabel(providerId)} is unavailable: ${cached.errorMessage}`;
    }
  }

  return "Provider is not available in this environment.";
}

export function getAutoOcrProviders(): AutoOcrProvider[] {
  return [
    {
      id: "cloud_openai_vision",
      label: getProviderLabel("cloud_openai_vision"),
      isAvailable: async () => isCloudVisionConfigured("cloud_openai_vision"),
      extractText: async (imageDataUrl: string) => extractWithCloudVision("cloud_openai_vision", imageDataUrl),
    },
    {
      id: "cloud_github_models_vision",
      label: getProviderLabel("cloud_github_models_vision"),
      isAvailable: async () => isCloudVisionConfigured("cloud_github_models_vision"),
      extractText: async (imageDataUrl: string) => extractWithCloudVision("cloud_github_models_vision", imageDataUrl),
    },
    {
      id: "local_tesseract",
      label: getProviderLabel("local_tesseract"),
      isAvailable: async () => true,
      extractText: extractWithLocalTesseract,
    },
  ];
}

export async function getAutoOcrProviderHealth(options: { forceRefresh?: boolean } = {}): Promise<AutoOcrProviderHealthRecord[]> {
  const providers = getAutoOcrProviders();
  const cloudCache = await refreshCloudAvailabilityCache(options);

  return Promise.all(
    providers.map(async (provider) => {
      if (isCloudProviderId(provider.id)) {
        const cacheEntry = cloudCache[provider.id];
        return {
          id: provider.id,
          label: provider.label,
          available: cacheEntry?.state === "available",
          availabilityState: cacheEntry?.state ?? "unknown",
          errorMessage: cacheEntry?.errorMessage,
          reasonCode: cacheEntry?.reasonCode,
          httpStatus: cacheEntry?.httpStatus,
          checkedAt: cacheEntry?.checkedAt,
        };
      }

      try {
        const available = await provider.isAvailable();
        return {
          id: provider.id,
          label: provider.label,
          available,
          availabilityState: available ? "available" : "unavailable",
        };
      } catch {
        return {
          id: provider.id,
          label: provider.label,
          available: false,
          availabilityState: "unknown",
        };
      }
    })
  );
}

export async function extractTextFromImageWithFallback(
  imageDataUrl: string,
  options: {
    providerOrder?: AutoOcrProviderId[];
    providersOverride?: AutoOcrProvider[];
  } = {}
): Promise<AutoOcrExtractionResult> {
  const extractionTraceId = createOcrTraceId("ocr-fallback");
  let preprocessedImage: string | null = null;
  async function getLocalPreparedImage(): Promise<string> {
    if (preprocessedImage) {
      return preprocessedImage;
    }

    preprocessedImage = await Promise.race<string>([
      preprocessImageForOcr(imageDataUrl),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve(imageDataUrl), 1500);
      }),
    ]);
    return preprocessedImage;
  }
  const providerOrder = normalizeExecutionProviderOrder(options.providerOrder ?? await getEffectiveAutoOcrProviderOrder());
  const primaryCloudProviderId = providerOrder.find((providerId): providerId is CloudAutoOcrProviderId => isCloudProviderId(providerId)) ?? null;
  const providerMap = new Map((options.providersOverride ?? getAutoOcrProviders()).map((provider) => [provider.id, provider]));
  const attempts: AutoOcrAttemptResult[] = [];

  void emitOcrDiagnostic("fallback_started", {
    traceId: extractionTraceId,
    context: {
      requestedProviderOrder: providerOrder,
      imageBytes: imageDataUrl.length,
    },
  });

  for (const providerId of providerOrder) {
    if (isCircuitOpen(providerId)) {
      attempts.push({ providerId, success: false, errorMessage: "Circuit breaker open for provider cooldown window." });
      void emitOcrDiagnostic("provider_skipped_circuit_open", {
        level: "warning",
        traceId: extractionTraceId,
        context: { providerId },
      });
      continue;
    }

    const provider = providerMap.get(providerId);
    if (!provider) {
      attempts.push({ providerId, success: false, errorMessage: "Provider is not registered." });
      recordProviderFailure(providerId, "Provider is not registered.");
      void emitOcrDiagnostic("provider_missing", {
        level: "error",
        traceId: extractionTraceId,
        context: { providerId },
      });
      continue;
    }

    if (
      isCloudProviderId(providerId)
      && primaryCloudProviderId
      && providerId !== primaryCloudProviderId
      && attempts.some((attempt) => attempt.providerId === primaryCloudProviderId && !attempt.success)
    ) {
      await refreshCloudAvailabilityCache({ forceRefresh: true, providerIds: [providerId] });
    }

    let available = false;
    try {
      available = await provider.isAvailable();
    } catch {
      available = false;
    }

    if (!available) {
      const errorMessage = buildUnavailableProviderMessage(providerId);
      attempts.push({ providerId, success: false, errorMessage });
      recordProviderFailure(providerId, errorMessage);
      void emitOcrDiagnostic("provider_unavailable", {
        level: "warning",
        traceId: extractionTraceId,
        context: { providerId, errorMessage },
      });
      continue;
    }

    try {
      void emitOcrDiagnostic("provider_extract_started", {
        traceId: extractionTraceId,
        context: { providerId },
      });
      const providerImage = providerId === "local_tesseract"
        ? await getLocalPreparedImage()
        : imageDataUrl;

      let text = await provider.extractText(providerImage);
      if (providerId === "local_tesseract" && !text.trim() && providerImage !== imageDataUrl) {
        text = await provider.extractText(imageDataUrl);
      }

      const normalizedText = postprocessOcrText(text);
      if (!normalizedText.trim()) {
        attempts.push({ providerId, success: false, errorMessage: "OCR returned empty text." });
        recordProviderFailure(providerId, "OCR returned empty text.");
        void emitOcrDiagnostic("provider_extract_empty_text", {
          level: "warning",
          traceId: extractionTraceId,
          context: { providerId },
        });
        continue;
      }

      attempts.push({ providerId, success: true });
      recordProviderSuccess(providerId);
      void emitOcrDiagnostic("provider_extract_succeeded", {
        traceId: extractionTraceId,
        context: {
          providerId,
          imageBytesUsed: providerImage.length,
          textLength: normalizedText.length,
          attemptsCount: attempts.length,
        },
      });
      return {
        text: normalizedText,
        providerId,
        attempts,
      };
    } catch (error) {
      const normalized = error instanceof Error
        ? { message: error.message }
        : { message: "Unknown OCR error." };
      attempts.push({
        providerId,
        success: false,
        errorMessage: normalized.message,
      });
      recordProviderFailure(providerId, normalized.message);
      void emitOcrDiagnostic("provider_extract_failed", {
        level: "error",
        traceId: extractionTraceId,
        context: {
          providerId,
          errorMessage: normalized.message,
        },
      });
    }
  }

  const summary = attempts.map((attempt) => `${attempt.providerId}: ${attempt.errorMessage ?? "failed"}`).join("; ");
  void emitOcrDiagnostic("fallback_failed", {
    level: "error",
    traceId: extractionTraceId,
    context: {
      attempts,
      summary,
    },
  });
  throw new Error(`All OCR providers failed [${extractionTraceId}]. ${summary}`);
}

import { httpsCallable } from "firebase/functions";

import { getCurrentUser, waitForAuthStateChange } from "../../firebase/auth";
import { functionsClient } from "../../firebase/functions";
import { appendDebugLogEntry } from "./debugLogService";

export type AutoOcrProviderId = 
  | "local_tesseract" 
  | "cloud_openai_vision"
  | "cloud_azure_foundry_vision"
  | "cloud_github_models_vision";

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
}

const AUTO_OCR_PROVIDER_ORDER_KEY = "courseforge.autoOcr.providerOrder";
const AUTO_OCR_CIRCUIT_STATE_KEY = "courseforge.autoOcr.circuitState";
const AUTO_OCR_USER_PREFERENCE_SET_KEY = "courseforge.autoOcr.userPreferenceSet";
const AUTO_OCR_AVAILABILITY_CACHE_TTL_MS = 3 * 60 * 1000;

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

const DEFAULT_PROVIDER_ORDER: AutoOcrProviderId[] = ["cloud_openai_vision", "local_tesseract"];

interface CircuitStateEntry {
  consecutiveFailures: number;
  openUntil: number;
  lastError?: string;
}

type CircuitState = Record<AutoOcrProviderId, CircuitStateEntry>;

let autoOcrAvailabilityCache: {
  state: ProviderAvailabilityState;
  expiresAt: number;
  errorMessage?: string;
} | null = null;
let cloudAvailabilityProbeInFlight: Promise<ProviderAvailabilityState> | null = null;

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

function normalizeCallableError(error: unknown): { code: string; message: string } {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : "unknown";
    const details = record.details;
    const detailsMessage = typeof details === "string"
      ? details
      : (typeof details === "object" && details !== null)
        ? JSON.stringify(details)
        : "";
    const rawMessage = typeof record.message === "string" ? record.message : "Unknown callable error.";
    const message = detailsMessage ? `${rawMessage} (${detailsMessage})` : rawMessage;
    return { code, message };
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

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function normalizeProviderOrder(order: AutoOcrProviderId[]): AutoOcrProviderId[] {
  const cleaned = order.filter((providerId) => 
    providerId === "local_tesseract" 
    || providerId === "cloud_openai_vision"
    || providerId === "cloud_azure_foundry_vision"
    || providerId === "cloud_github_models_vision"
  );
  const deduped = [...new Set(cleaned)];

  DEFAULT_PROVIDER_ORDER.forEach((providerId) => {
    if (!deduped.includes(providerId)) {
      deduped.push(providerId);
    }
  });

  return deduped;
}

function getCircuitState(): CircuitState {
  const storage = getStorage();
  if (!storage) {
    return {
      local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
      cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
      cloud_azure_foundry_vision: { consecutiveFailures: 0, openUntil: 0 },
      cloud_github_models_vision: { consecutiveFailures: 0, openUntil: 0 },
    };
  }

  const raw = storage.getItem(AUTO_OCR_CIRCUIT_STATE_KEY);
  if (!raw) {
    return {
      local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
      cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
      cloud_azure_foundry_vision: { consecutiveFailures: 0, openUntil: 0 },
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
      cloud_azure_foundry_vision: {
        consecutiveFailures: Number(parsed.cloud_azure_foundry_vision?.consecutiveFailures ?? 0),
        openUntil: Number(parsed.cloud_azure_foundry_vision?.openUntil ?? 0),
        lastError: parsed.cloud_azure_foundry_vision?.lastError,
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
      cloud_azure_foundry_vision: { consecutiveFailures: 0, openUntil: 0 },
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

    return normalizeProviderOrder(parsed);
  } catch {
    return [...DEFAULT_PROVIDER_ORDER];
  }
}

export function setAutoOcrProviderOrder(order: AutoOcrProviderId[]): AutoOcrProviderId[] {
  const normalized = normalizeProviderOrder(order);
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
    cloud_azure_foundry_vision: { consecutiveFailures: 0, openUntil: 0 },
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
      providerOrder: normalizeProviderOrder(payload.data.providerOrder),
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
      providerOrder: normalizeProviderOrder(order),
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
      providerOrder: normalizeProviderOrder(payload.data.providerOrder),
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

async function isCloudVisionConfigured(): Promise<boolean> {
  const status = await getCloudAutoOcrAvailabilityState();
  return status !== "unavailable";
}

async function getCloudAutoOcrAvailabilityState(options: { forceRefresh?: boolean } = {}): Promise<ProviderAvailabilityState> {
  if (!options.forceRefresh && autoOcrAvailabilityCache && autoOcrAvailabilityCache.expiresAt > Date.now()) {
    return autoOcrAvailabilityCache.state;
  }

  if (cloudAvailabilityProbeInFlight) {
    return cloudAvailabilityProbeInFlight;
  }

  const traceId = createOcrTraceId("ocr-health");
  void emitOcrDiagnostic("health_probe_started", {
    traceId,
    context: { forceRefresh: Boolean(options.forceRefresh) },
  });

  cloudAvailabilityProbeInFlight = (async () => {
    const user = getCurrentUser() ?? await waitForAuthStateChange(2500);
    if (!user) {
      autoOcrAvailabilityCache = {
        state: "unavailable",
        expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
        errorMessage: "Sign in is required for Cloud OCR.",
      };
      void emitOcrDiagnostic("health_probe_no_user", {
        level: "warning",
        traceId,
        context: { availabilityState: "unavailable" },
      });
      return "unavailable";
    }

    try {
      const response = await callWithAuthRefreshRetry<{}, { data: unknown }>("getAiProviderStatus", {});
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
          }>;
        };
      };

      if (payload?.success !== true || !Array.isArray(payload.data?.providers)) {
        autoOcrAvailabilityCache = {
          state: "unknown",
          expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
          errorMessage: "Cloud OCR status probe returned an invalid payload.",
        };
        void emitOcrDiagnostic("health_probe_invalid_payload", {
          level: "warning",
          traceId,
          context: { availabilityState: "unknown" },
        });
        return "unknown";
      }

      const cloudProvider = payload.data.providers.find((provider) => provider.id === "cloud_openai_vision");
      if (!cloudProvider || typeof cloudProvider.available !== "boolean") {
        autoOcrAvailabilityCache = {
          state: "unknown",
          expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
          errorMessage: "Cloud OCR status probe did not include provider availability.",
        };
        void emitOcrDiagnostic("health_probe_missing_cloud_provider", {
          level: "warning",
          traceId,
          context: { availabilityState: "unknown" },
        });
        return "unknown";
      }

      const reasonCode = typeof cloudProvider.reasonCode === "string" ? cloudProvider.reasonCode : "";
      const reasonMessage = typeof cloudProvider.reasonMessage === "string" ? cloudProvider.reasonMessage.trim() : "";
      const availabilityState = cloudProvider.availabilityState;
      const transientReasonCodes = new Set([
        "probe_timeout",
        "probe_network_error",
        "provider_unreachable",
        "probe_failed",
      ]);

      let resolvedState: ProviderAvailabilityState;
      if (cloudProvider.available) {
        resolvedState = "available";
      } else if (availabilityState === "unknown" || transientReasonCodes.has(reasonCode)) {
        resolvedState = "unknown";
      } else {
        resolvedState = "unavailable";
      }

      autoOcrAvailabilityCache = {
        state: resolvedState,
        expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
        errorMessage: reasonMessage || undefined,
      };
      void emitOcrDiagnostic("health_probe_completed", {
        traceId,
        context: {
          availabilityState: resolvedState,
          reasonCode: reasonCode || null,
          reasonMessage: reasonMessage || null,
          httpStatus: cloudProvider.httpStatus ?? null,
        },
      });
      return resolvedState;
    } catch (error) {
      const normalized = normalizeCallableError(error);
      if (isUnauthenticatedCallableError(normalized)) {
        autoOcrAvailabilityCache = {
          state: "unavailable",
          expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
          errorMessage: "Sign in is required for Cloud OCR.",
        };
        void emitOcrDiagnostic("health_probe_unauthenticated", {
          level: "warning",
          traceId,
          context: {
            availabilityState: "unavailable",
            errorCode: normalized.code,
            errorMessage: normalized.message,
          },
        });
        return "unavailable";
      }

      autoOcrAvailabilityCache = {
        state: "unknown",
        expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
        errorMessage: normalized.message,
      };
      void emitOcrDiagnostic("health_probe_failed", {
        level: "warning",
        traceId,
        context: {
          availabilityState: "unknown",
          errorCode: normalized.code,
          errorMessage: normalized.message,
        },
      });
      return "unknown";
    }
  })();

  try {
    return await cloudAvailabilityProbeInFlight;
  } finally {
    cloudAvailabilityProbeInFlight = null;
  }
}

async function extractWithCloudOpenAiVision(imageDataUrl: string): Promise<string> {
  const traceId = createOcrTraceId("ocr-cloud");
  void emitOcrDiagnostic("cloud_extract_started", {
    traceId,
    context: {
      imageBytes: imageDataUrl.length,
    },
  });

  let response;
  try {
    response = await callWithAuthRefreshRetry<{ imageDataUrl: string; debugTraceId?: string }, { data: unknown }>(
      "extractScreenshotText",
      { imageDataUrl, debugTraceId: traceId }
    );
  } catch (error) {
    const normalized = normalizeCallableError(error);
    const loweredMessage = normalized.message.toLowerCase();
    const authenticationFailure = loweredMessage.includes("401")
      || loweredMessage.includes("unauthorized")
      || loweredMessage.includes("invalid api key")
      || loweredMessage.includes("invalid_api_key")
      || loweredMessage.includes("incorrect api key")
      || loweredMessage.includes("authentication");

    if (authenticationFailure) {
      autoOcrAvailabilityCache = {
        state: "unavailable",
        expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
        errorMessage: "Cloud OCR authentication failed. Check backend OpenAI credentials.",
      };
      void emitOcrDiagnostic("cloud_extract_authentication_failed", {
        level: "warning",
        traceId,
        context: {
          errorCode: normalized.code,
          errorMessage: normalized.message,
          availabilityState: "unavailable",
        },
      });
    }

    void emitOcrDiagnostic("cloud_extract_callable_failed", {
      level: "error",
      traceId,
      context: {
        errorCode: normalized.code,
        errorMessage: normalized.message,
      },
    });
    throw new Error(`Cloud OCR callable failed [${traceId}] ${normalized.code}: ${normalized.message}`);
  }

  const payload = response.data as {
    success?: boolean;
    data?: { text?: string };
    message?: string;
  };

  if (payload?.success !== true || !payload.data?.text) {
    const message = payload?.message ?? "Cloud OCR provider returned an invalid payload.";
    void emitOcrDiagnostic("cloud_extract_invalid_payload", {
      level: "error",
      traceId,
      context: {
        message,
        hasTextField: Boolean(payload?.data?.text),
      },
    });
    throw new Error(`${message} [${traceId}]`);
  }

  const text = payload.data.text.trim();
  void emitOcrDiagnostic("cloud_extract_completed", {
    traceId,
    context: {
      textLength: text.length,
    },
  });
  return text;
}

export function getAutoOcrProviders(): AutoOcrProvider[] {
  return [
    {
      id: "local_tesseract",
      label: "Local OCR (Tesseract)",
      isAvailable: async () => true,
      extractText: extractWithLocalTesseract,
    },
    {
      id: "cloud_openai_vision",
      label: "Cloud OCR (OpenAI Vision via Firebase Function)",
      isAvailable: isCloudVisionConfigured,
      extractText: extractWithCloudOpenAiVision,
    },
  ];
}

export async function getAutoOcrProviderHealth(options: { forceRefresh?: boolean } = {}): Promise<AutoOcrProviderHealthRecord[]> {
  const providers = getAutoOcrProviders();
  return Promise.all(
    providers.map(async (provider) => {
      if (provider.id === "cloud_openai_vision") {
        const availabilityState = await getCloudAutoOcrAvailabilityState(options);
        return {
          id: provider.id,
          label: provider.label,
          available: availabilityState === "available",
          availabilityState,
          errorMessage: autoOcrAvailabilityCache?.errorMessage,
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
  const preprocessedImage = await Promise.race<string>([
    preprocessImageForOcr(imageDataUrl),
    new Promise<string>((resolve) => {
      setTimeout(() => resolve(imageDataUrl), 1500);
    }),
  ]);
  const providerOrder = normalizeProviderOrder(options.providerOrder ?? await getEffectiveAutoOcrProviderOrder());
  const providerMap = new Map((options.providersOverride ?? getAutoOcrProviders()).map((provider) => [provider.id, provider]));
  const attempts: AutoOcrAttemptResult[] = [];

  void emitOcrDiagnostic("fallback_started", {
    traceId: extractionTraceId,
    context: {
      requestedProviderOrder: providerOrder,
      imageBytes: imageDataUrl.length,
      preprocessedImageBytes: preprocessedImage.length,
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

    let available = false;
    try {
      available = await provider.isAvailable();
    } catch {
      available = false;
    }

    if (!available) {
      attempts.push({ providerId, success: false, errorMessage: "Provider is not available in this environment." });
      recordProviderFailure(providerId, "Provider is not available in this environment.");
      void emitOcrDiagnostic("provider_unavailable", {
        level: "warning",
        traceId: extractionTraceId,
        context: { providerId },
      });
      continue;
    }

    try {
      void emitOcrDiagnostic("provider_extract_started", {
        traceId: extractionTraceId,
        context: { providerId },
      });
      const text = await provider.extractText(preprocessedImage);
      if (!text.trim()) {
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
          textLength: text.length,
          attemptsCount: attempts.length,
        },
      });
      return {
        text,
        providerId,
        attempts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown OCR error.";
      attempts.push({
        providerId,
        success: false,
        errorMessage: message,
      });
      recordProviderFailure(providerId, message);
      void emitOcrDiagnostic("provider_extract_failed", {
        level: "error",
        traceId: extractionTraceId,
        context: {
          providerId,
          errorMessage: message,
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

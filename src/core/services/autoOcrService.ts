import { httpsCallable } from "firebase/functions";

import { functionsClient } from "../../firebase/functions";

export type AutoOcrProviderId = "local_tesseract" | "cloud_openai_vision";

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

const AUTO_OCR_PROVIDER_ORDER_KEY = "courseforge.autoOcr.providerOrder";
const AUTO_OCR_CIRCUIT_STATE_KEY = "courseforge.autoOcr.circuitState";
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

let autoOcrAvailabilityCache: { state: ProviderAvailabilityState; expiresAt: number } | null = null;

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
  const cleaned = order.filter((providerId) => providerId === "local_tesseract" || providerId === "cloud_openai_vision");
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
    };
  }

  const raw = storage.getItem(AUTO_OCR_CIRCUIT_STATE_KEY);
  if (!raw) {
    return {
      local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
      cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
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
    };
  } catch {
    return {
      local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
      cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
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
  }

  return normalized;
}

export function resetAutoOcrCircuitStateForTests(): void {
  saveCircuitState({
    local_tesseract: { consecutiveFailures: 0, openUntil: 0 },
    cloud_openai_vision: { consecutiveFailures: 0, openUntil: 0 },
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
  const cloudPolicy = await getCloudAutoOcrProviderPolicy();
  if (cloudPolicy?.providerOrder?.length) {
    return normalizeProviderOrder(cloudPolicy.providerOrder);
  }

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

async function getCloudAutoOcrAvailabilityState(): Promise<ProviderAvailabilityState> {
  if (autoOcrAvailabilityCache && autoOcrAvailabilityCache.expiresAt > Date.now()) {
    return autoOcrAvailabilityCache.state;
  }

  try {
    const callable = httpsCallable(functionsClient, "getAiProviderStatus");
    const response = await callable({});
    const payload = response.data as {
      success?: boolean;
      data?: {
        providers?: Array<{
          id?: AutoOcrProviderId;
          available?: boolean;
        }>;
      };
    };

    if (payload?.success !== true || !Array.isArray(payload.data?.providers)) {
      autoOcrAvailabilityCache = {
        state: "unknown",
        expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
      };
      return "unknown";
    }

    const cloudProvider = payload.data.providers.find((provider) => provider.id === "cloud_openai_vision");
    if (!cloudProvider || typeof cloudProvider.available !== "boolean") {
      autoOcrAvailabilityCache = {
        state: "unknown",
        expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
      };
      return "unknown";
    }

    const resolvedState: ProviderAvailabilityState = cloudProvider.available ? "available" : "unavailable";
    autoOcrAvailabilityCache = {
      state: resolvedState,
      expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
    };
    return resolvedState;
  } catch {
    autoOcrAvailabilityCache = {
      state: "unknown",
      expiresAt: Date.now() + AUTO_OCR_AVAILABILITY_CACHE_TTL_MS,
    };
    return "unknown";
  }
}

async function extractWithCloudOpenAiVision(imageDataUrl: string): Promise<string> {
  const callable = httpsCallable(functionsClient, "extractScreenshotText");
  const response = await callable({ imageDataUrl });
  const payload = response.data as {
    success?: boolean;
    data?: { text?: string };
    message?: string;
  };

  if (payload?.success !== true || !payload.data?.text) {
    throw new Error(payload?.message ?? "Cloud OCR provider returned an invalid payload.");
  }

  return payload.data.text.trim();
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

export async function getAutoOcrProviderHealth(): Promise<Array<{ id: AutoOcrProviderId; label: string; available: boolean }>> {
  const providers = getAutoOcrProviders();
  return Promise.all(
    providers.map(async (provider) => {
      if (provider.id === "cloud_openai_vision") {
        const availabilityState = await getCloudAutoOcrAvailabilityState();
        return {
          id: provider.id,
          label: provider.label,
          available: availabilityState === "available",
        };
      }

      try {
        const available = await provider.isAvailable();
        return {
          id: provider.id,
          label: provider.label,
          available,
        };
      } catch {
        return {
          id: provider.id,
          label: provider.label,
          available: false,
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
  const preprocessedImage = await Promise.race<string>([
    preprocessImageForOcr(imageDataUrl),
    new Promise<string>((resolve) => {
      setTimeout(() => resolve(imageDataUrl), 1500);
    }),
  ]);
  const providerOrder = normalizeProviderOrder(options.providerOrder ?? await getEffectiveAutoOcrProviderOrder());
  const providerMap = new Map((options.providersOverride ?? getAutoOcrProviders()).map((provider) => [provider.id, provider]));
  const attempts: AutoOcrAttemptResult[] = [];

  for (const providerId of providerOrder) {
    if (isCircuitOpen(providerId)) {
      attempts.push({ providerId, success: false, errorMessage: "Circuit breaker open for provider cooldown window." });
      continue;
    }

    const provider = providerMap.get(providerId);
    if (!provider) {
      attempts.push({ providerId, success: false, errorMessage: "Provider is not registered." });
      recordProviderFailure(providerId, "Provider is not registered.");
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
      continue;
    }

    try {
      const text = await provider.extractText(preprocessedImage);
      if (!text.trim()) {
        attempts.push({ providerId, success: false, errorMessage: "OCR returned empty text." });
        recordProviderFailure(providerId, "OCR returned empty text.");
        continue;
      }

      attempts.push({ providerId, success: true });
      recordProviderSuccess(providerId);
      return {
        text,
        providerId,
        attempts,
      };
    } catch (error) {
      attempts.push({
        providerId,
        success: false,
        errorMessage: error instanceof Error ? error.message : "Unknown OCR error.",
      });
      recordProviderFailure(providerId, error instanceof Error ? error.message : "Unknown OCR error.");
    }
  }

  const summary = attempts.map((attempt) => `${attempt.providerId}: ${attempt.errorMessage ?? "failed"}`).join("; ");
  throw new Error(`All OCR providers failed. ${summary}`);
}

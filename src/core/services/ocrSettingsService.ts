export type OcrProviderId = "cloud_openai_vision" | "cloud_github_models_vision" | "local_tesseract";

export type OcrCropStrategy = "color" | "bw" | "both";
export type OcrFallbackBehavior = "wait" | "backup" | "tesseract-last";
export type OcrDebugLevel = "off" | "errors" | "verbose" | "trace";

export interface OcrSettings {
  autoRetriesEnabled: boolean;
  maxRetryAttempts: number;
  shots: 1 | 2 | 3;
  cropStrategy: OcrCropStrategy;
  dynamicRateLimitAdaptation: boolean;
  dynamicLimitBufferSeconds: number;
  primaryProvider: Exclude<OcrProviderId, "local_tesseract">;
  fallbackBehavior: OcrFallbackBehavior;
  debugLevel: OcrDebugLevel;
}

export interface OcrSettingsUpdateInput {
  autoRetriesEnabled?: boolean;
  maxRetryAttempts?: number;
  shots?: number;
  cropStrategy?: OcrCropStrategy;
  dynamicRateLimitAdaptation?: boolean;
  dynamicLimitBufferSeconds?: number;
  primaryProvider?: Exclude<OcrProviderId, "local_tesseract">;
  fallbackBehavior?: OcrFallbackBehavior;
  debugLevel?: OcrDebugLevel;
}

type OcrSettingsValidationInput = Partial<OcrSettings> | OcrSettingsUpdateInput;

export interface OcrRuntimeOptions {
  providerOrder: OcrProviderId[];
  preferPrimaryCloudWait: boolean;
  waitForPrimaryCloudCooldownMs: number;
  maxPrimaryCloudWaitMs: number;
}

const OCR_SETTINGS_STORAGE_KEY = "courseforge.ocr.settings.v1";
const AUTO_RETRIES_STORAGE_KEY = "courseforge.automaticRetriesEnabled";
const LEGACY_PROVIDER_ORDER_KEY = "courseforge.autoOcr.providerOrder";

const SUPPORTED_PRIMARY_PROVIDERS: Array<Exclude<OcrProviderId, "local_tesseract">> = [
  "cloud_openai_vision",
  "cloud_github_models_vision",
];

const SUPPORTED_FALLBACK_BEHAVIORS: OcrFallbackBehavior[] = ["wait", "backup", "tesseract-last"];
const SUPPORTED_CROP_STRATEGIES: OcrCropStrategy[] = ["color", "bw", "both"];
const SUPPORTED_DEBUG_LEVELS: OcrDebugLevel[] = ["off", "errors", "verbose", "trace"];

const LIVE_DEFAULTS: OcrSettings = {
  autoRetriesEnabled: true,
  maxRetryAttempts: 1,
  shots: 3,
  cropStrategy: "both",
  dynamicRateLimitAdaptation: true,
  dynamicLimitBufferSeconds: 3,
  primaryProvider: "cloud_openai_vision",
  fallbackBehavior: "tesseract-last",
  debugLevel: "errors",
};

interface OcrSettingsStorage {
  read(): Promise<Partial<OcrSettings> | null>;
  write(value: OcrSettings): Promise<void>;
  clear(): Promise<void>;
  readLegacy?(): Promise<Partial<OcrSettings> | null>;
}

type Listener = (value: OcrSettings) => void;

class OcrSettingsManager {
  private listeners: Set<Listener> = new Set();

  private cache: OcrSettings | null = null;

  private initialized = false;

  constructor(private readonly storage: OcrSettingsStorage) {}

  async getDefaults(): Promise<OcrSettings> {
    return { ...LIVE_DEFAULTS };
  }

  async getSettings(): Promise<OcrSettings> {
    await this.ensureInitialized();
    return { ...(this.cache ?? LIVE_DEFAULTS) };
  }

  async setSettings(next: OcrSettings): Promise<OcrSettings> {
    const validated = validateOcrSettings(next);
    this.cache = validated;
    await this.storage.write(validated);
    this.emit(validated);
    return { ...validated };
  }

  async updateSettings(update: OcrSettingsUpdateInput): Promise<OcrSettings> {
    const current = await this.getSettings();
    const merged: OcrSettings = validateOcrSettings({
      ...current,
      ...update,
    });
    return this.setSettings(merged);
  }

  async resetSettings(): Promise<OcrSettings> {
    await this.storage.clear();
    this.cache = { ...LIVE_DEFAULTS };
    this.emit(this.cache);
    return { ...this.cache };
  }

  async exportSettings(): Promise<string> {
    const value = await this.getSettings();
    return JSON.stringify(value, null, 2);
  }

  async importSettings(jsonPayload: string): Promise<OcrSettings> {
    const parsed = JSON.parse(jsonPayload) as OcrSettings;
    return this.setSettings(parsed);
  }

  async getRuntimeOptions(): Promise<OcrRuntimeOptions> {
    const settings = await this.getSettings();
    const secondaryCloud = settings.primaryProvider === "cloud_openai_vision"
      ? "cloud_github_models_vision"
      : "cloud_openai_vision";

    const providerOrder: OcrProviderId[] = settings.fallbackBehavior === "wait"
      ? [settings.primaryProvider, secondaryCloud, "local_tesseract"]
      : [settings.primaryProvider, secondaryCloud, "local_tesseract"];

    const waitForPrimaryCloudCooldownMs = Math.max(1_000, settings.dynamicLimitBufferSeconds * 1_000 + 45_000);
    const maxPrimaryCloudWaitMs = Math.max(waitForPrimaryCloudCooldownMs, waitForPrimaryCloudCooldownMs + 45_000);

    return {
      providerOrder,
      preferPrimaryCloudWait: settings.fallbackBehavior === "wait" || settings.dynamicRateLimitAdaptation,
      waitForPrimaryCloudCooldownMs,
      maxPrimaryCloudWaitMs,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const raw = await this.storage.read();
    if (raw) {
      this.cache = validateOcrSettings({
        ...LIVE_DEFAULTS,
        ...raw,
      });
      this.initialized = true;
      return;
    }

    const legacy = await this.storage.readLegacy?.();
    if (legacy) {
      this.cache = validateOcrSettings({
        ...LIVE_DEFAULTS,
        ...legacy,
      });
      await this.storage.write(this.cache);
      this.initialized = true;
      return;
    }

    this.cache = { ...LIVE_DEFAULTS };
    await this.storage.write(this.cache);
    this.initialized = true;
  }

  private emit(value: OcrSettings): void {
    for (const listener of this.listeners) {
      listener({ ...value });
    }
  }
}

function clampInteger(input: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseBoolean(input: unknown, fallback: boolean): boolean {
  if (typeof input === "boolean") {
    return input;
  }
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

export function validateOcrSettings(input: OcrSettingsValidationInput): OcrSettings {
  const nextPrimary = SUPPORTED_PRIMARY_PROVIDERS.includes(input.primaryProvider ?? LIVE_DEFAULTS.primaryProvider)
    ? (input.primaryProvider ?? LIVE_DEFAULTS.primaryProvider)
    : LIVE_DEFAULTS.primaryProvider;

  const nextCrop = SUPPORTED_CROP_STRATEGIES.includes(input.cropStrategy ?? LIVE_DEFAULTS.cropStrategy)
    ? (input.cropStrategy ?? LIVE_DEFAULTS.cropStrategy)
    : LIVE_DEFAULTS.cropStrategy;

  const nextFallback = SUPPORTED_FALLBACK_BEHAVIORS.includes(input.fallbackBehavior ?? LIVE_DEFAULTS.fallbackBehavior)
    ? (input.fallbackBehavior ?? LIVE_DEFAULTS.fallbackBehavior)
    : LIVE_DEFAULTS.fallbackBehavior;

  const nextDebugLevel = SUPPORTED_DEBUG_LEVELS.includes(input.debugLevel ?? LIVE_DEFAULTS.debugLevel)
    ? (input.debugLevel ?? LIVE_DEFAULTS.debugLevel)
    : LIVE_DEFAULTS.debugLevel;

  const normalizedShots = clampInteger(input.shots, 1, 3, LIVE_DEFAULTS.shots) as 1 | 2 | 3;

  return {
    autoRetriesEnabled: parseBoolean(input.autoRetriesEnabled, LIVE_DEFAULTS.autoRetriesEnabled),
    maxRetryAttempts: clampInteger(input.maxRetryAttempts, 0, 10, LIVE_DEFAULTS.maxRetryAttempts),
    shots: normalizedShots,
    cropStrategy: nextCrop,
    dynamicRateLimitAdaptation: parseBoolean(input.dynamicRateLimitAdaptation, LIVE_DEFAULTS.dynamicRateLimitAdaptation),
    dynamicLimitBufferSeconds: clampInteger(input.dynamicLimitBufferSeconds, 0, 30, LIVE_DEFAULTS.dynamicLimitBufferSeconds),
    primaryProvider: nextPrimary,
    fallbackBehavior: nextFallback,
    debugLevel: nextDebugLevel,
  };
}

function getBrowserStorage(): Storage | null {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

async function createBrowserStorage(): Promise<OcrSettingsStorage> {
  return {
    async read() {
      const storage = getBrowserStorage();
      const raw = storage?.getItem(OCR_SETTINGS_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as Partial<OcrSettings>;
      } catch {
        return null;
      }
    },
    async write(value) {
      const storage = getBrowserStorage();
      storage?.setItem(OCR_SETTINGS_STORAGE_KEY, JSON.stringify(value));
    },
    async clear() {
      const storage = getBrowserStorage();
      storage?.removeItem(OCR_SETTINGS_STORAGE_KEY);
    },
    async readLegacy() {
      const storage = getBrowserStorage();
      if (!storage) {
        return null;
      }

      const legacy: Partial<OcrSettings> = {};
      const retries = storage.getItem(AUTO_RETRIES_STORAGE_KEY);
      if (retries === "true" || retries === "false") {
        legacy.autoRetriesEnabled = retries === "true";
      }

      const providerOrderRaw = storage.getItem(LEGACY_PROVIDER_ORDER_KEY);
      if (providerOrderRaw) {
        try {
          const parsed = JSON.parse(providerOrderRaw) as string[];
          const primary = parsed.find((entry) => SUPPORTED_PRIMARY_PROVIDERS.includes(entry as Exclude<OcrProviderId, "local_tesseract">));
          if (primary) {
            legacy.primaryProvider = primary as Exclude<OcrProviderId, "local_tesseract">;
          }
        } catch {
          // Ignore malformed legacy provider order values.
        }
      }

      return Object.keys(legacy).length > 0 ? legacy : null;
    },
  };
}

async function resolveNodeSettingsFilePath(): Promise<string> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const localAppData = env?.LOCALAPPDATA;
  if (localAppData) {
    return `${localAppData}/CourseForge/settings/ocr-settings.json`;
  }

  const osModule = await import("node:os");
  return `${osModule.homedir()}/.courseforge/settings/ocr-settings.json`;
}

async function createNodeStorage(): Promise<OcrSettingsStorage> {
  const fsModule = await import("node:fs/promises");
  const pathModule = await import("node:path");
  const settingsPath = await resolveNodeSettingsFilePath();

  return {
    async read() {
      try {
        const raw = await fsModule.readFile(settingsPath, "utf8");
        return JSON.parse(raw) as Partial<OcrSettings>;
      } catch {
        return null;
      }
    },
    async write(value) {
      await fsModule.mkdir(pathModule.dirname(settingsPath), { recursive: true });
      await fsModule.writeFile(settingsPath, JSON.stringify(value, null, 2), "utf8");
    },
    async clear() {
      try {
        await fsModule.unlink(settingsPath);
      } catch {
        // Ignore if file is missing.
      }
    },
  };
}

let browserManagerPromise: Promise<OcrSettingsManager> | null = null;
let nodeManagerPromise: Promise<OcrSettingsManager> | null = null;

export async function getBrowserOcrSettingsManager(): Promise<OcrSettingsManager> {
  if (!browserManagerPromise) {
    browserManagerPromise = createBrowserStorage().then((storage) => new OcrSettingsManager(storage));
  }
  return browserManagerPromise;
}

export async function getNodeOcrSettingsManager(): Promise<OcrSettingsManager> {
  if (!nodeManagerPromise) {
    nodeManagerPromise = createNodeStorage().then((storage) => new OcrSettingsManager(storage));
  }
  return nodeManagerPromise;
}

export async function getOcrSettingsManager(): Promise<OcrSettingsManager> {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return getNodeOcrSettingsManager();
  }
  return getBrowserOcrSettingsManager();
}

export function getLiveDefaultOcrSettings(): OcrSettings {
  return { ...LIVE_DEFAULTS };
}

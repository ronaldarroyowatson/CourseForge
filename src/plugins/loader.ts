import {
  COURSEFORGE_PLUGIN_API_VERSION,
  type PluginApi,
  type PluginControlDefinition,
  type PluginManifest,
  type PluginRegistrationContext,
  type PluginRuntimeMode,
  type PluginStatus,
  type PluginStatusEvent,
} from "./api";

const PLUGIN_STATE_STORAGE_KEY = "courseforge.plugins.state";
const DSC_STORAGE_KEY = "courseforge.plugins.dsc.installed";
const DEFAULT_HOST_VERSION = "1.5.2";

const rawManifestModules = import.meta.glob("../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const entryModuleLoaders = import.meta.glob("../../plugins/*/index.ts") as Record<
  string,
  () => Promise<unknown>
>;

const loadedPlugins = new Map<string, PluginApi>();
const statusErrors = new Map<string, string>();
const listeners = new Set<(event: PluginStatusEvent) => void>();
let inMemoryState: Record<string, boolean> = {};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeStoredState(raw: unknown): Record<string, boolean> {
  if (!isObject(raw)) {
    return {};
  }

  const normalized: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") {
      normalized[key] = value;
    }
  }

  return normalized;
}

function getStoredState(): Record<string, boolean> {
  if (typeof window === "undefined") {
    return { ...inMemoryState };
  }

  try {
    const raw = window.localStorage.getItem(PLUGIN_STATE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return normalizeStoredState(JSON.parse(raw));
  } catch {
    return {};
  }
}

function setStoredState(next: Record<string, boolean>): void {
  inMemoryState = { ...next };

  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PLUGIN_STATE_STORAGE_KEY, JSON.stringify(next));
  if (next.dsc === true) {
    window.localStorage.setItem(DSC_STORAGE_KEY, "true");
  } else {
    window.localStorage.removeItem(DSC_STORAGE_KEY);
  }
}

function resolveInstalled(pluginId: string): boolean {
  const state = getStoredState();
  if (typeof state[pluginId] === "boolean") {
    return state[pluginId];
  }

  if (pluginId === "dsc" && typeof window !== "undefined") {
    return window.localStorage.getItem(DSC_STORAGE_KEY) === "true";
  }

  return false;
}

function isValidManifest(input: unknown): input is PluginManifest {
  if (!isObject(input)) {
    return false;
  }

  return (
    typeof input.name === "string" &&
    typeof input.id === "string" &&
    typeof input.version === "string" &&
    typeof input.description === "string" &&
    typeof input.optional === "boolean" &&
    typeof input.entry === "string"
  );
}

function missingPluginManifest(pluginId: string): PluginManifest {
  return {
    name: pluginId,
    id: pluginId,
    version: "0.0.0",
    description: "Missing plugin manifest.",
    optional: true,
    entry: "",
  };
}

function pluginContext(pluginId: string, mode: PluginRuntimeMode): PluginRegistrationContext {
  return {
    pluginId,
    hostVersion: DEFAULT_HOST_VERSION,
    apiVersion: COURSEFORGE_PLUGIN_API_VERSION,
    mode,
  };
}

function resolveEntryLoader(manifest: PluginManifest): (() => Promise<unknown>) | null {
  const normalizedEntry = manifest.entry.replace(/^\.\//, "");
  const candidates = [
    normalizedEntry,
    normalizedEntry.replace(/\.js$/, ".ts"),
    normalizedEntry.replace(/\.mjs$/, ".ts"),
  ];

  for (const candidate of candidates) {
    const key = `../../plugins/${manifest.id}/${candidate}`;
    const loader = entryModuleLoaders[key];
    if (loader) {
      return loader;
    }
  }

  return null;
}

function asPluginModule(input: unknown): PluginApi | null {
  if (!isObject(input)) {
    return null;
  }

  const register = input.register;
  const unregister = input.unregister;
  if (typeof register !== "function" || typeof unregister !== "function") {
    return null;
  }

  return input as unknown as PluginApi;
}

async function emitStatusChange(changedPluginId?: string): Promise<void> {
  const event: PluginStatusEvent = {
    changedPluginId,
    statuses: await getPluginStatuses(),
  };

  listeners.forEach((listener) => {
    listener(event);
  });
}

function buildStatus(manifest: PluginManifest, installed: boolean, loaded: boolean): PluginStatus {
  const error = statusErrors.get(manifest.id);
  return error
    ? { manifest, installed, loaded, error }
    : { manifest, installed, loaded };
}

export function subscribePluginStatusChanges(
  listener: (event: PluginStatusEvent) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function scanPlugins(): Promise<PluginManifest[]> {
  const manifests: PluginManifest[] = [];

  for (const rawManifest of Object.values(rawManifestModules)) {
    if (isValidManifest(rawManifest)) {
      manifests.push(rawManifest);
    }
  }

  manifests.sort((left, right) => left.id.localeCompare(right.id));
  return manifests;
}

export async function getPluginStatuses(): Promise<PluginStatus[]> {
  const manifests = await scanPlugins();
  return manifests.map((manifest) => {
    const installed = resolveInstalled(manifest.id);
    const loaded = loadedPlugins.has(manifest.id);
    return buildStatus(manifest, installed, loaded);
  });
}

export function getPluginStatusesSnapshot(): PluginStatus[] {
  const manifests = Object.values(rawManifestModules).filter(isValidManifest);
  return manifests.map((manifest) => {
    const installed = resolveInstalled(manifest.id);
    const loaded = loadedPlugins.has(manifest.id);
    return buildStatus(manifest, installed, loaded);
  });
}

export async function getPluginStatus(pluginId: string): Promise<PluginStatus | null> {
  const statuses = await getPluginStatuses();
  return statuses.find((status) => status.manifest.id === pluginId) ?? null;
}

export async function loadPlugin(pluginId: string): Promise<PluginStatus> {
  const manifests = await scanPlugins();
  const manifest = manifests.find((item) => item.id === pluginId);
  if (!manifest) {
    return {
      manifest: missingPluginManifest(pluginId),
      installed: false,
      loaded: false,
      error: "missing-plugin",
    };
  }

  const installed = resolveInstalled(pluginId);
  if (!installed) {
    statusErrors.delete(pluginId);
    const status = { manifest, installed: false, loaded: false };
    await emitStatusChange(pluginId);
    return status;
  }

  if (loadedPlugins.has(pluginId)) {
    statusErrors.delete(pluginId);
    return { manifest, installed: true, loaded: true };
  }

  const entryLoader = resolveEntryLoader(manifest);
  if (!entryLoader) {
    statusErrors.set(pluginId, "missing-entry");
    const status = { manifest, installed: true, loaded: false, error: "missing-entry" };
    await emitStatusChange(pluginId);
    return status;
  }

  try {
    const imported = await entryLoader();
    const plugin = asPluginModule(imported);
    if (!plugin) {
      statusErrors.set(pluginId, "invalid-plugin-api");
      const status = { manifest, installed: true, loaded: false, error: "invalid-plugin-api" };
      await emitStatusChange(pluginId);
      return status;
    }

    await plugin.register(pluginContext(pluginId, "webapp"));
    loadedPlugins.set(pluginId, plugin);
    statusErrors.delete(pluginId);
    const status = { manifest, installed: true, loaded: true };
    await emitStatusChange(pluginId);
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : "register-failed";
    statusErrors.set(pluginId, message);
    const status = { manifest, installed: true, loaded: false, error: message };
    await emitStatusChange(pluginId);
    return status;
  }
}

export async function unloadPlugin(pluginId: string): Promise<PluginStatus> {
  const manifests = await scanPlugins();
  const manifest = manifests.find((item) => item.id === pluginId);
  if (!manifest) {
    return {
      manifest: missingPluginManifest(pluginId),
      installed: false,
      loaded: false,
      error: "missing-plugin",
    };
  }

  const plugin = loadedPlugins.get(pluginId);
  if (!plugin) {
    const status = {
      manifest,
      installed: resolveInstalled(pluginId),
      loaded: false,
      error: statusErrors.get(pluginId),
    };
    await emitStatusChange(pluginId);
    return status;
  }

  try {
    await plugin.unregister(pluginContext(pluginId, "webapp"));
    loadedPlugins.delete(pluginId);
    statusErrors.delete(pluginId);
    const status = {
      manifest,
      installed: resolveInstalled(pluginId),
      loaded: false,
    };
    await emitStatusChange(pluginId);
    return status;
  } catch (error) {
    loadedPlugins.delete(pluginId);
    const message = error instanceof Error ? error.message : "unregister-failed";
    statusErrors.set(pluginId, message);
    const status = {
      manifest,
      installed: resolveInstalled(pluginId),
      loaded: false,
      error: message,
    };
    await emitStatusChange(pluginId);
    return status;
  }
}

export async function installPlugin(pluginId: string): Promise<PluginStatus> {
  const manifests = await scanPlugins();
  const manifest = manifests.find((item) => item.id === pluginId);
  if (!manifest) {
    return {
      manifest: missingPluginManifest(pluginId),
      installed: false,
      loaded: false,
      error: "missing-plugin",
    };
  }

  const state = getStoredState();
  state[pluginId] = true;
  setStoredState(state);

  return loadPlugin(pluginId);
}

export async function uninstallPlugin(pluginId: string): Promise<PluginStatus> {
  const manifests = await scanPlugins();
  const manifest = manifests.find((item) => item.id === pluginId);
  if (!manifest) {
    return {
      manifest: missingPluginManifest(pluginId),
      installed: false,
      loaded: false,
      error: "missing-plugin",
    };
  }

  await unloadPlugin(pluginId);
  const state = getStoredState();
  delete state[pluginId];
  setStoredState(state);

  statusErrors.delete(pluginId);
  const status = {
    manifest,
    installed: false,
    loaded: false,
  };
  await emitStatusChange(pluginId);
  return status;
}

export async function refreshPluginStatus(pluginId: string): Promise<PluginStatus> {
  const status = await getPluginStatus(pluginId);
  if (!status) {
    return {
      manifest: missingPluginManifest(pluginId),
      installed: false,
      loaded: false,
      error: "missing-plugin",
    };
  }

  return status.installed ? loadPlugin(pluginId) : unloadPlugin(pluginId);
}

export async function initializeInstalledPlugins(): Promise<PluginStatus[]> {
  const statuses = await getPluginStatuses();
  for (const status of statuses) {
    if (status.installed && !status.loaded) {
      await loadPlugin(status.manifest.id);
    }
  }

  return getPluginStatuses();
}

export async function getPluginControls(pluginId: string): Promise<PluginControlDefinition[] | null> {
  const loaded = loadedPlugins.get(pluginId);
  if (loaded?.getControls) {
    return loaded.getControls();
  }

  const status = await loadPlugin(pluginId);
  if (!status.loaded) {
    return null;
  }

  return loadedPlugins.get(pluginId)?.getControls?.() ?? null;
}

export function resetPluginLoaderStateForTests(): void {
  loadedPlugins.clear();
  statusErrors.clear();
  listeners.clear();
  inMemoryState = {};
}

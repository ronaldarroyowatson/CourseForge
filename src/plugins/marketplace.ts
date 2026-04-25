import type { PluginManifest, PluginStatus } from "./api";
import {
  getPluginStatuses,
  installPlugin,
  scanPlugins,
  uninstallPlugin,
} from "./loader";

export interface MarketplacePluginRecord {
  pluginId: string;
  manifest: PluginManifest;
  status?: PluginStatus;
  source: "local" | "remote";
}

export interface MarketplacePluginMetadata {
  pluginId: string;
  manifest: PluginManifest;
  installState: "installed" | "not-installed";
  loaded: boolean;
  tags: string[];
  author?: string;
  homepage?: string;
}

export interface MarketplaceOperationResult {
  pluginId: string;
  ok: boolean;
  message: string;
  status?: PluginStatus;
}

export async function listAvailablePlugins(): Promise<MarketplacePluginRecord[]> {
  const manifests = await scanPlugins();
  const statuses = await getPluginStatuses();
  const statusById = new Map(statuses.map((status) => [status.manifest.id, status]));

  return manifests.map((manifest) => ({
    pluginId: manifest.id,
    manifest,
    status: statusById.get(manifest.id),
    source: "local",
  }));
}

export async function fetchPluginMetadata(pluginId: string): Promise<MarketplacePluginMetadata | null> {
  const records = await listAvailablePlugins();
  const record = records.find((item) => item.pluginId === pluginId);
  if (!record) {
    return null;
  }

  const installState = record.status?.installed ? "installed" : "not-installed";

  return {
    pluginId,
    manifest: record.manifest,
    installState,
    loaded: Boolean(record.status?.loaded),
    tags: [],
    author: "CourseForge Team",
  };
}

export async function installFromMarketplace(pluginId: string): Promise<MarketplaceOperationResult> {
  const status = await installPlugin(pluginId);
  if (status.error) {
    return {
      pluginId,
      ok: false,
      message: `Install failed: ${status.error}`,
      status,
    };
  }

  return {
    pluginId,
    ok: true,
    message: "Plugin installed via marketplace scaffold path.",
    status,
  };
}

export async function uninstallFromMarketplace(pluginId: string): Promise<MarketplaceOperationResult> {
  const status = await uninstallPlugin(pluginId);
  if (status.error) {
    return {
      pluginId,
      ok: false,
      message: `Uninstall failed: ${status.error}`,
      status,
    };
  }

  return {
    pluginId,
    ok: true,
    message: "Plugin uninstalled via marketplace scaffold path.",
    status,
  };
}

export async function refreshMarketplaceIndex(): Promise<{
  ok: boolean;
  message: string;
}> {
  const records = await listAvailablePlugins();
  return {
    ok: true,
    message: `Marketplace scaffold refreshed with ${records.length} local plugin(s).`,
  };
}

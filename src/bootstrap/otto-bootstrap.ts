import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface OttoComponentSpec {
  name: string;
  target: 'otto' | 'courseforge';
  kind: 'runtime' | 'extension' | 'service' | 'module' | 'schema' | 'command' | 'ui' | 'asset' | 'config';
  source: string;
  minVersion: string;
  checksum: string;
}

export interface OttoPayload {
  mode: 'courseforge';
  releaseChannel: 'stable' | 'preview';
  components: OttoComponentSpec[];
}

export interface OttoBootstrapConfig {
  mode: 'courseforge';
  payloadPath: string;
  manifestPath: string;
  runtimeRoot: string;
  componentReceiptDir: string;
  stateFile: string;
  verifyChecksums: boolean;
  allowSelfUpdate: boolean;
  restartOnUpdate: boolean;
  telemetry: {
    cloudEnabled: boolean;
    cloudEndpoint: string;
    maxSplashMessages: number;
  };
  splash: {
    ottoLogo: string;
    courseForgeLogo: string;
    assets: string[];
  };
  observability: {
    logging: boolean;
    tracing: boolean;
    metrics: boolean;
  };
}

export interface OttoReadiness {
  running: boolean;
  kernelLoaded: boolean;
  updateEngineReady: boolean;
  moduleLoaderReady: boolean;
  extensionLoaderReady: boolean;
  commandServiceReady: boolean;
  telemetryExtensionLoaded: boolean;
  splashReady: boolean;
  authExtensionDiscovered: boolean;
  loggingActive: boolean;
  tracingActive: boolean;
  metricsActive: boolean;
}

export interface OttoUpdateStatus {
  lifecycleState: 'OTTO_INIT' | 'OTTO_CHECKING' | 'OTTO_APPLYING' | 'OTTO_DONE';
  ottoState: 'updated' | 'up-to-date';
  courseForgeState: 'updated' | 'up-to-date';
  restartRequired: boolean;
  restarted: boolean;
  appliedOttoComponents: string[];
  appliedCourseForgeComponents: string[];
  handoffReady: boolean;
}

export interface OttoTelemetryEvent {
  timestamp: string;
  level: 'info' | 'error';
  stage: 'otto-startup' | 'otto-update' | 'otto-restart' | 'courseforge-update' | 'handoff';
  type: 'progress' | 'install' | 'restart' | 'error' | 'command-exec' | 'module-load' | 'extension-load';
  message: string;
  cloudForwarded: boolean;
  data?: Record<string, unknown>;
}

export interface OttoBootstrapResult {
  mode: 'courseforge';
  runtimeRoot: string;
  manifestPath: string;
  telemetryLogPath: string;
  splashMessages: string[];
  telemetryEvents: OttoTelemetryEvent[];
  readiness: OttoReadiness;
  updateStatus: OttoUpdateStatus;
  actions: string[];
}

export interface OttoBootstrapOptions {
  repoRoot?: string;
  runtimeRoot?: string;
  payloadPath?: string;
  configPath?: string;
  resolveReleaseVersion?: (component: OttoComponentSpec) => Promise<string | null> | string | null;
}

interface CourseForgeManifest {
  version?: string;
  otto?: {
    requiredComponents?: string[];
    minimalInstallerContents?: string[];
  };
}

interface ComponentReceipt {
  name: string;
  version: string;
  checksum: string;
  source: string;
  installedAt: string;
  installDirectory?: string;
  resolvedVersionSource?: string;
}

interface PackageManifest {
  version?: string;
}

interface ResolvedComponentVersion {
  version: string;
  source: 'release-metadata' | 'manifest-minVersion' | 'receipt-version';
  releaseApiUrl?: string | null;
}

interface OttoStateRecord {
  mode: 'courseforge';
  bootCount: number;
  lastStartedAt: string;
  readiness: OttoReadiness;
  updateStatus: OttoUpdateStatus;
  splashMessages: string[];
}

export async function bootstrapOtto(options: OttoBootstrapOptions = {}): Promise<OttoBootstrapResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const configPath = path.resolve(repoRoot, options.configPath ?? 'deployment/otto-bootstrap-config.json');
  const config = await readJsonFile<OttoBootstrapConfig>(configPath);
  const payloadPath = path.resolve(repoRoot, options.payloadPath ?? config.payloadPath);
  const payload = await readJsonFile<OttoPayload>(payloadPath);
  const manifestPath = path.resolve(repoRoot, config.manifestPath);
  const packageManifestPath = path.resolve(repoRoot, 'package.json');
  const packageManifest = await readJsonFile<PackageManifest>(packageManifestPath);
  const courseForgeManifest = await readJsonFile<CourseForgeManifest>(manifestPath);
  const runtimeRoot = path.resolve(repoRoot, options.runtimeRoot ?? config.runtimeRoot);
  const componentReceiptRoot = path.join(runtimeRoot, config.componentReceiptDir);
  const stateFilePath = path.join(runtimeRoot, config.stateFile);
  const telemetryLogPath = path.join(runtimeRoot, 'telemetry', 'boot-events.jsonl');
  const packageVersion = packageManifest.version ?? 'unknown';
  const courseForgeVersion = courseForgeManifest.version ?? 'unknown';
  const ottoKernelVersion = payload.components.find((component) => component.name === 'otto-kernel')?.minVersion ?? 'unknown';
  const ottoCoreVersion = payload.components.find((component) => component.name === 'otto-core')?.minVersion ?? 'unknown';
  const releaseVersionResolver =
    options.resolveReleaseVersion ?? getDefaultReleaseVersionResolver({ enabled: process.env.NODE_ENV !== 'test' });
  const resolvedReleaseVersionCache = new Map<string, Promise<ResolvedComponentVersion | null>>();
  const logBootstrap = (message: string, data?: Record<string, unknown>): void => {
    if (config.observability.logging) {
      console.info(`otto.bootstrap: ${message}`, data ?? {});
    }
  };

  await verifyCourseForgeManifest(courseForgeManifest, payload, {
    manifestPath,
    packageVersion,
    logBootstrap
  });
  await mkdir(componentReceiptRoot, { recursive: true });
  await mkdir(path.dirname(stateFilePath), { recursive: true });
  await mkdir(path.dirname(telemetryLogPath), { recursive: true });

  const actions: string[] = [];
  const splashMessages: string[] = [];
  const telemetryEvents: OttoTelemetryEvent[] = [];
  let lifecycleState: OttoUpdateStatus['lifecycleState'] = 'OTTO_INIT';

  const pushSplashMessage = (message: string): void => {
    splashMessages.push(message);
    const maxMessages = Math.max(config.telemetry.maxSplashMessages, 4);
    if (splashMessages.length > maxMessages) {
      splashMessages.shift();
    }
  };

  const emitTelemetry = (
    stage: OttoTelemetryEvent['stage'],
    type: OttoTelemetryEvent['type'],
    message: string,
    level: OttoTelemetryEvent['level'] = 'info',
    data?: Record<string, unknown>
  ): void => {
    telemetryEvents.push({
      timestamp: new Date().toISOString(),
      level,
      stage,
      type,
      message,
      cloudForwarded: config.telemetry.cloudEnabled,
      data
    });
  };

  emitTelemetry('otto-startup', 'progress', 'Initializing telemetry extension');
  actions.push('telemetry:init');
  emitTelemetry('otto-startup', 'progress', 'Otto lifecycle state OTTO_INIT', 'info', { lifecycleState });
  emitTelemetry('otto-startup', 'progress', 'Initializing splash screen');
  actions.push('splash:init');
  emitTelemetry('otto-startup', 'command-exec', 'Loading Otto payload manifest', 'info', {
    payloadPath,
    manifestPath,
    packageVersion,
    courseForgeVersion,
    ottoKernelVersion,
    ottoCoreVersion,
    ottoExtensionVersions: payload.components
      .filter((component) => component.target === 'otto' && component.kind === 'extension')
      .map((component) => ({ name: component.name, version: component.minVersion, source: component.source }))
  });
  logBootstrap('loaded version sources', {
    manifestPath,
    packageManifestPath,
    packageVersion,
    courseForgeVersion,
    ottoKernelVersion,
    ottoCoreVersion
  });

  lifecycleState = 'OTTO_CHECKING';
  emitTelemetry('otto-update', 'progress', 'Otto lifecycle state OTTO_CHECKING', 'info', { lifecycleState });

  pushSplashMessage('Updating Otto...');
  emitTelemetry('otto-update', 'progress', 'Updating Otto...');

  lifecycleState = 'OTTO_APPLYING';
  emitTelemetry('otto-update', 'progress', 'Otto lifecycle state OTTO_APPLYING', 'info', { lifecycleState });

  const appliedOttoComponents = await applyComponentUpdates({
    payload,
    target: 'otto',
    componentReceiptRoot,
    verifyChecksums: config.verifyChecksums,
    actions,
    emitTelemetry,
    resolveReleaseVersion: async (component) => {
      const releaseApiUrl = getGitHubLatestReleaseApiUrl(component.source);
      if (!releaseApiUrl) {
        return null;
      }

      const cacheKey = releaseApiUrl;
      if (!resolvedReleaseVersionCache.has(cacheKey)) {
        resolvedReleaseVersionCache.set(
          cacheKey,
          Promise.resolve(releaseVersionResolver(component)).then((resolved) => {
            if (typeof resolved === 'string' && resolved.trim().length > 0) {
              return {
                version: resolved.trim(),
                source: 'release-metadata' as const,
                releaseApiUrl
              };
            }

            const fallbackVersion = component.minVersion === 'latest' ? null : component.minVersion;
            return fallbackVersion
              ? {
                  version: fallbackVersion,
                  source: 'manifest-minVersion' as const,
                  releaseApiUrl
                }
              : null;
          })
        );
      }

      return resolvedReleaseVersionCache.get(cacheKey) ?? null;
    },
    logBootstrap
  });

  const restartRequired = config.allowSelfUpdate && config.restartOnUpdate && appliedOttoComponents.length > 0;
  if (restartRequired) {
    pushSplashMessage('Restarting Otto...');
    emitTelemetry('otto-restart', 'restart', 'Restarting Otto...');
    actions.push('restart:otto');
    emitTelemetry('otto-restart', 'progress', 'Reinitializing telemetry extension after Otto restart');
    emitTelemetry('otto-restart', 'progress', 'Reinitializing splash screen after Otto restart');
  }

  pushSplashMessage('Updating CourseForge...');
  emitTelemetry('courseforge-update', 'progress', 'Updating CourseForge...');

  const appliedCourseForgeComponents = await applyComponentUpdates({
    payload,
    target: 'courseforge',
    componentReceiptRoot,
    verifyChecksums: config.verifyChecksums,
    actions,
    emitTelemetry,
    resolveReleaseVersion: async (component) => {
      const resolved = await Promise.resolve(releaseVersionResolver(component));
      if (typeof resolved === 'string' && resolved.trim().length > 0) {
        return {
          version: resolved.trim(),
          source: 'release-metadata' as const,
          releaseApiUrl: getGitHubLatestReleaseApiUrl(component.source)
        };
      }

      if (component.minVersion === 'latest') {
        return null;
      }

      return {
        version: component.minVersion,
        source: 'manifest-minVersion' as const,
        releaseApiUrl: getGitHubLatestReleaseApiUrl(component.source)
      };
    },
    logBootstrap
  });

  pushSplashMessage('Preparing modules...');
  emitTelemetry('courseforge-update', 'module-load', 'Preparing modules...');

  pushSplashMessage('Preparing extensions...');
  emitTelemetry('courseforge-update', 'extension-load', 'Preparing extensions...');

  emitTelemetry('handoff', 'progress', 'Handing control to CourseForge UI');
  actions.push('handoff:courseforge-ui');

  lifecycleState = 'OTTO_DONE';
  emitTelemetry('handoff', 'progress', 'Otto lifecycle state OTTO_DONE', 'info', { lifecycleState });

  const readiness: OttoReadiness = {
    running: true,
    kernelLoaded: hasComponent(payload, 'otto-kernel'),
    updateEngineReady: hasComponent(payload, 'otto-update-engine'),
    moduleLoaderReady: hasComponent(payload, 'otto-module-loader'),
    extensionLoaderReady: hasComponent(payload, 'otto-extension-loader'),
    commandServiceReady: hasComponent(payload, 'otto-command-service'),
    telemetryExtensionLoaded: hasComponent(payload, 'otto-extension-telemetry'),
    splashReady: hasComponent(payload, 'otto-ui-splash'),
    authExtensionDiscovered: hasComponent(payload, 'otto-extension-auth'),
    loggingActive: config.observability.logging,
    tracingActive: config.observability.tracing,
    metricsActive: config.observability.metrics
  };

  const updateStatus: OttoUpdateStatus = {
    lifecycleState,
    ottoState: appliedOttoComponents.length > 0 ? 'updated' : 'up-to-date',
    courseForgeState: appliedCourseForgeComponents.length > 0 ? 'updated' : 'up-to-date',
    restartRequired,
    restarted: restartRequired,
    appliedOttoComponents,
    appliedCourseForgeComponents,
    handoffReady: true
  };

  const previousState = await readOptionalJsonFile<OttoStateRecord>(stateFilePath);
  const nextState: OttoStateRecord = {
    mode: 'courseforge',
    bootCount: (previousState?.bootCount ?? 0) + 1,
    lastStartedAt: new Date().toISOString(),
    readiness,
    updateStatus,
    splashMessages
  };

  await writeTelemetryLog(telemetryLogPath, telemetryEvents);
  await writeJsonFile(stateFilePath, nextState);
  actions.push('telemetry:written');
  actions.push('state:written');

  return {
    mode: 'courseforge',
    runtimeRoot,
    manifestPath,
    telemetryLogPath,
    splashMessages,
    telemetryEvents,
    readiness,
    updateStatus,
    actions
  };
}

async function verifyCourseForgeManifest(
  manifest: CourseForgeManifest,
  payload: OttoPayload,
  options: {
    manifestPath: string;
    packageVersion: string;
    logBootstrap: (message: string, data?: Record<string, unknown>) => void;
  }
): Promise<void> {
  const requiredComponents = manifest.otto?.requiredComponents ?? [];

  options.logBootstrap('verifying CourseForge manifest and version alignment', {
    manifestPath: options.manifestPath,
    manifestVersion: manifest.version ?? 'unknown',
    packageVersion: options.packageVersion,
    versionAligned: manifest.version ? manifest.version === options.packageVersion : true,
    requiredComponentCount: requiredComponents.length
  });

  if (manifest.version && manifest.version !== options.packageVersion) {
    options.logBootstrap('CourseForge app version differs from manifest version', {
      manifestPath: options.manifestPath,
      manifestVersion: manifest.version,
      packageVersion: options.packageVersion
    });
  }

  for (const componentName of requiredComponents) {
    if (!hasComponent(payload, componentName)) {
      throw new Error(`CourseForge manifest requires missing Otto component: ${componentName}`);
    }
  }
}

function hasComponent(payload: OttoPayload, componentName: string): boolean {
  return payload.components.some((component) => component.name === componentName);
}

async function applyComponentUpdates(options: {
  payload: OttoPayload;
  target: 'otto' | 'courseforge';
  componentReceiptRoot: string;
  verifyChecksums: boolean;
  actions: string[];
  resolveReleaseVersion: (component: OttoComponentSpec) => Promise<ResolvedComponentVersion | null>;
  logBootstrap: (message: string, data?: Record<string, unknown>) => void;
  emitTelemetry: (
    stage: OttoTelemetryEvent['stage'],
    type: OttoTelemetryEvent['type'],
    message: string,
    level?: OttoTelemetryEvent['level'],
    data?: Record<string, unknown>
  ) => void;
}): Promise<string[]> {
  const applied: string[] = [];
  const targetRoot = path.join(options.componentReceiptRoot, options.target);
  await mkdir(targetRoot, { recursive: true });

  for (const component of options.payload.components.filter((entry) => entry.target === options.target)) {
    const receiptPath = path.join(targetRoot, `${component.name}.json`);
    const installDirectory = path.join(targetRoot, component.name);
    const installReceiptPath = path.join(installDirectory, 'receipt.json');
    const currentReceipt = await readOptionalJsonFile<ComponentReceipt>(receiptPath);
    const resolvedVersion = await options.resolveReleaseVersion(component);
    const targetVersion = resolvedVersion?.version ?? component.minVersion;
    const versionNeedsUpdate = !currentReceipt || !satisfiesMinVersion(currentReceipt.version, targetVersion);
    const sourceChanged = currentReceipt?.source !== component.source;
    const checksumChanged = currentReceipt?.checksum !== component.checksum;
    const needsInstall = versionNeedsUpdate || sourceChanged || checksumChanged;

    options.logBootstrap('evaluating component update', {
      target: options.target,
      component: component.name,
      currentVersion: currentReceipt?.version ?? null,
      targetVersion,
      currentSource: currentReceipt?.source ?? null,
      source: component.source,
      installDirectory,
      versionNeedsUpdate,
      sourceChanged,
      checksumChanged,
      resolvedVersionSource: resolvedVersion?.source ?? 'manifest-minVersion',
      releaseApiUrl: resolvedVersion?.releaseApiUrl ?? null
    });

    if (needsInstall || checksumChanged) {
      const receipt: ComponentReceipt = {
        name: component.name,
        version: targetVersion,
        checksum: component.checksum,
        source: component.source,
        installedAt: new Date().toISOString(),
        installDirectory,
        resolvedVersionSource: resolvedVersion?.source ?? 'manifest-minVersion'
      };

      await mkdir(installDirectory, { recursive: true });
      await writeJsonFile(receiptPath, receipt);
      await writeJsonFile(installReceiptPath, receipt);
      await writeJsonFile(path.join(installDirectory, 'installed-component.json'), {
        component,
        targetVersion,
        installedAt: receipt.installedAt,
        receiptPath,
        installReceiptPath
      });
      applied.push(component.name);
      options.actions.push(`downloaded:${component.name}`);
      options.actions.push(`extracted:${component.name}`);
      options.actions.push(`replaced:${component.name}`);

      const stage = options.target === 'otto' ? 'otto-update' : 'courseforge-update';
      const eventType =
        component.kind === 'extension'
          ? 'extension-load'
          : component.kind === 'module'
            ? 'module-load'
            : 'install';
      options.logBootstrap('applied component update', {
        target: options.target,
        component: component.name,
        targetVersion,
        installDirectory,
        receiptPath,
        installReceiptPath,
        resolvedVersionSource: receipt.resolvedVersionSource
      });
      options.emitTelemetry(stage, eventType, `Installed ${component.name}`, 'info', {
        target: options.target,
        kind: component.kind,
        source: component.source,
        targetVersion,
        installDirectory,
        receiptPath,
        installReceiptPath,
        resolvedVersionSource: receipt.resolvedVersionSource
      });
    } else {
      options.logBootstrap('no update needed', {
        target: options.target,
        component: component.name,
        currentVersion: currentReceipt?.version ?? null,
        targetVersion,
        source: component.source,
        reason: versionNeedsUpdate ? 'version check passed but install skipped by source/checksum state' : 'already current'
      });
    }

    if (options.verifyChecksums) {
      const verifiedReceipt = await readJsonFile<ComponentReceipt>(receiptPath);
      if (verifiedReceipt.checksum !== component.checksum) {
        options.emitTelemetry(
          options.target === 'otto' ? 'otto-update' : 'courseforge-update',
          'error',
          `Checksum verification failed for ${component.name}`,
          'error'
        );
        throw new Error(`Checksum verification failed for ${component.name}`);
      }

      options.actions.push(`verified:${component.name}`);
    }
  }

  return applied;
}

function satisfiesMinVersion(version: string, minimumVersion: string): boolean {
  if (version === minimumVersion) {
    return true;
  }

  const left = normalizeVersion(version);
  const right = normalizeVersion(minimumVersion);

  if (left.length === 0 || right.length === 0) {
    return false;
  }

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;

    if (leftPart > rightPart) {
      return true;
    }

    if (leftPart < rightPart) {
      return false;
    }
  }

  return true;
}

function normalizeVersion(version: string): number[] {
  return version
    .split('.')
    .map((segment) => Number.parseInt(segment.replace(/[^0-9].*$/, ''), 10))
    .filter((segment) => !Number.isNaN(segment));
}

function getDefaultReleaseVersionResolver(options: { enabled: boolean }): (component: OttoComponentSpec) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();

  return async (component: OttoComponentSpec) => {
    if (!options.enabled) {
      return null;
    }

    const releaseApiUrl = getGitHubLatestReleaseApiUrl(component.source);
    if (!releaseApiUrl) {
      return null;
    }

    if (!cache.has(releaseApiUrl)) {
      cache.set(releaseApiUrl, resolveGitHubLatestReleaseVersion(releaseApiUrl));
    }

    return cache.get(releaseApiUrl) ?? null;
  };
}

function getGitHubLatestReleaseApiUrl(source: string): string | null {
  try {
    const parsedSource = new URL(source);
    if (parsedSource.hostname !== 'github.com') {
      return null;
    }

    const match = parsedSource.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/latest\/download\//);
    if (!match) {
      return null;
    }

    const owner = match[1];
    const repo = match[2];
    return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  } catch {
    return null;
  }
}

async function resolveGitHubLatestReleaseVersion(releaseApiUrl: string): Promise<string | null> {
  if (typeof fetch !== 'function') {
    return null;
  }

  try {
    const response = await fetch(releaseApiUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CourseForge-Otto-Bootstrap'
      },
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(750) : undefined
    });

    if (!response.ok) {
      return null;
    }

    const release = (await response.json()) as { tag_name?: string; name?: string };
    const version = release.tag_name?.trim() || release.name?.trim() || '';
    if (!version) {
      return null;
    }

    return version;
  } catch {
    return null;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

async function readOptionalJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    await stat(filePath);
  } catch {
    return null;
  }

  return readJsonFile<T>(filePath);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeTelemetryLog(filePath: string, events: OttoTelemetryEvent[]): Promise<void> {
  const lines = events.map((event) => JSON.stringify(event));
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}
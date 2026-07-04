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
}

interface CourseForgeManifest {
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
  const runtimeRoot = path.resolve(repoRoot, options.runtimeRoot ?? config.runtimeRoot);
  const componentReceiptRoot = path.join(runtimeRoot, config.componentReceiptDir);
  const stateFilePath = path.join(runtimeRoot, config.stateFile);
  const telemetryLogPath = path.join(runtimeRoot, 'telemetry', 'boot-events.jsonl');

  await verifyCourseForgeManifest(manifestPath, payload);
  await mkdir(componentReceiptRoot, { recursive: true });
  await mkdir(path.dirname(stateFilePath), { recursive: true });
  await mkdir(path.dirname(telemetryLogPath), { recursive: true });

  const actions: string[] = [];
  const splashMessages: string[] = [];
  const telemetryEvents: OttoTelemetryEvent[] = [];

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
  emitTelemetry('otto-startup', 'progress', 'Initializing splash screen');
  actions.push('splash:init');
  emitTelemetry('otto-startup', 'command-exec', 'Loading Otto payload manifest', 'info', { payloadPath });

  pushSplashMessage('Updating Otto...');
  emitTelemetry('otto-update', 'progress', 'Updating Otto...');

  const appliedOttoComponents = await applyComponentUpdates({
    payload,
    target: 'otto',
    componentReceiptRoot,
    verifyChecksums: config.verifyChecksums,
    actions,
    emitTelemetry
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
    emitTelemetry
  });

  pushSplashMessage('Preparing modules...');
  emitTelemetry('courseforge-update', 'module-load', 'Preparing modules...');

  pushSplashMessage('Preparing extensions...');
  emitTelemetry('courseforge-update', 'extension-load', 'Preparing extensions...');

  emitTelemetry('handoff', 'progress', 'Handing control to CourseForge UI');
  actions.push('handoff:courseforge-ui');

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

async function verifyCourseForgeManifest(manifestPath: string, payload: OttoPayload): Promise<void> {
  const manifest = await readJsonFile<CourseForgeManifest>(manifestPath);
  const requiredComponents = manifest.otto?.requiredComponents ?? [];

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
  emitTelemetry: (
    stage: OttoTelemetryEvent['stage'],
    type: OttoTelemetryEvent['type'],
    message: string,
    level?: OttoTelemetryEvent['level'],
    data?: Record<string, unknown>
  ) => void;
}): Promise<string[]> {
  const applied: string[] = [];

  for (const component of options.payload.components.filter((entry) => entry.target === options.target)) {
    const targetRoot = path.join(options.componentReceiptRoot, options.target);
    await mkdir(targetRoot, { recursive: true });

    const receiptPath = path.join(targetRoot, `${component.name}.json`);
    const currentReceipt = await readOptionalJsonFile<ComponentReceipt>(receiptPath);
    const needsInstall = !currentReceipt || !satisfiesMinVersion(currentReceipt.version, component.minVersion);
    const checksumChanged = currentReceipt?.checksum !== component.checksum;

    if (needsInstall || checksumChanged) {
      const receipt: ComponentReceipt = {
        name: component.name,
        version: component.minVersion,
        checksum: component.checksum,
        source: component.source,
        installedAt: new Date().toISOString()
      };

      await writeJsonFile(receiptPath, receipt);
      applied.push(component.name);
      options.actions.push(`downloaded:${component.name}`);

      const stage = options.target === 'otto' ? 'otto-update' : 'courseforge-update';
      const eventType =
        component.kind === 'extension'
          ? 'extension-load'
          : component.kind === 'module'
            ? 'module-load'
            : 'install';
      options.emitTelemetry(stage, eventType, `Installed ${component.name}`, 'info', {
        target: options.target,
        kind: component.kind,
        source: component.source
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
  const left = normalizeVersion(version);
  const right = normalizeVersion(minimumVersion);

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
    .map((segment) => (Number.isNaN(segment) ? 0 : segment));
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
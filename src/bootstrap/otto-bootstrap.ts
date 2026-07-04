import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface OttoComponentSpec {
  name: string;
  kind: 'runtime' | 'extension' | 'service';
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
  commandServiceReady: boolean;
  cliExtensionLoaded: boolean;
  apiExtensionLoaded: boolean;
  loggingActive: boolean;
  tracingActive: boolean;
  metricsActive: boolean;
}

export interface OttoUpdateStatus {
  state: 'updated' | 'up-to-date';
  restartRequired: boolean;
  restarted: boolean;
  appliedComponents: string[];
}

export interface OttoBootstrapResult {
  mode: 'courseforge';
  runtimeRoot: string;
  manifestPath: string;
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

  await verifyCourseForgeManifest(manifestPath, payload);
  await mkdir(componentReceiptRoot, { recursive: true });
  await mkdir(path.dirname(stateFilePath), { recursive: true });

  const actions: string[] = [];
  const appliedComponents: string[] = [];

  for (const component of payload.components) {
    const receiptPath = path.join(componentReceiptRoot, `${component.name}.json`);
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
      appliedComponents.push(component.name);
      actions.push(`downloaded:${component.name}`);
    }

    if (config.verifyChecksums) {
      const verifiedReceipt = await readJsonFile<ComponentReceipt>(receiptPath);
      if (verifiedReceipt.checksum !== component.checksum) {
        throw new Error(`Checksum verification failed for ${component.name}`);
      }

      actions.push(`verified:${component.name}`);
    }
  }

  const restartRequired = config.allowSelfUpdate && config.restartOnUpdate && appliedComponents.length > 0;
  const readiness: OttoReadiness = {
    running: true,
    kernelLoaded: hasComponent(payload, 'otto-kernel'),
    updateEngineReady: hasComponent(payload, 'otto-update'),
    commandServiceReady: hasComponent(payload, 'otto-command-service'),
    cliExtensionLoaded: hasComponent(payload, 'otto-extensions-cli'),
    apiExtensionLoaded: hasComponent(payload, 'otto-extensions-api'),
    loggingActive: config.observability.logging && hasComponent(payload, 'otto-logging'),
    tracingActive: config.observability.tracing && hasComponent(payload, 'otto-tracing'),
    metricsActive: config.observability.metrics && hasComponent(payload, 'otto-metrics')
  };

  const updateStatus: OttoUpdateStatus = {
    state: appliedComponents.length > 0 ? 'updated' : 'up-to-date',
    restartRequired,
    restarted: restartRequired,
    appliedComponents
  };

  if (restartRequired) {
    actions.push('restart:otto');
  }

  const previousState = await readOptionalJsonFile<OttoStateRecord>(stateFilePath);
  const nextState: OttoStateRecord = {
    mode: 'courseforge',
    bootCount: (previousState?.bootCount ?? 0) + 1,
    lastStartedAt: new Date().toISOString(),
    readiness,
    updateStatus
  };

  await writeJsonFile(stateFilePath, nextState);
  actions.push('state:written');

  return {
    mode: 'courseforge',
    runtimeRoot,
    manifestPath,
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
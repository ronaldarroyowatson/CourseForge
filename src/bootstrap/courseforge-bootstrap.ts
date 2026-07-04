import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootstrapOtto, type OttoBootstrapOptions, type OttoBootstrapResult } from './otto-bootstrap.js';
import { renderSkeletonUi, type CourseForgeUiContext, type SkeletonUiRenderResult } from '../ui/skeleton-ui.js';

export interface CourseForgeBootstrapResult {
  otto: OttoBootstrapResult;
  uiContext: CourseForgeUiContext;
  ui: SkeletonUiRenderResult;
  uiFilePath: string;
}

export async function bootstrapCourseForge(options: OttoBootstrapOptions = {}): Promise<CourseForgeBootstrapResult> {
  const otto = await bootstrapOtto(options);

  if (!isOttoReady(otto)) {
    throw new Error('Otto did not reach CourseForge readiness requirements.');
  }

  const uiContext: CourseForgeUiContext = {
    ottoStatus: 'OK',
    courseForgeStatus: 'LOADED',
    extensionStatus: {
      cli: otto.readiness.cliExtensionLoaded ? 'OK' : 'WAITING',
      api: otto.readiness.apiExtensionLoaded ? 'OK' : 'WAITING'
    },
    updateStatus: otto.updateStatus.state === 'updated' ? 'UPDATED' : 'UP-TO-DATE',
    observability: {
      logging: otto.readiness.loggingActive ? 'ON' : 'OFF',
      tracing: otto.readiness.tracingActive ? 'ON' : 'OFF',
      metrics: otto.readiness.metricsActive ? 'ON' : 'OFF'
    }
  };

  const ui = renderSkeletonUi(uiContext);
  const uiRoot = path.join(path.dirname(otto.runtimeRoot), 'ui');
  const uiFilePath = path.join(uiRoot, 'courseforge-skeleton.html');

  await mkdir(uiRoot, { recursive: true });
  await writeFile(uiFilePath, ui.html, 'utf8');

  return {
    otto,
    uiContext,
    ui,
    uiFilePath
  };
}

function isOttoReady(otto: OttoBootstrapResult): boolean {
  return (
    otto.readiness.running &&
    otto.readiness.kernelLoaded &&
    otto.readiness.updateEngineReady &&
    otto.readiness.commandServiceReady &&
    otto.readiness.cliExtensionLoaded &&
    otto.readiness.apiExtensionLoaded &&
    otto.readiness.loggingActive &&
    otto.readiness.tracingActive &&
    otto.readiness.metricsActive
  );
}
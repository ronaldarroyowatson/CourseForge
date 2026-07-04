import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootstrapOtto, type OttoBootstrapOptions, type OttoBootstrapResult } from './otto-bootstrap.js';
import {
  renderCourseForgeUi,
  type CourseForgeUiContext,
  type CourseForgeUiRenderResult
} from '../../courseforge-ui/services/render-courseforge-ui.js';
import { routeAfterUpdates } from '../../courseforge-ui/services/app-flow-controller.js';

export interface CourseForgeBootstrapResult {
  otto: OttoBootstrapResult;
  uiContext: CourseForgeUiContext;
  ui: CourseForgeUiRenderResult;
  uiFilePath: string;
}

export async function bootstrapCourseForge(options: OttoBootstrapOptions = {}): Promise<CourseForgeBootstrapResult> {
  const otto = await bootstrapOtto(options);

  if (!isOttoReady(otto)) {
    throw new Error('Otto did not reach CourseForge readiness requirements.');
  }

  const bootUserUid = process.env.COURSEFORGE_BOOT_USER_UID?.trim() ?? '';
  const hasBootUser = bootUserUid.length > 0;

  const uiContext: CourseForgeUiContext = {
    ottoStatus: 'READY',
    courseForgeStatus: otto.updateStatus.handoffReady ? 'READY' : 'WAITING',
    telemetryStatus: otto.readiness.telemetryExtensionLoaded ? 'ON' : 'OFF',
    splashStatus: otto.readiness.splashReady ? 'ON' : 'OFF',
    authStatus: otto.readiness.authExtensionDiscovered ? 'READY' : 'WAITING',
    updateStatus:
      otto.updateStatus.ottoState === 'updated' || otto.updateStatus.courseForgeState === 'updated'
        ? 'UPDATED'
        : 'UP-TO-DATE',
    ottoLifecycleState: otto.updateStatus.lifecycleState,
    ottoOverlayVisible: true,
    loggingStatus: otto.readiness.loggingActive ? 'ON' : 'OFF',
    tracingStatus: otto.readiness.tracingActive ? 'ON' : 'OFF',
    metricsStatus: otto.readiness.metricsActive ? 'ON' : 'OFF',
    currentUser: hasBootUser
      ? {
          uid: bootUserUid,
          displayName: process.env.COURSEFORGE_BOOT_USER_NAME?.trim() || 'Teacher User',
          avatarLabel: process.env.COURSEFORGE_BOOT_USER_AVATAR?.trim() || 'TU'
        }
      : null,
    authLoading: false,
    authErrorMessage: null,
    textbooks: []
  };

  const initialRoute = routeAfterUpdates(uiContext, {
    info: (message, data) => {
      console.info(message, data ?? {});
    }
  });
  console.info('courseforge.bootstrap: routeAfterUpdates resolved', {
    initialRoute,
    lifecycleState: uiContext.ottoLifecycleState
  });

  const ui = renderCourseForgeUi(uiContext);
  const uiRoot = path.join(path.dirname(otto.runtimeRoot), 'ui');
  const uiFilePath = path.join(uiRoot, 'courseforge-cloud-ui.html');

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
    otto.readiness.moduleLoaderReady &&
    otto.readiness.extensionLoaderReady &&
    otto.readiness.commandServiceReady &&
    otto.readiness.telemetryExtensionLoaded &&
    otto.readiness.splashReady &&
    otto.readiness.authExtensionDiscovered &&
    otto.readiness.loggingActive &&
    otto.readiness.tracingActive &&
    otto.readiness.metricsActive &&
    otto.updateStatus.handoffReady
  );
}
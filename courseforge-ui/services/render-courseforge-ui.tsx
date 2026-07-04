import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CourseForgeCloudApp } from '../CourseForgeCloudApp.js';
import type { CourseForgeUiContext, CourseForgeUiRenderResult } from './models.js';

export type { CourseForgeUiContext, CourseForgeUiRenderResult } from './models.js';

export function renderCourseForgeUi(context: CourseForgeUiContext): CourseForgeUiRenderResult {
  const indicators = [
    { label: 'Otto', state: context.ottoStatus },
    { label: 'CourseForge', state: context.courseForgeStatus },
    { label: 'Telemetry', state: context.telemetryStatus },
    { label: 'Splash', state: context.splashStatus },
    { label: 'Auth', state: context.authStatus },
    { label: 'Updates', state: context.updateStatus },
    { label: 'Logging', state: context.loggingStatus },
    { label: 'Tracing', state: context.tracingStatus },
    { label: 'Metrics', state: context.metricsStatus }
  ];

  const markup = renderToStaticMarkup(<CourseForgeCloudApp context={context} />);

  return {
    title: 'CourseForge Cloud UI',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>CourseForge Cloud UI</title></head><body>${markup}</body></html>`,
    indicators
  };
}

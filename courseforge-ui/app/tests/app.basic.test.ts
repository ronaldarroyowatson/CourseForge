import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseForgeCloudApp } from '../../CourseForgeCloudApp.js';

const context = {
  ottoStatus: 'READY' as const,
  courseForgeStatus: 'READY' as const,
  telemetryStatus: 'ON' as const,
  splashStatus: 'ON' as const,
  authStatus: 'READY' as const,
  updateStatus: 'UPDATED' as const,
  loggingStatus: 'ON' as const,
  tracingStatus: 'ON' as const,
  metricsStatus: 'ON' as const,
  currentUser: { uid: 'u', displayName: 'User Name', avatarLabel: 'UN' },
  authLoading: false,
  authErrorMessage: null,
  textbooks: []
};

describe('app.basic', () => {
  it('renders onboarding flow header', () => {
    const html = renderToStaticMarkup(React.createElement(CourseForgeCloudApp, { context }));
    expect(html.includes('Flow: Splash -&gt; Auth -&gt; Workspace')).toBe(true);
  });
});

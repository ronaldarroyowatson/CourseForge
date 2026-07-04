import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SplashScreen } from '../../splash/SplashScreen.js';
import { WorkspaceScreen } from '../../workspace/WorkspaceScreen.js';

describe('ui.failureModes', () => {
  it('does not crash SSR render when splash receives invalid callback type', () => {
    let html = '';

    expect(() => {
      html = renderToStaticMarkup(React.createElement(SplashScreen, { onContinue: null as unknown as never }));
    }).not.toThrow();

    expect(html.includes('Splash Screen')).toBe(true);
  });

  it('coerces malformed workspace status flags without crashing render', () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceScreen, {
        userName: 'User',
        avatarLabel: 'US',
        hasInProgressTextbooks: undefined as unknown as boolean,
        hasCompletedTextbooks: null as unknown as boolean,
        hasVerifiedTextbooks: false,
        hasSharedContentAvailable: false
      })
    );

    expect(html.includes('Workspace Screen')).toBe(true);
  });
});

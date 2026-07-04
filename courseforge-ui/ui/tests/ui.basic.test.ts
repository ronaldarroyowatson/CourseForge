import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SplashScreen } from '../../splash/SplashScreen.js';
import { TextbookCompletedScreen } from '../../textbook-completed/TextbookCompletedScreen.js';
import { TextbookCreateScreen } from '../../textbook-create/TextbookCreateScreen.js';
import { TextbookResumeScreen } from '../../textbook-resume/TextbookResumeScreen.js';
import { WorkspaceScreen } from '../../workspace/WorkspaceScreen.js';

describe('ui.basic', () => {
  it('renders splash and workspace primary labels', () => {
    const splashHtml = renderToStaticMarkup(React.createElement(SplashScreen, { onContinue: () => {} }));
    const workspaceHtml = renderToStaticMarkup(
      React.createElement(WorkspaceScreen, {
        userName: 'User',
        avatarLabel: 'US',
        hasInProgressTextbooks: true,
        hasCompletedTextbooks: true,
        hasVerifiedTextbooks: true,
        hasSharedContentAvailable: true
      })
    );

    expect(splashHtml.includes('Continue') && workspaceHtml.includes('Add New Textbook')).toBe(true);
  });

  it('renders textbook flow stub screens', () => {
    const createHtml = renderToStaticMarkup(React.createElement(TextbookCreateScreen));
    const resumeHtml = renderToStaticMarkup(React.createElement(TextbookResumeScreen));
    const completedHtml = renderToStaticMarkup(React.createElement(TextbookCompletedScreen));

    expect(
      createHtml.includes('pHash Ownership Verification') &&
        resumeHtml.includes('Resume') &&
        completedHtml.includes('Completed')
    ).toBe(true);
  });
});

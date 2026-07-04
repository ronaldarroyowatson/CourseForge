import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceScreen } from '../../workspace/WorkspaceScreen.js';

describe('ui.edgeCases', () => {
  it('renders with unusually long names and labels', () => {
    const longText = 'x'.repeat(5000);
    const html = renderToStaticMarkup(
      React.createElement(WorkspaceScreen, {
        userName: longText,
        avatarLabel: longText,
        hasInProgressTextbooks: false,
        hasCompletedTextbooks: false
      })
    );

    expect(html.includes('WorkspaceHeader')).toBe(true);
  });

  it('is deterministic across repeat renders under the same props', () => {
    const first = renderToStaticMarkup(
      React.createElement(WorkspaceScreen, {
        userName: 'User',
        avatarLabel: 'US',
        hasInProgressTextbooks: false,
        hasCompletedTextbooks: false
      })
    );
    const second = renderToStaticMarkup(
      React.createElement(WorkspaceScreen, {
        userName: 'User',
        avatarLabel: 'US',
        hasInProgressTextbooks: false,
        hasCompletedTextbooks: false
      })
    );

    expect(first).toBe(second);
  });
});

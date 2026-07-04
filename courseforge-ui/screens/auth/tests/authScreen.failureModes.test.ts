import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthScreen } from '../AuthScreen.js';

describe('authScreen.failureModes', () => {
  it('renders even when callback contract is malformed (not invoked at render time)', () => {
    const html = renderToStaticMarkup(React.createElement(AuthScreen, { onAuthenticated: null as unknown as never }));
    expect(html.includes('Sign In')).toBe(true);
  });
});

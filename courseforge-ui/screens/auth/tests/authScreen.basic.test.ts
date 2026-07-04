import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthScreen } from '../AuthScreen.js';

describe('authScreen.basic', () => {
  it('renders sign in card title and both auth buttons', () => {
    const html = renderToStaticMarkup(React.createElement(AuthScreen, { onAuthenticated: () => {} }));

    expect(html.includes('Sign In') && html.includes('Sign in with Google') && html.includes('Sign in with Email')).toBe(true);
  });
});

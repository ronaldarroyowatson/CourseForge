import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthScreen } from '../AuthScreen.js';

describe('authScreen.edgeCases', () => {
  it('renders deterministically across repeated server renders', () => {
    const first = renderToStaticMarkup(React.createElement(AuthScreen, { onAuthenticated: () => {} }));
    const second = renderToStaticMarkup(React.createElement(AuthScreen, { onAuthenticated: () => {} }));

    expect(first).toBe(second);
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseForgeCloudApp } from '../../CourseForgeCloudApp.js';

describe('app.failureModes', () => {
  it('throws when context is missing required fields', () => {
    expect(() => renderToStaticMarkup(React.createElement(CourseForgeCloudApp, { context: {} as never }))).toThrow();
  });
});

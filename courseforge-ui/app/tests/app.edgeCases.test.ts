import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseForgeCloudApp } from '../../CourseForgeCloudApp.js';

describe('app.edgeCases', () => {
  it('handles very large textbook arrays in context without render failure', () => {
    const textbooks = Array.from({ length: 3000 }, (_, index) => ({
      id: String(index),
      ownerId: 'u',
      title: `Book-${index}`,
      status: 'new' as const,
      coverImageHash: 'h',
      createdAt: 'x',
      updatedAt: 'x'
    }));

    const html = renderToStaticMarkup(
      React.createElement(CourseForgeCloudApp, {
        context: {
          ottoStatus: 'READY',
          courseForgeStatus: 'READY',
          telemetryStatus: 'ON',
          splashStatus: 'ON',
          authStatus: 'READY',
          updateStatus: 'UPDATED',
          loggingStatus: 'ON',
          tracingStatus: 'ON',
          metricsStatus: 'ON',
          currentUser: { uid: 'u', displayName: 'User', avatarLabel: 'US' },
          authLoading: false,
          authErrorMessage: null,
          textbooks
        }
      })
    );

    expect(html.includes('CourseForge Cloud UI')).toBe(true);
  });
});

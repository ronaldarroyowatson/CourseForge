import { describe, expect, it } from 'vitest';
import { routeAfterUpdates } from '../app-flow-controller.js';
import type { CourseForgeUiContext } from '../models.js';

function createContext(overrides: Partial<CourseForgeUiContext> = {}): CourseForgeUiContext {
  return {
    ottoStatus: 'READY',
    courseForgeStatus: 'READY',
    telemetryStatus: 'ON',
    splashStatus: 'ON',
    authStatus: 'READY',
    updateStatus: 'UPDATED',
    ottoLifecycleState: 'OTTO_DONE',
    ottoOverlayVisible: true,
    loggingStatus: 'ON',
    tracingStatus: 'ON',
    metricsStatus: 'ON',
    currentUser: null,
    authLoading: false,
    authErrorMessage: null,
    textbooks: [],
    ...overrides
  };
}

describe('app-flow-controller.basic', () => {
  it('routes to splash before OTTO_DONE', () => {
    const stage = routeAfterUpdates(
      createContext({
        ottoLifecycleState: 'OTTO_CHECKING'
      })
    );
    expect(stage).toBe('splash');
  });

  it('routes to auth when updates are done and no user exists', () => {
    const stage = routeAfterUpdates(createContext());
    expect(stage).toBe('auth');
  });

  it('keeps splash visible while auth is still loading', () => {
    const stage = routeAfterUpdates(
      createContext({
        authLoading: true
      })
    );

    expect(stage).toBe('splash');
  });

  it('routes to workspace when updates are done and user exists', () => {
    const stage = routeAfterUpdates(
      createContext({
        currentUser: {
          uid: 'u-1',
          displayName: 'Teacher',
          avatarLabel: 'TE'
        }
      })
    );

    expect(stage).toBe('workspace');
  });
});

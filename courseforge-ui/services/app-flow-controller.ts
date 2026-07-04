import type { CourseForgeUiContext } from './models.js';

export type CourseForgeRouteStage = 'splash' | 'auth' | 'workspace';

export interface AppFlowLogger {
  info(message: string, data?: Record<string, unknown>): void;
}

const noOpLogger: AppFlowLogger = {
  info: () => undefined
};

export function routeAfterUpdates(context: CourseForgeUiContext, logger: AppFlowLogger = noOpLogger): CourseForgeRouteStage {
  logger.info('courseforge.routeAfterUpdates: evaluating route', {
    ottoLifecycleState: context.ottoLifecycleState,
    hasCurrentUser: Boolean(context.currentUser)
  });

  if (context.ottoLifecycleState !== 'OTTO_DONE') {
    logger.info('courseforge.routeAfterUpdates: Otto not finished, keeping splash visible');
    return 'splash';
  }

  if (!context.currentUser) {
    logger.info('courseforge.routeAfterUpdates: no user present, routing to auth');
    return 'auth';
  }

  logger.info('courseforge.routeAfterUpdates: user present, routing to workspace', {
    uid: context.currentUser.uid
  });
  return 'workspace';
}
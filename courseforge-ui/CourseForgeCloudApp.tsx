import React from 'react';
import { AuthScreen } from './screens/auth/AuthScreen.js';
import { SplashScreen } from './splash/SplashScreen.js';
import { TextbookCompletedScreen } from './textbook-completed/TextbookCompletedScreen.js';
import { TextbookCreateScreen } from './textbook-create/TextbookCreateScreen.js';
import { TextbookResumeScreen } from './textbook-resume/TextbookResumeScreen.js';
import { WorkspaceScreen } from './workspace/WorkspaceScreen.js';
import {
  authorityTokens,
  bodyTextStyle,
  debugRegionStyle,
  gridLayoutStyle,
  headingTextStyle,
  resolvePrimitiveStyle,
  stackLayoutStyle,
  subtleTextStyle
} from './design-system/authority-layer.js';
import { routeAfterUpdates, type CourseForgeRouteStage } from './services/app-flow-controller.js';
import type { CourseForgeUiContext } from './services/models.js';

export function CourseForgeCloudApp({ context }: { context: CourseForgeUiContext }): React.JSX.Element {
  const [stage, setStage] = React.useState<CourseForgeRouteStage>(() =>
    routeAfterUpdates(context, {
      info: (message, data) => {
        console.info(message, data ?? {});
      }
    })
  );

  React.useEffect(() => {
    console.info('courseforge.ui: route stage resolved', {
      stage,
      hasCurrentUser: Boolean(context.currentUser),
      ottoLifecycleState: context.ottoLifecycleState,
      authLoading: context.authLoading
    });

    if (stage === 'splash') {
      console.info('courseforge.ui: splash mounted', {
        ottoLifecycleState: context.ottoLifecycleState,
        authLoading: context.authLoading
      });
    }
  }, [stage, context.currentUser, context.ottoLifecycleState, context.authLoading]);

  React.useEffect(() => {
    const nextStage = routeAfterUpdates(context, {
      info: (message, data) => {
        console.info(message, data ?? {});
      }
    });
    setStage(nextStage);
  }, [context]);

  const defaultUserName = context.currentUser?.displayName ?? 'Teacher User';
  const defaultAvatarLabel = context.currentUser?.avatarLabel ?? 'TU';
  const showSplashOverlay = stage === 'splash' || context.ottoLifecycleState !== 'OTTO_DONE' || context.authLoading;

  const [workspaceState, setWorkspaceState] = React.useState<{
    userName: string;
    avatarLabel: string;
    hasInProgressTextbooks: boolean;
    hasCompletedTextbooks: boolean;
    hasVerifiedTextbooks: boolean;
    hasSharedContentAvailable: boolean;
  }>({
    userName: defaultUserName,
    avatarLabel: defaultAvatarLabel,
    hasInProgressTextbooks: false,
    hasCompletedTextbooks: false,
    hasVerifiedTextbooks: context.textbooks.some((textbook) => textbook.verified === true),
    hasSharedContentAvailable: false
  });

  const showWorkspace = stage === 'workspace';

  return (
    <main
      style={{
        ...stackLayoutStyle({
          minHeight: '100vh',
          margin: 0,
          padding: authorityTokens.spacing.config.xxl,
          background: authorityTokens.color.config.scale.neutral[0],
          color: authorityTokens.color.config.scale.neutral[900],
          fontFamily: authorityTokens.typography.config.family.body,
          gap: authorityTokens.spacing.config.xl
        }),
        ...debugRegionStyle('layoutBounds')
      }}
    >
      <header
        style={{
          ...resolvePrimitiveStyle('Panel', 'secondary', {
            minWidth: '100%',
            minHeight: 'auto'
          }),
          ...stackLayoutStyle({
            gap: authorityTokens.spacing.config.sm
          }),
          ...debugRegionStyle('interactiveArea')
        }}
      >
        <strong style={headingTextStyle('screen')}>CourseForge Cloud UI</strong>
        <div style={subtleTextStyle()}>Flow: Splash -&gt; Auth -&gt; Workspace</div>
        <div
          style={{
            ...gridLayoutStyle('repeat(auto-fit, minmax(10rem, 1fr))', {
              marginTop: authorityTokens.spacing.config.sm,
              gap: authorityTokens.spacing.config.xs
            }),
            ...subtleTextStyle({
              fontFamily: authorityTokens.typography.config.family.mono
            })
          }}
        >
          <div style={bodyTextStyle()}>Otto: {context.ottoStatus}</div>
          <div style={bodyTextStyle()}>CourseForge: {context.courseForgeStatus}</div>
          <div style={bodyTextStyle()}>Telemetry: {context.telemetryStatus}</div>
          <div style={bodyTextStyle()}>Splash: {context.splashStatus}</div>
          <div style={bodyTextStyle()}>Auth: {context.authStatus}</div>
          <div style={bodyTextStyle()}>Updates: {context.updateStatus}</div>
          <div style={bodyTextStyle()}>Otto Lifecycle: {context.ottoLifecycleState}</div>
          <div style={bodyTextStyle()}>Logging: {context.loggingStatus}</div>
          <div style={bodyTextStyle()}>Tracing: {context.tracingStatus}</div>
          <div style={bodyTextStyle()}>Metrics: {context.metricsStatus}</div>
        </div>
      </header>

      {stage === 'splash' ? <SplashScreen /> : null}
      {stage === 'auth' ? (
        <AuthScreen
          onAuthenticated={(result) => {
            console.info('courseforge.ui: authenticated, navigating to workspace', {
              uid: result.user.uid,
              displayName: result.user.displayName
            });
            setWorkspaceState({
              userName: result.user.displayName,
              avatarLabel: result.user.displayName.slice(0, 2).toUpperCase() || 'CF',
              hasInProgressTextbooks: result.hasInProgressTextbooks,
              hasCompletedTextbooks: result.hasCompletedTextbooks,
              hasVerifiedTextbooks: context.textbooks.some((textbook) => textbook.verified === true),
              hasSharedContentAvailable: context.textbooks.some(
                (textbook) => textbook.verified === true && textbook.coverImageHash.trim().length > 0
              )
            });
            setStage('workspace');
          }}
        />
      ) : null}
      {showWorkspace ? (
        <>
          <WorkspaceScreen
            userName={workspaceState.userName}
            avatarLabel={workspaceState.avatarLabel}
            hasInProgressTextbooks={workspaceState.hasInProgressTextbooks}
            hasCompletedTextbooks={workspaceState.hasCompletedTextbooks}
            hasVerifiedTextbooks={workspaceState.hasVerifiedTextbooks}
            hasSharedContentAvailable={workspaceState.hasSharedContentAvailable}
          />
          <TextbookCreateScreen />
          <TextbookResumeScreen />
          <TextbookCompletedScreen />
        </>
      ) : null}

      {context.ottoOverlayVisible && showSplashOverlay ? <OttoBackgroundUpdater lifecycleState={context.ottoLifecycleState} /> : null}
    </main>
  );
}

function OttoBackgroundUpdater({ lifecycleState }: { lifecycleState: CourseForgeUiContext['ottoLifecycleState'] }): React.JSX.Element {
  const isDone = lifecycleState === 'OTTO_DONE';

  return (
    <>
      <style>{'@keyframes ottoOverlayFadeOut { 0% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }'}</style>
      <div
        id="ottoBackgroundUpdater"
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          display: 'grid',
          placeItems: 'center',
          background: authorityTokens.color.config.semantic.primary.background,
          opacity: 1,
          animation: isDone ? 'ottoOverlayFadeOut 480ms ease-out forwards' : undefined
        }}
      >
        <div
          style={{
            ...resolvePrimitiveStyle('Panel', 'secondary', {
              minWidth: '20rem',
              minHeight: 'auto'
            }),
            ...stackLayoutStyle({
              gap: authorityTokens.spacing.config.sm
            }),
            ...debugRegionStyle('asyncRegion')
          }}
        >
          <strong style={headingTextStyle('screen')}>Otto Background Updater</strong>
          <div style={bodyTextStyle()}>State: {lifecycleState}</div>
          <div style={subtleTextStyle()}>
            {isDone ? 'Update complete. Handing off to CourseForge.' : 'Applying updates in the background.'}
          </div>
        </div>
      </div>
    </>
  );
}

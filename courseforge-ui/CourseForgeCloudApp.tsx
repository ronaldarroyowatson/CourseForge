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
import type { CourseForgeUiContext } from './services/models.js';

export function CourseForgeCloudApp({ context }: { context: CourseForgeUiContext }): React.JSX.Element {
  const [stage, setStage] = React.useState<'splash' | 'auth' | 'workspace'>('splash');
  const [workspaceState, setWorkspaceState] = React.useState<{
    userName: string;
    avatarLabel: string;
    hasInProgressTextbooks: boolean;
    hasCompletedTextbooks: boolean;
    hasVerifiedTextbooks: boolean;
    hasSharedContentAvailable: boolean;
  }>({
    userName: context.currentUser.displayName,
    avatarLabel: context.currentUser.avatarLabel,
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
          <div style={bodyTextStyle()}>Logging: {context.loggingStatus}</div>
          <div style={bodyTextStyle()}>Tracing: {context.tracingStatus}</div>
          <div style={bodyTextStyle()}>Metrics: {context.metricsStatus}</div>
        </div>
      </header>

      {stage === 'splash' ? <SplashScreen onContinue={() => setStage('auth')} /> : null}
      {stage === 'auth' ? (
        <AuthScreen
          onAuthenticated={(result) => {
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
    </main>
  );
}

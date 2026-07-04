import React from 'react';
import { AuthScreen } from './screens/auth/AuthScreen.js';
import { SplashScreen } from './splash/SplashScreen.js';
import { TextbookCompletedScreen } from './textbook-completed/TextbookCompletedScreen.js';
import { TextbookCreateScreen } from './textbook-create/TextbookCreateScreen.js';
import { TextbookResumeScreen } from './textbook-resume/TextbookResumeScreen.js';
import { WorkspaceScreen } from './workspace/WorkspaceScreen.js';
import type { CourseForgeUiContext } from './services/models.js';

export function CourseForgeCloudApp({ context }: { context: CourseForgeUiContext }): React.JSX.Element {
  const [stage, setStage] = React.useState<'splash' | 'auth' | 'workspace'>('splash');
  const [workspaceState, setWorkspaceState] = React.useState<{
    userName: string;
    avatarLabel: string;
    hasInProgressTextbooks: boolean;
    hasCompletedTextbooks: boolean;
  }>({
    userName: context.currentUser.displayName,
    avatarLabel: context.currentUser.avatarLabel,
    hasInProgressTextbooks: false,
    hasCompletedTextbooks: false
  });

  const showWorkspace = stage === 'workspace';

  return (
    <main
      style={{
        minHeight: '100vh',
        margin: 0,
        padding: '24px',
        background: '#ffffff',
        color: '#111111',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        display: 'grid',
        gap: '16px'
      }}
    >
      <header style={{ border: '1px solid #d1d1d1', borderRadius: '8px', padding: '12px' }}>
        <strong>CourseForge Cloud UI</strong>
        <div style={{ marginTop: '6px', fontSize: '14px' }}>Flow: Splash -&gt; Auth -&gt; Workspace</div>
        <div
          style={{
            marginTop: '10px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: '6px',
            fontSize: '13px'
          }}
        >
          <div>Otto: {context.ottoStatus}</div>
          <div>CourseForge: {context.courseForgeStatus}</div>
          <div>Telemetry: {context.telemetryStatus}</div>
          <div>Splash: {context.splashStatus}</div>
          <div>Auth: {context.authStatus}</div>
          <div>Updates: {context.updateStatus}</div>
          <div>Logging: {context.loggingStatus}</div>
          <div>Tracing: {context.tracingStatus}</div>
          <div>Metrics: {context.metricsStatus}</div>
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
              hasCompletedTextbooks: result.hasCompletedTextbooks
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
          />
          <TextbookCreateScreen />
          <TextbookResumeScreen />
          <TextbookCompletedScreen />
        </>
      ) : null}
    </main>
  );
}

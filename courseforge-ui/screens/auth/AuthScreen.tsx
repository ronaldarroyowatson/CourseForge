import React, { useMemo, useState } from 'react';
import { FirebaseAuthService, type AuthIdentity } from '../../services/auth/authService.js';
import { dbClient } from '../../services/db/dbClient.js';
import type { TextbookRecord, UserRecord } from '../../services/models.js';
import { DefaultUserService } from '../../services/user/userService.js';
import {
  authorityBehaviorRules,
  authorityTokens,
  asyncRegionStyle,
  bodyTextStyle,
  debugRegionStyle,
  flowLayoutStyle,
  headingTextStyle,
  resolvePrimitiveStyle,
  resolveReactWrapperProps,
  stackLayoutStyle,
  subtleTextStyle
} from '../../design-system/authority-layer.js';
import { useAuthorityLifecycleState } from '../../design-system/use-authority-lifecycle.js';

interface AuthScreenProps {
  onAuthenticated: (result: {
    identity: AuthIdentity;
    user: UserRecord;
    hasInProgressTextbooks: boolean;
    hasCompletedTextbooks: boolean;
  }) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps): React.JSX.Element {
  const userService = useMemo(() => new DefaultUserService(), []);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const lifecycle = useAuthorityLifecycleState();

  async function authenticate(method: 'google' | 'email'): Promise<void> {
    setAuthErrorMessage(null);

    try {
      await lifecycle.runWithLoading(async () => {
        const authService = new FirebaseAuthService();
        const identity = method === 'google' ? await authService.signInWithGoogle() : await authService.signInWithEmail();
        const nowIso = new Date().toISOString();
        const existingUser = await userService.getUser(identity.uid);

        const user = existingUser
          ? await userService.updateLastLogin(identity.uid, nowIso)
          : await userService.createUser({
              uid: identity.uid,
              email: identity.email,
              displayName: identity.displayName,
              createdAt: nowIso,
              lastLogin: nowIso,
              textbooks: []
            });

        const textbooks = await dbClient.run('getTextbooksByOwner', { ownerId: identity.uid });
        onAuthenticated({
          identity,
          user,
          hasInProgressTextbooks: hasTextbookWithStatus(textbooks, 'in-progress'),
          hasCompletedTextbooks: hasTextbookWithStatus(textbooks, 'completed')
        });
      });
    } catch (error) {
      setAuthErrorMessage(toMessage(error));
    }
  }

  return (
    <AuthCard loading={lifecycle.isBusy}>
      <CardTitle value="Sign In" />
      <AuthButton id="googleAuth" label="Sign in with Google" disabled={lifecycle.isBusy} onClick={() => void authenticate('google')} />
      <AuthButton id="emailAuth" label="Sign in with Email" disabled={lifecycle.isBusy} onClick={() => void authenticate('email')} />
      {authErrorMessage ? (
        <AuthError
          errorMessage={authErrorMessage}
          onRetry={() => {
            setAuthErrorMessage(null);
            lifecycle.transitionTo('ready');
          }}
        />
      ) : null}
    </AuthCard>
  );
}

function hasTextbookWithStatus(textbooks: TextbookRecord[], status: TextbookRecord['status']): boolean {
  return textbooks.some((textbook) => textbook.status === status);
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Sign-in failed. Please try again.';
}

function AuthCard({ children, loading }: { children: React.ReactNode; loading: boolean }): React.JSX.Element {
  const cardStyle = resolvePrimitiveStyle('Card', 'secondary', {
    minWidth: '22rem'
  });

  return (
    <section
      style={{
        ...cardStyle,
        ...stackLayoutStyle({
          gap: authorityTokens.spacing.config.lg,
          maxWidth: '26rem'
        }),
        ...asyncRegionStyle(loading),
        ...debugRegionStyle('asyncRegion')
      }}
    >
      {children}
    </section>
  );
}

function CardTitle({ value }: { value: string }): React.JSX.Element {
  return <h2 style={headingTextStyle('screen')}>{value}</h2>;
}

function AuthButton({
  id,
  label,
  disabled,
  onClick
}: {
  id: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const buttonProps = resolveReactWrapperProps('Button', 'primary', { disabled });

  return (
    <button
      id={id}
      type="button"
      disabled={disabled}
      onClick={onClick}
      role={buttonProps.role}
      aria-busy={buttonProps['aria-busy']}
      aria-disabled={buttonProps['aria-disabled']}
      data-component={buttonProps['data-component']}
      data-variant={buttonProps['data-variant']}
      style={{
        ...buttonProps.style,
        ...flowLayoutStyle({
          justifyContent: 'flex-start',
          alignItems: 'center'
        }),
        textAlign: 'left',
        fontWeight: authorityTokens.typography.config.weight.semibold
      }}
    >
      {label}
    </button>
  );
}

function AuthError({ errorMessage, onRetry }: { errorMessage: string; onRetry: () => void }): React.JSX.Element {
  const errorSurfaceStyle = resolvePrimitiveStyle('Panel', 'error', {
    minWidth: '100%',
    minHeight: 'auto'
  });
  const retryButtonProps = resolveReactWrapperProps('Button', 'warning');

  return (
    <div
      style={{
        ...errorSurfaceStyle,
        ...stackLayoutStyle({
          gap: authorityTokens.spacing.config.sm
        }),
        borderColor: authorityBehaviorRules.error.config.field.borderColor,
        color: authorityBehaviorRules.error.config.field.messageColor,
        ...debugRegionStyle('errorRegion')
      }}
    >
      <div style={bodyTextStyle()}>{errorMessage}</div>
      <button
        type="button"
        onClick={onRetry}
        role={retryButtonProps.role}
        data-component={retryButtonProps['data-component']}
        data-variant={retryButtonProps['data-variant']}
        style={{
          ...retryButtonProps.style,
          ...subtleTextStyle({
            width: 'fit-content',
            color: authorityTokens.color.config.semantic.warning.foreground,
            background: authorityTokens.color.config.semantic.warning.background
          })
        }}
      >
        Retry
      </button>
    </div>
  );
}

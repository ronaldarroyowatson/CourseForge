import React, { useMemo, useState } from 'react';
import { FirebaseAuthService, type AuthIdentity } from '../../services/auth/authService.js';
import { dbClient } from '../../services/db/dbClient.js';
import type { TextbookRecord, UserRecord } from '../../services/models.js';
import { DefaultUserService } from '../../services/user/userService.js';

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
  const [authLoading, setAuthLoading] = useState(false);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);

  async function authenticate(method: 'google' | 'email'): Promise<void> {
    setAuthLoading(true);
    setAuthErrorMessage(null);

    try {
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
    } catch (error) {
      setAuthErrorMessage(toMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }

  return (
    <AuthCard>
      <CardTitle value="Sign In" />
      <AuthButton id="googleAuth" label="Sign in with Google" disabled={authLoading} onClick={() => void authenticate('google')} />
      <AuthButton id="emailAuth" label="Sign in with Email" disabled={authLoading} onClick={() => void authenticate('email')} />
      {authErrorMessage ? <AuthError errorMessage={authErrorMessage} onRetry={() => setAuthErrorMessage(null)} /> : null}
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

function AuthCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <section
      style={{
        border: '1px solid #d1d1d1',
        borderRadius: '8px',
        padding: '16px',
        display: 'grid',
        gap: '12px',
        maxWidth: '420px'
      }}
    >
      {children}
    </section>
  );
}

function CardTitle({ value }: { value: string }): React.JSX.Element {
  return <h2 style={{ margin: 0, fontSize: '20px' }}>{value}</h2>;
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
  return (
    <button
      id={id}
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        border: '1px solid #a8a8a8',
        borderRadius: '6px',
        background: '#ffffff',
        padding: '12px',
        textAlign: 'left',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {label}
    </button>
  );
}

function AuthError({ errorMessage, onRetry }: { errorMessage: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div style={{ border: '1px solid #d86a6a', borderRadius: '6px', padding: '10px', color: '#9f1f1f', display: 'grid', gap: '8px' }}>
      <div>{errorMessage}</div>
      <button type="button" onClick={onRetry} style={{ width: 'fit-content' }}>
        Retry
      </button>
    </div>
  );
}

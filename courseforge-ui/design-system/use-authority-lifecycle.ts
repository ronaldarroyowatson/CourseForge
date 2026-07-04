import { useCallback, useMemo, useState } from 'react';
import { authorityStateMachines, type AuthorityLifecycleState } from './authority-layer.js';

export interface AuthorityLifecycleController {
  state: AuthorityLifecycleState;
  isBusy: boolean;
  isError: boolean;
  transitionTo: (next: AuthorityLifecycleState) => void;
  runWithLoading: <T>(work: () => Promise<T>) => Promise<T>;
}

function canTransition(current: AuthorityLifecycleState, next: AuthorityLifecycleState): boolean {
  const transitions = authorityStateMachines.lifecycle.config.transitions;
  const allowedTargets = transitions[current] as readonly AuthorityLifecycleState[];
  return allowedTargets.includes(next);
}

export function useAuthorityLifecycleState(): AuthorityLifecycleController {
  const initialState = authorityStateMachines.lifecycle.config.initial;
  const [state, setState] = useState<AuthorityLifecycleState>(initialState);

  const transitionTo = useCallback((next: AuthorityLifecycleState) => {
    setState((current) => (canTransition(current, next) ? next : current));
  }, []);

  const runWithLoading = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setState((current) => (canTransition(current, 'loading') ? 'loading' : current));

    try {
      const result = await work();
      setState((current) => (canTransition(current, 'ready') ? 'ready' : current));
      return result;
    } catch (error) {
      setState((current) => (canTransition(current, 'error') ? 'error' : current));
      throw error;
    }
  }, []);

  return useMemo(
    () => ({
      state,
      isBusy: state === 'loading' || state === 'saving',
      isError: state === 'error',
      transitionTo,
      runWithLoading
    }),
    [state, transitionTo, runWithLoading]
  );
}

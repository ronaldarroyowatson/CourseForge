import type { TextbookRecord } from '../services/models.js';

export interface WorkspaceState {
  hasInProgressTextbooks: boolean;
  hasCompletedTextbooks: boolean;
}

export function useWorkspaceState(textbooks: TextbookRecord[]): WorkspaceState {
  return {
    hasInProgressTextbooks: textbooks.some((textbook) => textbook.status === 'in-progress'),
    hasCompletedTextbooks: textbooks.some((textbook) => textbook.status === 'completed')
  };
}

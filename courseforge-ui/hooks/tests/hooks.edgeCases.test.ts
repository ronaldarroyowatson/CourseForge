import { describe, expect, it, vi } from 'vitest';
import { useOwnershipVerification } from '../use-ownership-verification.js';
import { useWorkspaceState } from '../use-workspace-state.js';

describe('hooks.edgeCases', () => {
  it('returns false flags for empty textbook arrays', () => {
    expect(useWorkspaceState([])).toEqual({ hasInProgressTextbooks: false, hasCompletedTextbooks: false });
  });

  it('handles large textbook arrays deterministically', () => {
    const textbooks = Array.from({ length: 2000 }, (_, index) => ({
      id: String(index),
      ownerId: 'u',
      title: `T-${index}`,
      status: index === 1999 ? 'completed' as const : 'new' as const,
      coverImageHash: 'h',
      createdAt: 'x',
      updatedAt: 'x'
    }));

    expect(useWorkspaceState(textbooks).hasCompletedTextbooks).toBe(true);
  });

  it('supports unusual but valid zero-length cover images', () => {
    const service = {
      computePerceptualHash: vi.fn().mockReturnValue('zero'),
      compareHashes: vi.fn().mockReturnValue(0),
      isSameEdition: vi.fn().mockReturnValue(true)
    };
    expect(useOwnershipVerification({ coverImageBytes: new Uint8Array([]) }, service).coverImageHash).toBe('zero');
  });
});

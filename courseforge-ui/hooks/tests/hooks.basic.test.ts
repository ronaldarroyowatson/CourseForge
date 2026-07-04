import { describe, expect, it, vi } from 'vitest';
import { useOwnershipVerification } from '../use-ownership-verification.js';
import { useWorkspaceState } from '../use-workspace-state.js';

describe('hooks.basic', () => {
  it('computes in-progress and completed flags from textbook statuses', () => {
    const state = useWorkspaceState([
      { id: '1', ownerId: 'u', title: 'A', status: 'in-progress', coverImageHash: 'h', createdAt: 'x', updatedAt: 'x' },
      { id: '2', ownerId: 'u', title: 'B', status: 'completed', coverImageHash: 'h', createdAt: 'x', updatedAt: 'x' }
    ]);

    expect(state).toEqual({ hasInProgressTextbooks: true, hasCompletedTextbooks: true });
  });

  it('returns ownership verification hash using the provided service', () => {
    const service = {
      computePerceptualHash: vi.fn().mockReturnValue('hash-value'),
      compareHashes: vi.fn().mockReturnValue(0),
      isSameEdition: vi.fn().mockReturnValue(true)
    };
    const result = useOwnershipVerification({ coverImageBytes: new Uint8Array([1, 2, 3]) }, service);

    expect(result.coverImageHash).toBe('hash-value');
    expect(result.hammingDistance).toBeNull();
    expect(result.sameEdition).toBeNull();
  });

  it('returns hamming distance and same-edition status when comparison hash is provided', () => {
    const service = {
      computePerceptualHash: vi.fn().mockReturnValue('hash-value'),
      compareHashes: vi.fn().mockReturnValue(4),
      isSameEdition: vi.fn().mockReturnValue(true)
    };

    const result = useOwnershipVerification(
      {
        coverImageBytes: new Uint8Array([1, 2, 3]),
        compareWithHash: 'abcdabcdabcdabcd',
        tolerance: 10
      },
      service
    );

    expect(result.hammingDistance).toBe(4);
    expect(result.sameEdition).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { useOwnershipVerification } from '../use-ownership-verification.js';

describe('hooks.failureModes', () => {
  it('surfaces ownership service failures to caller', () => {
    const failingService = {
      computePerceptualHash(): string {
        throw new Error('service-failure');
      }
    };

    expect(() => useOwnershipVerification({ coverImageBytes: new Uint8Array([1]) }, failingService)).toThrow('service-failure');
  });

  it('throws when ownership service receives malformed bytes handler', () => {
    const badService = { computePerceptualHash: null as unknown as (value: Uint8Array) => string };

    expect(() => useOwnershipVerification({ coverImageBytes: new Uint8Array([1]) }, badService as never)).toThrow();
  });
});

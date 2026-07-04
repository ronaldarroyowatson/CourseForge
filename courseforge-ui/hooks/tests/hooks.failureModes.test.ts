import { describe, expect, it } from 'vitest';
import { useOwnershipVerification } from '../use-ownership-verification.js';

describe('hooks.failureModes', () => {
  it('surfaces ownership service failures to caller', () => {
    const failingService = {
      computePerceptualHash(): string {
        throw new Error('service-failure');
      },
      compareHashes(): number {
        return 0;
      },
      isSameEdition(): boolean {
        return false;
      }
    };

    expect(() => useOwnershipVerification({ coverImageBytes: new Uint8Array([1]) }, failingService)).toThrow('service-failure');
  });

  it('throws when ownership service receives malformed bytes handler', () => {
    const badService = {
      computePerceptualHash: null as unknown as (value: Uint8Array) => string,
      compareHashes: null as unknown as (hashA: string, hashB: string) => number,
      isSameEdition: null as unknown as (hashA: string, hashB: string, tolerance?: number) => boolean
    };

    expect(() => useOwnershipVerification({ coverImageBytes: new Uint8Array([1]) }, badService as never)).toThrow();
  });

  it('throws when comparison logic fails for malformed hash values', () => {
    const failingCompareService = {
      computePerceptualHash: () => 'zzzz',
      compareHashes: () => {
        throw new Error('invalid-hash');
      },
      isSameEdition: () => false
    };

    expect(
      () =>
        useOwnershipVerification(
          {
            coverImageBytes: new Uint8Array([1]),
            compareWithHash: '0011'
          },
          failingCompareService
        )
    ).toThrow('invalid-hash');
  });
});

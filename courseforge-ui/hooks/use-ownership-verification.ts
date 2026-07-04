import type { OwnershipService } from '../services/ownership-service.js';

export interface OwnershipVerificationInput {
  coverImageBytes: Uint8Array;
  compareWithHash?: string;
  tolerance?: number;
}

export interface OwnershipVerificationResult {
  coverImageHash: string;
  hammingDistance: number | null;
  sameEdition: boolean | null;
}

export function useOwnershipVerification(
  input: OwnershipVerificationInput,
  ownershipService: OwnershipService
): OwnershipVerificationResult {
  const coverImageHash = ownershipService.computePerceptualHash(input.coverImageBytes);
  if (!input.compareWithHash) {
    return {
      coverImageHash,
      hammingDistance: null,
      sameEdition: null
    };
  }

  const hammingDistance = ownershipService.compareHashes(coverImageHash, input.compareWithHash);

  return {
    coverImageHash,
    hammingDistance,
    sameEdition: ownershipService.isSameEdition(coverImageHash, input.compareWithHash, input.tolerance)
  };
}

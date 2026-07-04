import type { OwnershipService } from '../services/ownership-service.js';

export interface OwnershipVerificationInput {
  coverImageBytes: Uint8Array;
}

export interface OwnershipVerificationResult {
  coverImageHash: string;
}

export function useOwnershipVerification(
  input: OwnershipVerificationInput,
  ownershipService: OwnershipService
): OwnershipVerificationResult {
  return {
    coverImageHash: ownershipService.computePerceptualHash(input.coverImageBytes)
  };
}

import { createHash } from 'node:crypto';

export interface OwnershipService {
  computePerceptualHash(imageBytes: Uint8Array): string;
}

export class DefaultOwnershipService implements OwnershipService {
  computePerceptualHash(imageBytes: Uint8Array): string {
    // Deterministic placeholder hash for edition ownership checks.
    return createHash('sha256').update(imageBytes).digest('hex').slice(0, 32);
  }
}

export function canShareTeacherGeneratedContent(params: {
  includesTeacherGeneratedContent: boolean;
  includesCopyrightedPages: boolean;
}): boolean {
  return params.includesTeacherGeneratedContent && !params.includesCopyrightedPages;
}

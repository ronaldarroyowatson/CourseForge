import { describe, expect, it } from 'vitest';
import { DefaultOwnershipService } from '../ownership-service.js';

describe('services.edgeCases', () => {
  it('produces a fixed-length pHash for empty binary payloads', () => {
    const service = new DefaultOwnershipService();
    expect(service.computePerceptualHash(new Uint8Array([]))).toHaveLength(16);
  });

  it('returns false when teacher-generated content flag is false', async () => {
    const { canShareTeacherGeneratedContent } = await import('../ownership-service.js');
    expect(
      canShareTeacherGeneratedContent({
        isSameEditionOwner: true,
        includesTeacherCreatedContent: false,
        includesStructuralMetadataOnly: false,
        includesCopyrightedMaterial: false
      })
    ).toBe(false);
  });

  it('supports hamming distance and same-edition tolerance checks', () => {
    const service = new DefaultOwnershipService();
    expect(service.compareHashes('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
    expect(service.isSameEdition('ffffffffffffffff', 'ffffffffffffffff', 10)).toBe(true);
  });
});

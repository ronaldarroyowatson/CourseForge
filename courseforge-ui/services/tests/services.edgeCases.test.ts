import { describe, expect, it } from 'vitest';
import { DefaultOwnershipService } from '../ownership-service.js';

describe('services.edgeCases', () => {
  it('produces a fixed-length hash prefix for empty binary payloads', () => {
    const service = new DefaultOwnershipService();
    expect(service.computePerceptualHash(new Uint8Array([]))).toHaveLength(32);
  });

  it('returns false when teacher-generated content flag is false', async () => {
    const { canShareTeacherGeneratedContent } = await import('../ownership-service.js');
    expect(
      canShareTeacherGeneratedContent({ includesTeacherGeneratedContent: false, includesCopyrightedPages: false })
    ).toBe(false);
  });
});

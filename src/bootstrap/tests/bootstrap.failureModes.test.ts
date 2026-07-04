import { describe, expect, it } from 'vitest';
import { bootstrapCourseForge } from '../courseforge-bootstrap.js';

describe('bootstrap.failureModes', () => {
  it('fails when repo root is invalid', async () => {
    await expect(bootstrapCourseForge({ repoRoot: '/invalid/path/does-not-exist' })).rejects.toThrow();
  });
});
